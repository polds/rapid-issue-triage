package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
)

// IssueContentHash fingerprints the content an enrichment was computed from.
// Only title + description count: our own triage mutations (labels, state)
// shouldn't invalidate an analysis of what the issue says.
func IssueContentHash(title, description string) string {
	h := sha256.Sum256([]byte(title + "\x00" + description))
	return hex.EncodeToString(h[:8])
}

// SaveEnrichment stores an enrichment stamped with the current content hash
// of its issue (looked up from the index).
func (s *Store) SaveEnrichment(e Enrichment) error {
	hash := ""
	if row, err := s.GetIssue(e.IssueID); err == nil {
		hash = IssueContentHash(row.Title, row.Description)
	}
	_, err := s.db.Exec(`INSERT INTO enrichments (issue_id, summary, verdict, reasoning, confidence, model, created_at, issue_hash)
	  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	  ON CONFLICT(issue_id) DO UPDATE SET summary = excluded.summary, verdict = excluded.verdict,
	    reasoning = excluded.reasoning, confidence = excluded.confidence, model = excluded.model,
	    created_at = excluded.created_at, issue_hash = excluded.issue_hash`,
		e.IssueID, e.Summary, e.Verdict, e.Reasoning, e.Confidence, e.Model, now(), hash)
	return err
}

func (s *Store) GetEnrichment(issueID string) (*Enrichment, error) {
	var e Enrichment
	var report, hash sql.NullString
	err := s.db.QueryRow(`SELECT issue_id, COALESCE(summary,''), COALESCE(verdict,''),
	  COALESCE(reasoning,''), COALESCE(confidence,0), COALESCE(model,''), created_at, report_json, issue_hash
	  FROM enrichments WHERE issue_id = ?`, issueID).
		Scan(&e.IssueID, &e.Summary, &e.Verdict, &e.Reasoning, &e.Confidence, &e.Model, &e.CreatedAt, &report, &hash)
	if report.Valid && report.String != "" {
		e.Report = json.RawMessage(report.String)
	}
	if err == nil && hash.Valid && hash.String != "" {
		if row, ierr := s.GetIssue(issueID); ierr == nil {
			e.Stale = hash.String != IssueContentHash(row.Title, row.Description)
		}
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// AttachEnrichments hydrates queue rows with their stored enrichments and
// computes staleness against each row's current content.
func (s *Store) AttachEnrichments(rows []IssueRow) error {
	for i := range rows {
		e, err := s.GetEnrichment(rows[i].ID)
		if err != nil {
			return err
		}
		rows[i].Enrichment = e
	}
	return nil
}
