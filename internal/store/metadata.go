package store

import (
	"database/sql"
	"strings"
)

// Replace-all upserts for workspace metadata. Each runs in the caller's sync
// transaction; tables are small so wholesale replace keeps things simple.

func replaceAll(tx *sql.Tx, table string, insert string, rows [][]any) error {
	if _, err := tx.Exec(`DELETE FROM ` + table); err != nil {
		return err
	}
	stmt, err := tx.Prepare(insert)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range rows {
		if _, err := stmt.Exec(r...); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ReplaceTeams(tx *sql.Tx, rows [][]any) error {
	return replaceAll(tx, "teams", `INSERT INTO teams (id, key, name) VALUES (?, ?, ?)`, rows)
}

func (s *Store) ReplaceStates(tx *sql.Tx, rows [][]any) error {
	return replaceAll(tx, "workflow_states",
		`INSERT INTO workflow_states (id, team_id, name, type, color, position) VALUES (?, ?, ?, ?, ?, ?)`, rows)
}

func (s *Store) ReplaceLabels(tx *sql.Tx, rows [][]any) error {
	return replaceAll(tx, "labels",
		`INSERT INTO labels (id, team_id, name, color, is_group, parent_id) VALUES (?, ?, ?, ?, ?, ?)`, rows)
}

func (s *Store) ReplaceProjects(tx *sql.Tx, rows [][]any) error {
	return replaceAll(tx, "projects", `INSERT INTO projects (id, name, state) VALUES (?, ?, ?)`, rows)
}

func (s *Store) ReplaceCycles(tx *sql.Tx, rows [][]any) error {
	return replaceAll(tx, "cycles",
		`INSERT INTO cycles (id, team_id, number, name, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?)`, rows)
}

func (s *Store) ReplaceUsers(tx *sql.Tx, rows [][]any) error {
	return replaceAll(tx, "users",
		`INSERT INTO users (id, name, display_name, email, is_me) VALUES (?, ?, ?, ?, ?)`, rows)
}

// Metadata returns everything the frontend needs to render pickers.
func (s *Store) Metadata() (map[string]any, error) {
	out := map[string]any{}
	collect := func(key, query string, cols []string) error {
		rows, err := s.db.Query(query)
		if err != nil {
			return err
		}
		defer rows.Close()
		list := []map[string]any{}
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		for rows.Next() {
			if err := rows.Scan(ptrs...); err != nil {
				return err
			}
			m := map[string]any{}
			for i, c := range cols {
				m[c] = vals[i]
			}
			list = append(list, m)
		}
		out[key] = list
		return rows.Err()
	}
	steps := []struct {
		key, q string
		cols   []string
	}{
		{"teams", `SELECT id, key, name FROM teams ORDER BY name`, []string{"id", "key", "name"}},
		{"states", `SELECT id, COALESCE(team_id,''), name, type, COALESCE(color,''), COALESCE(position,0) FROM workflow_states ORDER BY position`, []string{"id", "teamId", "name", "type", "color", "position"}},
		{"labels", `SELECT id, COALESCE(team_id,''), name, COALESCE(color,''), is_group, COALESCE(parent_id,'') FROM labels ORDER BY name`, []string{"id", "teamId", "name", "color", "isGroup", "parentId"}},
		{"projects", `SELECT id, name, COALESCE(state,'') FROM projects ORDER BY name`, []string{"id", "name", "state"}},
		{"cycles", `SELECT id, COALESCE(team_id,''), COALESCE(number,0), COALESCE(name,''), COALESCE(starts_at,''), COALESCE(ends_at,'') FROM cycles ORDER BY starts_at`, []string{"id", "teamId", "number", "name", "startsAt", "endsAt"}},
		{"users", `SELECT id, COALESCE(name,''), COALESCE(display_name,''), COALESCE(email,''), is_me FROM users ORDER BY display_name`, []string{"id", "name", "displayName", "email", "isMe"}},
	}
	for _, st := range steps {
		if err := collect(st.key, st.q, st.cols); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Lookups used by macro/op resolution.

func (s *Store) LabelIDByName(teamID, name string) (string, error) {
	var id string
	// Prefer a team label, fall back to a workspace label.
	err := s.db.QueryRow(`SELECT id FROM labels
	  WHERE name = ? COLLATE NOCASE AND (team_id = ? OR team_id IS NULL OR team_id = '')
	  ORDER BY CASE WHEN team_id = ? THEN 0 ELSE 1 END LIMIT 1`, name, teamID, teamID).Scan(&id)
	return id, errRow(err)
}

// LabelGroupMember is one label's membership in a Linear label group. Groups
// are mutually exclusive: Linear rejects an update carrying two children of
// the same group.
type LabelGroupMember struct {
	ID        string
	Name      string
	GroupID   string
	GroupName string
}

// LabelGroupsFor returns, for the given label ids, only those that belong to a
// label group. Labels that are ungrouped — or whose group is not indexed yet —
// are simply absent from the result.
func (s *Store) LabelGroupsFor(ids []string) ([]LabelGroupMember, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	q := `SELECT l.id, l.name, g.id, g.name FROM labels l
	  JOIN labels g ON g.id = l.parent_id
	  WHERE l.id IN (?` + strings.Repeat(", ?", len(ids)-1) + `)`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LabelGroupMember
	for rows.Next() {
		var m LabelGroupMember
		if err := rows.Scan(&m.ID, &m.Name, &m.GroupID, &m.GroupName); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) StateIDByName(teamID, name string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM workflow_states
	  WHERE team_id = ? AND name = ? COLLATE NOCASE LIMIT 1`, teamID, name).Scan(&id)
	return id, errRow(err)
}

func (s *Store) StateIDByType(teamID, typ string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM workflow_states
	  WHERE team_id = ? AND type = ? ORDER BY position LIMIT 1`, teamID, typ).Scan(&id)
	return id, errRow(err)
}

func (s *Store) StateType(stateID string) (string, error) {
	var t string
	err := s.db.QueryRow(`SELECT type FROM workflow_states WHERE id = ?`, stateID).Scan(&t)
	return t, errRow(err)
}

func (s *Store) ActiveCycleID(teamID, nowISO string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM cycles
	  WHERE team_id = ? AND starts_at <= ? AND ends_at > ? ORDER BY starts_at LIMIT 1`,
		teamID, nowISO, nowISO).Scan(&id)
	return id, errRow(err)
}

func (s *Store) MyUserID() (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM users WHERE is_me = 1 LIMIT 1`).Scan(&id)
	return id, errRow(err)
}
