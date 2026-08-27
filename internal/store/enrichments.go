package store

import (
	"database/sql"
	"encoding/json"
)

func (s *Store) SaveEnrichment(e Enrichment) error {
	_, err := s.db.Exec(`INSERT INTO enrichments (issue_id, summary, verdict, reasoning, confidence, model, created_at)
	  VALUES (?, ?, ?, ?, ?, ?, ?)
	  ON CONFLICT(issue_id) DO UPDATE SET summary = excluded.summary, verdict = excluded.verdict,
	    reasoning = excluded.reasoning, confidence = excluded.confidence, model = excluded.model,
	    created_at = excluded.created_at`,
		e.IssueID, e.Summary, e.Verdict, e.Reasoning, e.Confidence, e.Model, now())
	return err
}

func (s *Store) GetEnrichment(issueID string) (*Enrichment, error) {
	var e Enrichment
	var report sql.NullString
	err := s.db.QueryRow(`SELECT issue_id, COALESCE(summary,''), COALESCE(verdict,''),
	  COALESCE(reasoning,''), COALESCE(confidence,0), COALESCE(model,''), created_at, report_json
	  FROM enrichments WHERE issue_id = ?`, issueID).
		Scan(&e.IssueID, &e.Summary, &e.Verdict, &e.Reasoning, &e.Confidence, &e.Model, &e.CreatedAt, &report)
	if report.Valid && report.String != "" {
		e.Report = json.RawMessage(report.String)
	}
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// AttachEnrichments hydrates queue rows in one query.
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
