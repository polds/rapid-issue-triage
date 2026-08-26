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

	count := func(since time.Time, triageOnly bool) (int, error) {
		q := `SELECT COUNT(*) FROM activity WHERE undone = 0 AND created_at >= ?`
		if triageOnly {
			q += ` AND kind IN ('macro', 'edit')`
		}
		var n int
		err := s.db.QueryRow(q, since.UTC().Format(time.RFC3339)).Scan(&n)
		return n, err
	}
	var err error
	if out["today"], err = count(dayStart, true); err != nil {
		return nil, err
	}
	if out["week"], err = count(weekStart, true); err != nil {
		return nil, err
	}
	if out["allTime"], err = count(time.Time{}, true); err != nil {
		return nil, err
	}

	// Per-day triage counts for the last 14 days (local days).
	days := []map[string]any{}
	for i := 13; i >= 0; i-- {
		d := dayStart.AddDate(0, 0, -i)
		var n int
		err := s.db.QueryRow(`SELECT COUNT(*) FROM activity WHERE undone = 0
		  AND kind IN ('macro','edit') AND created_at >= ? AND created_at < ?`,
			d.UTC().Format(time.RFC3339), d.AddDate(0, 0, 1).UTC().Format(time.RFC3339)).Scan(&n)
		if err != nil {
			return nil, err
		}
		days = append(days, map[string]any{"date": d.Format("2006-01-02"), "count": n})
	}
	out["byDay"] = days

	// Streak: consecutive days (ending today or yesterday) with >= 1 triage.
	streak := 0
	for i := 0; ; i++ {
		d := dayStart.AddDate(0, 0, -i)
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM activity WHERE undone = 0
		  AND kind IN ('macro','edit') AND created_at >= ? AND created_at < ?`,
			d.UTC().Format(time.RFC3339), d.AddDate(0, 0, 1).UTC().Format(time.RFC3339)).Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			if i == 0 {
				continue // today can still be zero without breaking the streak
			}
			break
		}
		streak++
		if i > 3650 {
			break
		}
	}
	out["streakDays"] = streak

	// Outcome breakdown.
	rows, err := s.db.Query(`SELECT outcome, COUNT(*) FROM activity WHERE undone = 0 GROUP BY outcome`)
	if err != nil {
		return nil, err
	}
	byOutcome := map[string]int{}
	for rows.Next() {
		var o string
		var n int
		if err := rows.Scan(&o, &n); err != nil {
			rows.Close()
			return nil, err
		}
		byOutcome[o] = n
	}
	rows.Close()
	out["byOutcome"] = byOutcome

	// Speed stats over triage actions with a recorded duration.
	var avg, fastest sql.NullFloat64
	err = s.db.QueryRow(`SELECT AVG(duration_ms), MIN(duration_ms) FROM activity
	  WHERE undone = 0 AND kind IN ('macro','edit') AND duration_ms > 0`).Scan(&avg, &fastest)
	if err != nil {
		return nil, err
	}
	out["avgMs"] = avg.Float64
	out["fastestMs"] = fastest.Float64

	// Recent activity feed.
	feed := []Activity{}
	rows, err = s.db.Query(`SELECT id, issue_id, issue_identifier, issue_title, kind, outcome,
	  COALESCE(detail_json,''), undone, duration_ms, created_at
	  FROM activity ORDER BY id DESC LIMIT 30`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.IssueID, &a.IssueIdentifier, &a.IssueTitle, &a.Kind,
			&a.Outcome, &a.DetailJSON, &a.Undone, &a.DurationMS, &a.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		feed = append(feed, a)
	}
	rows.Close()
	out["recent"] = feed
	return out, nil
}
