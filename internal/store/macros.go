package store

import "encoding/json"

func (s *Store) ListMacros() ([]Macro, error) {
	rows, err := s.db.Query(`SELECT id, name, COALESCE(key_binding,''), outcome, steps_json, position
	  FROM macros ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Macro{}
	for rows.Next() {
		var m Macro
		var steps string
		if err := rows.Scan(&m.ID, &m.Name, &m.KeyBinding, &m.Outcome, &steps, &m.Position); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(steps), &m.Steps); err != nil {
			m.Steps = nil
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) GetMacro(id int64) (Macro, error) {
	var m Macro
	var steps string
	err := s.db.QueryRow(`SELECT id, name, COALESCE(key_binding,''), outcome, steps_json, position
	  FROM macros WHERE id = ?`, id).Scan(&m.ID, &m.Name, &m.KeyBinding, &m.Outcome, &steps, &m.Position)
	if err != nil {
		return m, errRow(err)
	}
	_ = json.Unmarshal([]byte(steps), &m.Steps)
	return m, nil
}

func (s *Store) CreateMacro(m Macro) (Macro, error) {
	res, err := s.db.Exec(`INSERT INTO macros (name, key_binding, outcome, steps_json, position)
	  VALUES (?, ?, ?, ?, ?)`, m.Name, m.KeyBinding, m.Outcome, mustJSON(m.Steps), m.Position)
	if err != nil {
		return m, err
	}
	m.ID, _ = res.LastInsertId()
	return m, nil
}

func (s *Store) UpdateMacro(m Macro) error {
	_, err := s.db.Exec(`UPDATE macros SET name = ?, key_binding = ?, outcome = ?,
	  steps_json = ?, position = ? WHERE id = ?`,
		m.Name, m.KeyBinding, m.Outcome, mustJSON(m.Steps), m.Position, m.ID)
	return err
}

func (s *Store) DeleteMacro(id int64) error {
	_, err := s.db.Exec(`DELETE FROM macros WHERE id = ?`, id)
	return err
}
