package store

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// UpsertIssue writes a synced issue, preserving local triage bookkeeping
// (skip_count, snoozed_until). A fresh sync clears triaged_at: if the issue
// still matches the untriaged filter upstream, it belongs back in the queue.
func (s *Store) UpsertIssue(tx *sql.Tx, gen int64, r IssueRow) error {
	_, err := tx.Exec(`
INSERT INTO issues (id, identifier, title, description, team_id, state_id, assignee_id,
  project_id, cycle_id, creator_name, priority, estimate, url, created_at, updated_at,
  labels_json, sync_gen)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  identifier = excluded.identifier, title = excluded.title,
  description = excluded.description, team_id = excluded.team_id,
  state_id = excluded.state_id, assignee_id = excluded.assignee_id,
  project_id = excluded.project_id, cycle_id = excluded.cycle_id,
  creator_name = excluded.creator_name, priority = excluded.priority,
  estimate = excluded.estimate, url = excluded.url,
  created_at = excluded.created_at, updated_at = excluded.updated_at,
  labels_json = excluded.labels_json, sync_gen = excluded.sync_gen,
  triaged_at = NULL`,
		r.ID, r.Identifier, r.Title, r.Description, r.TeamID, r.StateID, r.AssigneeID,
		r.ProjectID, r.CycleID, r.CreatorName, r.Priority, r.Estimate, r.URL,
		r.CreatedAt, r.UpdatedAt, mustJSON(r.Labels), gen)
	return err
}

func (s *Store) Begin() (*sql.Tx, error) { return s.db.Begin() }

// PruneStale removes issues not seen in the latest sync generation: they no
// longer match the untriaged filter (triaged elsewhere, deleted, done).
func (s *Store) PruneStale(gen int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM issues WHERE sync_gen < ?`, gen)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

const issueCols = `id, identifier, title, description, team_id, state_id, assignee_id,
  project_id, cycle_id, creator_name, priority, estimate, url, created_at, updated_at,
  labels_json, skip_count, COALESCE(snoozed_until, ''), COALESCE(triaged_at, '')`

func scanIssue(sc interface{ Scan(...any) error }) (IssueRow, error) {
	var r IssueRow
	var labels string
	var desc, team, state, assignee, project, cycle, creator, url, created, updated sql.NullString
	err := sc.Scan(&r.ID, &r.Identifier, &r.Title, &desc, &team, &state, &assignee,
		&project, &cycle, &creator, &r.Priority, &r.Estimate, &url, &created, &updated,
		&labels, &r.SkipCount, &r.SnoozedTil, &r.TriagedAt)
	if err != nil {
		return r, err
	}
	r.Description, r.TeamID, r.StateID, r.AssigneeID = desc.String, team.String, state.String, assignee.String
	r.ProjectID, r.CycleID, r.CreatorName, r.URL = project.String, cycle.String, creator.String, url.String
	r.CreatedAt, r.UpdatedAt = created.String, updated.String
	if err := json.Unmarshal([]byte(labels), &r.Labels); err != nil || r.Labels == nil {
		r.Labels = []LabelChip{}
	}
	return r, nil
}

// Queue returns the next batch of untriaged issues: least-skipped first, then
// pseudo-random. exclude lets the client omit cards already in its deck.
func (s *Store) Queue(f QueueFilter, exclude []string, limit int) ([]IssueRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	args := []any{}
	q := `SELECT ` + issueCols + ` FROM issues
	  WHERE triaged_at IS NULL
	    AND (snoozed_until IS NULL OR snoozed_until < ?)`
	args = append(args, now())
	fw, fargs := f.where()
	q += fw
	args = append(args, fargs...)
	if len(exclude) > 0 {
		q += ` AND id NOT IN (?` + strings.Repeat(",?", len(exclude)-1) + `)`
		for _, id := range exclude {
			args = append(args, id)
		}
	}
	q += ` ORDER BY skip_count ASC, RANDOM() LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IssueRow{}
	for rows.Next() {
		r, err := scanIssue(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetIssue(id string) (IssueRow, error) {
	row := s.db.QueryRow(`SELECT `+issueCols+` FROM issues WHERE id = ?`, id)
	r, err := scanIssue(row)
	return r, errRow(err)
}

// QueueCount reports remaining untriaged issues (excluding active snoozes)
// under the given view filter.
func (s *Store) QueueCount(f QueueFilter) (int, error) {
	q := `SELECT COUNT(*) FROM issues WHERE triaged_at IS NULL
	  AND (snoozed_until IS NULL OR snoozed_until < ?)`
	args := []any{now()}
	fw, fargs := f.where()
	q += fw
	args = append(args, fargs...)
	var n int
	err := s.db.QueryRow(q, args...).Scan(&n)
	return n, err
}

func (s *Store) MarkSkipped(id string) error {
	_, err := s.db.Exec(`UPDATE issues SET skip_count = skip_count + 1 WHERE id = ?`, id)
	return err
}

func (s *Store) MarkSnoozed(id string, until time.Time) error {
	_, err := s.db.Exec(`UPDATE issues SET snoozed_until = ? WHERE id = ?`,
		until.UTC().Format(time.RFC3339), id)
	return err
}

func (s *Store) MarkTriaged(id string) error {
	_, err := s.db.Exec(`UPDATE issues SET triaged_at = ? WHERE id = ?`, now(), id)
	return err
}

// RestoreIssue puts back pre-action field values after an undo.
func (s *Store) RestoreIssue(r IssueRow) error {
	_, err := s.db.Exec(`UPDATE issues SET state_id = ?, assignee_id = ?, project_id = ?,
	  cycle_id = ?, estimate = ?, labels_json = ?, triaged_at = NULLIF(?, ''),
	  snoozed_until = NULLIF(?, ''), skip_count = ? WHERE id = ?`,
		r.StateID, r.AssigneeID, r.ProjectID, r.CycleID, r.Estimate, mustJSON(r.Labels),
		r.TriagedAt, r.SnoozedTil, r.SkipCount, r.ID)
	return err
}

// ApplySyncedIssue overwrites the mutable fields from a fresh Linear response
// after a successful update, and stamps triaged_at when terminal.
func (s *Store) ApplySyncedIssue(r IssueRow, triaged bool) error {
	t := any(nil)
	if triaged {
		t = now()
	}
	_, err := s.db.Exec(`UPDATE issues SET title = ?, state_id = ?, assignee_id = ?,
	  project_id = ?, cycle_id = ?, estimate = ?, labels_json = ?, updated_at = ?,
	  triaged_at = COALESCE(?, triaged_at) WHERE id = ?`,
		r.Title, r.StateID, r.AssigneeID, r.ProjectID, r.CycleID, r.Estimate,
		mustJSON(r.Labels), r.UpdatedAt, t, r.ID)
	return err
}

func (s *Store) SetIssueContext(id, contextJSON string) error {
	_, err := s.db.Exec(`UPDATE issues SET context_json = ?, context_fetched_at = ? WHERE id = ?`,
		contextJSON, now(), id)
	return err
}

func (s *Store) GetIssueContext(id string) (string, string, error) {
	var ctx, at sql.NullString
	err := s.db.QueryRow(`SELECT context_json, context_fetched_at FROM issues WHERE id = ?`, id).Scan(&ctx, &at)
	if err != nil {
		return "", "", errRow(err)
	}
	return ctx.String, at.String, nil
}

// UnenrichedQueueHeads returns ids of upcoming queue items lacking enrichment,
// for background AI prefetch.
func (s *Store) UnenrichedQueueHeads(limit int) ([]string, error) {
	rows, err := s.db.Query(`SELECT i.id FROM issues i
	  LEFT JOIN enrichments e ON e.issue_id = i.id
	  WHERE i.triaged_at IS NULL AND e.issue_id IS NULL
	    AND (i.snoozed_until IS NULL OR i.snoozed_until < ?)
	  ORDER BY i.skip_count ASC, i.created_at ASC LIMIT ?`, now(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) TeamCounts() (map[string]int, error) {
	rows, err := s.db.Query(`SELECT COALESCE(team_id, ''), COUNT(*) FROM issues
	  WHERE triaged_at IS NULL AND (snoozed_until IS NULL OR snoozed_until < ?)
	  GROUP BY team_id`, now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}
