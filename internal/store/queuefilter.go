package store

import (
	"fmt"
	"strings"
)

// QueueFilter narrows the local queue view. All predicates AND together;
// label matching is by name (case-insensitive) via json_each over labels_json.
type QueueFilter struct {
	TeamIDs       []string
	ExcludeTeams  []string
	Labels        []string // must have at least one of these label names
	ExcludeLabels []string // must have none of these label names
	Priorities    []int
	Search        string // matches identifier or title, case-insensitive
}

func (f QueueFilter) Empty() bool {
	return len(f.TeamIDs) == 0 && len(f.ExcludeTeams) == 0 && len(f.Labels) == 0 &&
		len(f.ExcludeLabels) == 0 && len(f.Priorities) == 0 && strings.TrimSpace(f.Search) == ""
}

func placeholders(n int) string {
	return "?" + strings.Repeat(",?", n-1)
}

// where returns SQL fragments (prefixed with " AND ...") plus bind args.
func (f QueueFilter) where() (string, []any) {
	var sb strings.Builder
	var args []any
	if len(f.TeamIDs) > 0 {
		fmt.Fprintf(&sb, " AND team_id IN (%s)", placeholders(len(f.TeamIDs)))
		for _, t := range f.TeamIDs {
			args = append(args, t)
		}
	}
	if len(f.ExcludeTeams) > 0 {
		fmt.Fprintf(&sb, " AND team_id NOT IN (%s)", placeholders(len(f.ExcludeTeams)))
		for _, t := range f.ExcludeTeams {
			args = append(args, t)
		}
	}
	if len(f.Priorities) > 0 {
		fmt.Fprintf(&sb, " AND priority IN (%s)", placeholders(len(f.Priorities)))
		for _, p := range f.Priorities {
			args = append(args, p)
		}
	}
	if len(f.Labels) > 0 {
		fmt.Fprintf(&sb, ` AND EXISTS (SELECT 1 FROM json_each(labels_json) je
		  WHERE lower(json_extract(je.value, '$.name')) IN (%s))`, placeholders(len(f.Labels)))
		for _, l := range f.Labels {
			args = append(args, strings.ToLower(l))
		}
	}
	if len(f.ExcludeLabels) > 0 {
		fmt.Fprintf(&sb, ` AND NOT EXISTS (SELECT 1 FROM json_each(labels_json) je
		  WHERE lower(json_extract(je.value, '$.name')) IN (%s))`, placeholders(len(f.ExcludeLabels)))
		for _, l := range f.ExcludeLabels {
			args = append(args, strings.ToLower(l))
		}
	}
	if q := strings.TrimSpace(f.Search); q != "" {
		sb.WriteString(` AND (identifier LIKE ? COLLATE NOCASE OR title LIKE ? COLLATE NOCASE)`)
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	return sb.String(), args
}
