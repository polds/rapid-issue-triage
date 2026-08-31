package store

import (
	"database/sql"
	"time"
)

func (s *Store) LogActivity(a Activity) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO activity
	  (issue_id, issue_identifier, issue_title, kind, outcome, detail_json, prev_json, duration_ms, created_at)
	  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.IssueID, a.IssueIdentifier, a.IssueTitle, a.Kind, a.Outcome,
		a.DetailJSON, a.PrevJSON, a.DurationMS, now())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) GetActivity(id int64) (Activity, error) {
	var a Activity
	var detail, prev sql.NullString
	err := s.db.QueryRow(`SELECT id, issue_id, issue_identifier, issue_title, kind, outcome,
	  detail_json, prev_json, undone, duration_ms, created_at FROM activity WHERE id = ?`, id).
		Scan(&a.ID, &a.IssueID, &a.IssueIdentifier, &a.IssueTitle, &a.Kind, &a.Outcome,
			&detail, &prev, &a.Undone, &a.DurationMS, &a.CreatedAt)
	if err != nil {
		return a, errRow(err)
	}
	a.DetailJSON, a.PrevJSON = detail.String, prev.String
	return a, nil
}

func (s *Store) MarkActivityUndone(id int64) error {
	_, err := s.db.Exec(`UPDATE activity SET undone = 1 WHERE id = ?`, id)
	return err
}

// Report aggregates the activity log into the gamified stats payload.
func (s *Store) Report() (map[string]any, error) {
	out := map[string]any{}
	nowT := time.Now()
	dayStart := time.Date(nowT.Year(), nowT.Month(), nowT.Day(), 0, 0, 0, 0, nowT.Location())
	weekStart := dayStart.AddDate(0, 0, -int(nowT.Weekday()))

	var err error
	if out["today"], err = s.activityCount(dayStart, true); err != nil {
		return nil, err
	}
	if out["week"], err = s.activityCount(weekStart, true); err != nil {
		return nil, err
	}
	if out["allTime"], err = s.activityCount(time.Time{}, true); err != nil {
		return nil, err
	}
	if out["byDay"], err = s.activityByDay(dayStart, 14); err != nil {
		return nil, err
	}
	if out["streakDays"], err = s.activityStreak(dayStart); err != nil {
		return nil, err
	}
	if out["byOutcome"], err = s.activityByOutcome(); err != nil {
		return nil, err
	}
	if err := s.activitySpeed(out); err != nil {
		return nil, err
	}
	if out["recent"], err = s.activityFeed(30); err != nil {
		return nil, err
	}
	if out["tokens"], err = s.TokenUsageReport(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) activityCount(since time.Time, triageOnly bool) (int, error) {
	q := `SELECT COUNT(*) FROM activity WHERE undone = 0 AND created_at >= ?`
	if triageOnly {
		q += ` AND kind IN ('macro', 'edit')`
	}
	var n int
	err := s.db.QueryRow(q, since.UTC().Format(time.RFC3339)).Scan(&n)
	return n, err
}

func (s *Store) activityByDay(dayStart time.Time, days int) ([]map[string]any, error) {
	out := make([]map[string]any, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := dayStart.AddDate(0, 0, -i)
		n, err := s.triageCountBetween(d, d.AddDate(0, 0, 1))
		if err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"date": d.Format("2006-01-02"), "count": n})
	}
	return out, nil
}

func (s *Store) activityStreak(dayStart time.Time) (int, error) {
	streak := 0
	for i := 0; ; i++ {
		d := dayStart.AddDate(0, 0, -i)
		n, err := s.triageCountBetween(d, d.AddDate(0, 0, 1))
		if err != nil {
			return 0, err
		}
		if n == 0 {
			if i == 0 {
				continue
			}
			break
		}
		streak++
		if i > 3650 {
			break
		}
	}
	return streak, nil
}

func (s *Store) triageCountBetween(from, to time.Time) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM activity WHERE undone = 0
	  AND kind IN ('macro','edit') AND created_at >= ? AND created_at < ?`,
		from.UTC().Format(time.RFC3339), to.UTC().Format(time.RFC3339)).Scan(&n)
	return n, err
}

func (s *Store) activityByOutcome() (map[string]int, error) {
	rows, err := s.db.Query(`SELECT outcome, COUNT(*) FROM activity WHERE undone = 0 GROUP BY outcome`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byOutcome := map[string]int{}
	for rows.Next() {
		var o string
		var n int
		if err := rows.Scan(&o, &n); err != nil {
			return nil, err
		}
		byOutcome[o] = n
	}
	return byOutcome, rows.Err()
}

func (s *Store) activitySpeed(out map[string]any) error {
	var avg, fastest sql.NullFloat64
	err := s.db.QueryRow(`SELECT AVG(duration_ms), MIN(duration_ms) FROM activity
	  WHERE undone = 0 AND kind IN ('macro','edit') AND duration_ms > 0`).Scan(&avg, &fastest)
	if err != nil {
		return err
	}
	out["avgMs"] = avg.Float64
	out["fastestMs"] = fastest.Float64
	return nil
}

func (s *Store) activityFeed(limit int) ([]Activity, error) {
	rows, err := s.db.Query(`SELECT id, issue_id, issue_identifier, issue_title, kind, outcome,
	  COALESCE(detail_json,''), undone, duration_ms, created_at
	  FROM activity ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	feed := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.IssueID, &a.IssueIdentifier, &a.IssueTitle, &a.Kind,
			&a.Outcome, &a.DetailJSON, &a.Undone, &a.DurationMS, &a.CreatedAt); err != nil {
			return nil, err
		}
		feed = append(feed, a)
	}
	return feed, rows.Err()
}
