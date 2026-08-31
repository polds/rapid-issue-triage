package store

import (
	"cmp"
	"database/sql"
	"slices"
	"time"
)

// TokenUsage is one LLM call made on behalf of AI enrichment, stamped with
// the responsibility that spent it: the fast enricher, one deep-run scout, or
// the synthesis pass. Counts come from the Claude Code CLI's own accounting
// (the `usage` object on its final result), never from an estimate of ours.
//
// Rows are written once, after the call returns, and never updated. Nothing
// reads them back per-issue — they exist only to aggregate on the reports
// page, so a pruned issue does not invalidate them.
type TokenUsage struct {
	ID      int64  `json:"id"`
	RunID   string `json:"runId,omitempty"` // deep run id; empty for fast enrichment
	IssueID string `json:"issueId"`
	Mode    string `json:"mode"`  // fast | deep
	Agent   string `json:"agent"` // fast | repo | github | linear | datadog | gcloud | synthesis
	Model   string `json:"model,omitempty"`
	// CostUSD is the CLI's list-price figure. Under a Claude subscription no
	// money changes hands per call, so it is an equivalent, not a bill.
	CostUSD       float64 `json:"costUsd"`
	Input         int64   `json:"input"`
	Output        int64   `json:"output"`
	CacheCreation int64   `json:"cacheCreation"`
	CacheRead     int64   `json:"cacheRead"`
	DurationMS    int64   `json:"durationMs"`
	CreatedAt     string  `json:"createdAt"`
}

// Empty reports whether the CLI returned no accounting at all — a call that
// failed before it spent anything. Those are not worth a row.
func (u TokenUsage) Empty() bool {
	return u.Input == 0 && u.Output == 0 && u.CacheCreation == 0 && u.CacheRead == 0
}

// TokenTotals is one summed bucket of usage. Total is the sum of all four
// token kinds, which is what "how much did this cost me" means to a reader;
// the individual kinds are kept because cache reads dominate the count while
// costing a fraction of fresh input.
type TokenTotals struct {
	Calls         int64   `json:"calls"`
	Input         int64   `json:"input"`
	Output        int64   `json:"output"`
	CacheCreation int64   `json:"cacheCreation"`
	CacheRead     int64   `json:"cacheRead"`
	Total         int64   `json:"total"`
	CostUSD       float64 `json:"costUsd"`
}

// TokenSlice is a totals bucket labeled by whatever it was grouped on —
// an agent for the by-responsibility breakdown, a mode for fast vs deep.
type TokenSlice struct {
	Key string `json:"key"`
	TokenTotals
}

// TokenUsageReport is the aggregate served to the reports page.
type TokenUsageReport struct {
	Totals TokenTotals `json:"totals"`
	Today  TokenTotals `json:"today"`
	Week   TokenTotals `json:"week"`
	// ByAgent is the "by responsibility" breakdown, heaviest spender first.
	ByAgent []TokenSlice `json:"byAgent"`
	ByMode  []TokenSlice `json:"byMode"`
	Models  []string     `json:"models"`
	// Issues counts the distinct issues enrichment has been run over, so the
	// page can quote a per-issue average.
	Issues int64 `json:"issues"`
	// Since is the timestamp of the oldest recorded call. Enrichments that
	// ran before usage was tracked have no rows, so the page must say what
	// window the numbers actually cover.
	Since string `json:"since,omitempty"`
}

// RecordTokenUsage appends one call's accounting. Calls that reported nothing
// are dropped rather than stored as zero rows, which would inflate the call
// count on the reports page.
func (s *Store) RecordTokenUsage(u TokenUsage) error {
	if u.Empty() {
		return nil
	}
	_, err := s.db.Exec(`INSERT INTO token_usage
	  (run_id, issue_id, mode, agent, model, input_tokens, output_tokens,
	   cache_creation_tokens, cache_read_tokens, cost_usd, duration_ms, created_at)
	  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.RunID, u.IssueID, u.Mode, u.Agent, u.Model, u.Input, u.Output,
		u.CacheCreation, u.CacheRead, u.CostUSD, u.DurationMS, now())
	return err
}

// TokenUsageReport aggregates every recorded call for the reports page.
func (s *Store) TokenUsageReport() (TokenUsageReport, error) {
	var rep TokenUsageReport
	nowT := time.Now()
	dayStart := time.Date(nowT.Year(), nowT.Month(), nowT.Day(), 0, 0, 0, 0, nowT.Location())
	weekStart := dayStart.AddDate(0, 0, -int(nowT.Weekday()))

	var err error
	if rep.Totals, err = s.tokenTotals(time.Time{}); err != nil {
		return rep, err
	}
	if rep.Today, err = s.tokenTotals(dayStart); err != nil {
		return rep, err
	}
	if rep.Week, err = s.tokenTotals(weekStart); err != nil {
		return rep, err
	}
	if rep.ByAgent, err = s.tokenByAgent(); err != nil {
		return rep, err
	}
	if rep.ByMode, err = s.tokenByMode(); err != nil {
		return rep, err
	}
	if rep.Models, err = s.tokenModels(); err != nil {
		return rep, err
	}
	if rep.Issues, rep.Since, err = s.tokenScope(); err != nil {
		return rep, err
	}
	return rep, nil
}

func (s *Store) tokenTotals(since time.Time) (TokenTotals, error) {
	var t TokenTotals
	err := s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(input_tokens),0),
	  COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0),
	  COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0)
	  FROM token_usage WHERE created_at >= ?`, since.UTC().Format(time.RFC3339)).
		Scan(&t.Calls, &t.Input, &t.Output, &t.CacheCreation, &t.CacheRead, &t.CostUSD)
	t.Total = t.Input + t.Output + t.CacheCreation + t.CacheRead
	return t, err
}

func (s *Store) tokenByAgent() ([]TokenSlice, error) {
	return s.tokenSlices(`SELECT agent, COUNT(*), COALESCE(SUM(input_tokens),0),
	  COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0),
	  COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0)
	  FROM token_usage GROUP BY agent`)
}

func (s *Store) tokenByMode() ([]TokenSlice, error) {
	return s.tokenSlices(`SELECT mode, COUNT(*), COALESCE(SUM(input_tokens),0),
	  COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0),
	  COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0)
	  FROM token_usage GROUP BY mode`)
}

// tokenSlices runs one of the two grouped queries above and sorts the result
// heaviest-first, so the page never has to decide the order.
func (s *Store) tokenSlices(query string) ([]TokenSlice, error) {
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TokenSlice{}
	for rows.Next() {
		var sl TokenSlice
		if err := rows.Scan(&sl.Key, &sl.Calls, &sl.Input, &sl.Output,
			&sl.CacheCreation, &sl.CacheRead, &sl.CostUSD); err != nil {
			return nil, err
		}
		sl.Total = sl.Input + sl.Output + sl.CacheCreation + sl.CacheRead
		out = append(out, sl)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slices.SortFunc(out, func(a, b TokenSlice) int { return cmp.Compare(b.Total, a.Total) })
	return out, nil
}

func (s *Store) tokenModels() ([]string, error) {
	rows, err := s.db.Query(`SELECT DISTINCT model FROM token_usage
	  WHERE model IS NOT NULL AND model != '' ORDER BY model`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// tokenScope returns how many distinct issues have recorded usage and when
// tracking effectively began.
func (s *Store) tokenScope() (int64, string, error) {
	var issues int64
	var since sql.NullString
	err := s.db.QueryRow(`SELECT COUNT(DISTINCT issue_id), MIN(created_at) FROM token_usage`).
		Scan(&issues, &since)
	return issues, since.String, err
}
