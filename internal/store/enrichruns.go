package store

import (
	"database/sql"
	"encoding/json"
)

type EnrichRun struct {
	ID              string `json:"id"`
	IssueID         string `json:"issueId"`
	IssueIdentifier string `json:"issueIdentifier"`
	Mode            string `json:"mode"`
	Status          string `json:"status"`
	SourcesJSON     string `json:"sources,omitempty"`
	ReportJSON      string `json:"report,omitempty"`
	Error           string `json:"error,omitempty"`
	StartedAt       string `json:"startedAt"`
	FinishedAt      string `json:"finishedAt,omitempty"`
}

type EnrichEvent struct {
	ID      int64           `json:"id"`
	RunID   string          `json:"runId"`
	Seq     int64           `json:"seq"`
	Agent   string          `json:"agent"`
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
	At      string          `json:"at"`
}

func (s *Store) CreateEnrichRun(r EnrichRun) error {
	_, err := s.db.Exec(`INSERT INTO enrich_runs (id, issue_id, issue_identifier, mode, status, sources_json, started_at)
	  VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.IssueID, r.IssueIdentifier, r.Mode, r.Status, r.SourcesJSON, now())
	return err
}

// StartEnrichRun flips a pooled run from "queued" to "running" once a slot
// frees up. started_at deliberately stays at the enqueue time: that is when
// the user asked for the run, and it is what orders the waiting line.
func (s *Store) StartEnrichRun(id string) error {
	_, err := s.db.Exec(`UPDATE enrich_runs SET status = 'running' WHERE id = ?`, id)
	return err
}

func (s *Store) FinishEnrichRun(id, status, reportJSON, errMsg string) error {
	_, err := s.db.Exec(`UPDATE enrich_runs SET status = ?, report_json = ?, error = ?, finished_at = ? WHERE id = ?`,
		status, reportJSON, errMsg, now(), id)
	return err
}

func (s *Store) GetEnrichRun(id string) (EnrichRun, error) {
	var r EnrichRun
	var sources, report, errMsg, finished sql.NullString
	err := s.db.QueryRow(`SELECT id, issue_id, issue_identifier, mode, status, sources_json,
	  report_json, error, started_at, finished_at FROM enrich_runs WHERE id = ?`, id).
		Scan(&r.ID, &r.IssueID, &r.IssueIdentifier, &r.Mode, &r.Status, &sources, &report, &errMsg, &r.StartedAt, &finished)
	if err != nil {
		return r, errRow(err)
	}
	r.SourcesJSON, r.ReportJSON, r.Error, r.FinishedAt = sources.String, report.String, errMsg.String, finished.String
	return r, nil
}

// LatestRunForIssue returns the most recent run id for an issue, if any.
func (s *Store) LatestRunForIssue(issueID string) (EnrichRun, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM enrich_runs WHERE issue_id = ? ORDER BY started_at DESC LIMIT 1`, issueID).Scan(&id)
	if err != nil {
		return EnrichRun{}, errRow(err)
	}
	return s.GetEnrichRun(id)
}

func (s *Store) AppendEnrichEvent(runID string, seq int64, agent, kind string, payload []byte) error {
	_, err := s.db.Exec(`INSERT INTO enrich_events (run_id, seq, agent, kind, payload, created_at)
	  VALUES (?, ?, ?, ?, ?, ?)`, runID, seq, agent, kind, string(payload), now())
	return err
}

// EnrichEvents returns a run's events after the given sequence number.
func (s *Store) EnrichEvents(runID string, afterSeq int64) ([]EnrichEvent, error) {
	rows, err := s.db.Query(`SELECT id, run_id, seq, COALESCE(agent,''), kind, payload, created_at
	  FROM enrich_events WHERE run_id = ? AND seq > ? ORDER BY seq`, runID, afterSeq)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EnrichEvent{}
	for rows.Next() {
		var e EnrichEvent
		var payload string
		if err := rows.Scan(&e.ID, &e.RunID, &e.Seq, &e.Agent, &e.Kind, &payload, &e.At); err != nil {
			return nil, err
		}
		e.Payload = json.RawMessage(payload)
		out = append(out, e)
	}
	return out, rows.Err()
}

// SaveEnrichmentReport upserts the structured deep report onto the
// enrichment row so cards render it alongside the fast summary fields.
func (s *Store) SaveEnrichmentReport(issueID, reportJSON string) error {
	_, err := s.db.Exec(`INSERT INTO enrichments (issue_id, created_at, report_json)
	  VALUES (?, ?, ?)
	  ON CONFLICT(issue_id) DO UPDATE SET report_json = excluded.report_json, created_at = excluded.created_at`,
		issueID, now(), reportJSON)
	return err
}

// FailOrphanRuns marks unfinished runs from previous processes as failed.
// A queued run is just as orphaned as a running one: the pool that would have
// dispatched it died with the process.
func (s *Store) FailOrphanRuns() (int64, error) {
	res, err := s.db.Exec(`UPDATE enrich_runs SET status = 'error',
	  error = 'server restarted before the run finished', finished_at = ?
	  WHERE status IN ('running', 'queued')`, now())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
