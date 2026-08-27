package store

import "encoding/json"

// View models served to the frontend.

type LabelChip struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type IssueRow struct {
	ID          string      `json:"id"`
	Identifier  string      `json:"identifier"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	TeamID      string      `json:"teamId"`
	StateID     string      `json:"stateId"`
	AssigneeID  string      `json:"assigneeId"`
	ProjectID   string      `json:"projectId"`
	CycleID     string      `json:"cycleId"`
	CreatorName string      `json:"creatorName"`
	Priority    int         `json:"priority"`
	Estimate    *float64    `json:"estimate"`
	URL         string      `json:"url"`
	CreatedAt   string      `json:"createdAt"`
	UpdatedAt   string      `json:"updatedAt"`
	Labels      []LabelChip `json:"labels"`
	SkipCount   int         `json:"skipCount"`
	SnoozedTil  string      `json:"snoozedUntil,omitempty"`
	TriagedAt   string      `json:"triagedAt,omitempty"`
	Enrichment  *Enrichment `json:"enrichment,omitempty"`
}

type Enrichment struct {
	IssueID    string          `json:"issueId"`
	Summary    string          `json:"summary"`
	Verdict    string          `json:"verdict"`
	Reasoning  string          `json:"reasoning"`
	Confidence float64         `json:"confidence"`
	Model      string          `json:"model,omitempty"`
	CreatedAt  string          `json:"createdAt"`
	Report     json.RawMessage `json:"report,omitempty"` // deep-enrichment structured report
	// Stale is true when the issue's content changed after this enrichment
	// was computed (content-hash mismatch) — the analysis may be out of date.
	Stale bool `json:"stale,omitempty"`
}

type Macro struct {
	ID         int64       `json:"id"`
	Name       string      `json:"name"`
	KeyBinding string      `json:"keyBinding"`
	Outcome    string      `json:"outcome"`
	Steps      []MacroStep `json:"steps"`
	Position   int         `json:"position"`
}

// MacroStep is one op in a macro. Name-based references (labelName, stateName)
// are resolved per-issue-team at execution time so a single macro works across
// teams; ID-based references are exact.
type MacroStep struct {
	Type       string   `json:"type"` // add_label|remove_label|set_state|set_estimate|set_project|set_cycle|set_assignee
	LabelID    string   `json:"labelId,omitempty"`
	LabelName  string   `json:"labelName,omitempty"`
	LabelNames []string `json:"labelNames,omitempty"` // multi-label form of add_label/remove_label
	StateID    string   `json:"stateId,omitempty"`
	StateName  string   `json:"stateName,omitempty"`
	StateType  string   `json:"stateType,omitempty"` // fallback: first state of this type for the team
	Estimate   *float64 `json:"estimate,omitempty"`
	ProjectID  string   `json:"projectId,omitempty"`
	CycleID    string   `json:"cycleId,omitempty"`   // or "active" for the team's current cycle
	AssigneeID string   `json:"assigneeId,omitempty"` // or "me", or "" with Clear=true
	Body       string   `json:"body,omitempty"`        // add_comment text
	Clear      bool     `json:"clear,omitempty"`
}

type Activity struct {
	ID              int64  `json:"id"`
	IssueID         string `json:"issueId"`
	IssueIdentifier string `json:"issueIdentifier"`
	IssueTitle      string `json:"issueTitle"`
	Kind            string `json:"kind"`
	Outcome         string `json:"outcome"`
	DetailJSON      string `json:"detail,omitempty"`
	PrevJSON        string `json:"-"`
	Undone          bool   `json:"undone"`
	DurationMS      *int64 `json:"durationMs"`
	CreatedAt       string `json:"createdAt"`
}
