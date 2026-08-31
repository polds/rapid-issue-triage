// Package store owns the local sqlite database: the issue index, skip/snooze
// state, macros, enrichments, and the activity log that powers reports.
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	// modernc sqlite is happiest with a single writer connection.
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	// Additive migrations for existing databases; duplicate-column errors are fine.
	_, _ = s.db.Exec(`ALTER TABLE enrichments ADD COLUMN report_json TEXT`)
	_, _ = s.db.Exec(`ALTER TABLE enrichments ADD COLUMN issue_hash TEXT`)
	_, _ = s.db.Exec(`ALTER TABLE labels ADD COLUMN parent_id TEXT`)
	return nil
}

const schema = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_states (
  id TEXT PRIMARY KEY, team_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL,
  color TEXT, position REAL
);
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY, team_id TEXT, name TEXT NOT NULL, color TEXT,
  is_group INTEGER DEFAULT 0, parent_id TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT
);
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY, team_id TEXT, number REAL, name TEXT,
  starts_at TEXT, ends_at TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT, display_name TEXT, email TEXT,
  is_me INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  team_id TEXT, state_id TEXT, assignee_id TEXT, project_id TEXT, cycle_id TEXT,
  creator_name TEXT,
  priority INTEGER DEFAULT 0,
  estimate REAL,
  url TEXT,
  created_at TEXT, updated_at TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  sync_gen INTEGER NOT NULL DEFAULT 0,
  skip_count INTEGER NOT NULL DEFAULT 0,
  snoozed_until TEXT,
  triaged_at TEXT,
  context_json TEXT,
  context_fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_queue ON issues (triaged_at, team_id, skip_count);

CREATE TABLE IF NOT EXISTS enrichments (
  issue_id TEXT PRIMARY KEY,
  summary TEXT, verdict TEXT, reasoning TEXT, confidence REAL,
  model TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS macros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_binding TEXT,
  outcome TEXT NOT NULL DEFAULT 'accepted',
  steps_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL,
  issue_identifier TEXT NOT NULL,
  issue_title TEXT NOT NULL,
  kind TEXT NOT NULL,      -- macro | skip | snooze | edit | undo
  outcome TEXT NOT NULL,   -- accepted | cancelled | snoozed | skipped | edited | undone | ...
  detail_json TEXT,
  prev_json TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity (created_at);

-- Deep enrichment: one row per run, plus its full action log.
CREATE TABLE IF NOT EXISTS enrich_runs (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  issue_identifier TEXT NOT NULL,
  mode TEXT NOT NULL,              -- fast | deep
  status TEXT NOT NULL,            -- running | done | error | cancelled
  sources_json TEXT,               -- enabled sources snapshot
  report_json TEXT,                -- final structured report
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrich_runs_issue ON enrich_runs (issue_id, started_at);

CREATE TABLE IF NOT EXISTS enrich_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  agent TEXT,                      -- orchestrator | repo | github | linear | datadog | gcloud | synthesis
  kind TEXT NOT NULL,              -- status | prompt | thought | tool_call | tool_result | result | report | error
  payload TEXT NOT NULL,           -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enrich_events_run ON enrich_events (run_id, seq);

-- One row per LLM call made by AI enrichment, tagged with the agent that
-- spent it, so the reports page can aggregate what enrichment costs.
-- Counts are the Claude Code CLI's own accounting, not an estimate.
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,                     -- deep run id; empty for fast enrichment
  issue_id TEXT NOT NULL,
  mode TEXT NOT NULL,              -- fast | deep
  agent TEXT NOT NULL,             -- fast | repo | github | linear | datadog | gcloud | synthesis
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage (created_at);
`

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// --- meta ---

func (s *Store) SetMeta(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO meta (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func (s *Store) GetMeta(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// JSON helpers.
func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}

// ErrNotFound reports a row the index does not hold. It is worth
// distinguishing from a database fault: the syncer prunes every issue that
// falls out of the index filter, so a missing row is an ordinary race with a
// background sync, not a failure.
var ErrNotFound = errors.New("not found")

func errRow(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
