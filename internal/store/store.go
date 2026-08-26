// Package store owns the local sqlite database: the issue index, skip/snooze
// state, macros, enrichments, and the activity log that powers reports.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
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
	_, err := s.db.Exec(schema)
	return err
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
  is_group INTEGER DEFAULT 0
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
	if err == sql.ErrNoRows {
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

func errRow(err error) error {
	if err == sql.ErrNoRows {
		return fmt.Errorf("not found")
	}
	return err
}
