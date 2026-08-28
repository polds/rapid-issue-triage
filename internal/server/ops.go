package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/polds/rapid-issue-triage/internal/store"
	"github.com/polds/rapid-issue-triage/internal/syncer"
)

// Op is one field mutation, shared between ad-hoc edits and macro steps.
type Op = store.MacroStep

// resolveOps turns ops (possibly name-based, from macros) into a single Linear
// IssueUpdateInput map for the given issue, plus a human-readable trace.
type resolved struct {
	input       map[string]any
	trace       []string
	comments    []string
	duplicateOf string // canonical issue id when entering a duplicate-type state
}

func (s *Server) resolveOps(issue store.IssueRow, ops []Op) (*resolved, error) {
	input := map[string]any{}
	trace := []string{}
	comments := []string{}
	duplicateOf := ""

	labelSet := map[string]bool{}
	for _, l := range issue.Labels {
		labelSet[l.ID] = true
	}
	labelsChanged := false

	for _, op := range ops {
		switch op.Type {
		case "add_label", "remove_label":
			// Collect every referenced label: explicit id, single name, or the
			// multi-name list.
			type ref struct{ id, display string }
			var refs []ref
			if op.LabelID != "" {
				refs = append(refs, ref{op.LabelID, op.LabelID})
			}
			names := op.LabelNames
			if op.LabelName != "" {
				names = append(names, op.LabelName)
			}
			for _, name := range names {
				id, err := s.store.LabelIDByName(issue.TeamID, name)
				if err != nil {
					return nil, fmt.Errorf("label %q not found for this team", name)
				}
				refs = append(refs, ref{id, name})
			}
			if len(refs) == 0 {
				return nil, fmt.Errorf("%s: label reference missing", op.Type)
			}
			for _, rf := range refs {
				if op.Type == "add_label" {
					labelSet[rf.id] = true
					trace = append(trace, "add label "+rf.display)
				} else {
					delete(labelSet, rf.id)
					trace = append(trace, "remove label "+rf.display)
				}
			}
			labelsChanged = true
		case "set_state":
			id := op.StateID
			var err error
			if id == "" && op.StateName != "" {
				id, err = s.store.StateIDByName(issue.TeamID, op.StateName)
				if err != nil {
					return nil, fmt.Errorf("state %q not found for this team", op.StateName)
				}
			}
			if id == "" && op.StateType != "" {
				id, err = s.store.StateIDByType(issue.TeamID, op.StateType)
				if err != nil {
					return nil, fmt.Errorf("no %q state for this team", op.StateType)
				}
			}
			if id == "" {
				return nil, fmt.Errorf("set_state: state reference missing")
			}
			input["stateId"] = id
			if op.DuplicateOfID != "" {
				duplicateOf = op.DuplicateOfID
			}
			trace = append(trace, "set state")
		case "set_estimate":
			if op.Clear {
				input["estimate"] = nil
				trace = append(trace, "clear estimate")
			} else if op.Estimate != nil {
				input["estimate"] = *op.Estimate
				trace = append(trace, fmt.Sprintf("estimate %v", *op.Estimate))
			}
		case "set_project":
			if op.Clear || op.ProjectID == "" {
				input["projectId"] = nil
				trace = append(trace, "clear project")
			} else {
				input["projectId"] = op.ProjectID
				trace = append(trace, "set project")
			}
		case "set_cycle":
			id := op.CycleID
			if id == "active" {
				var err error
				id, err = s.store.ActiveCycleID(issue.TeamID, time.Now().UTC().Format(time.RFC3339))
				if err != nil {
					return nil, fmt.Errorf("no active cycle for this team")
				}
			}
			if op.Clear || id == "" {
				input["cycleId"] = nil
				trace = append(trace, "clear cycle")
			} else {
				input["cycleId"] = id
				trace = append(trace, "set cycle")
			}
		case "post_ai_report":
			e, gerr := s.store.GetEnrichment(issue.ID)
			if gerr != nil {
				return nil, gerr
			}
			body, ferr := formatEnrichmentComment(e, issue.URL)
			if ferr != nil {
				return nil, ferr
			}
			comments = append(comments, body)
			trace = append(trace, "post AI report comment")
		case "add_comment":
			body := strings.TrimSpace(op.Body)
			if body == "" {
				return nil, fmt.Errorf("add_comment: empty comment body")
			}
			comments = append(comments, body)
			trace = append(trace, "comment: "+truncateTrace(body))
		case "set_assignee":
			id := op.AssigneeID
			if id == "me" {
				var err error
				id, err = s.store.MyUserID()
				if err != nil {
					return nil, fmt.Errorf("viewer not synced yet")
				}
			}
			if op.Clear || id == "" {
				input["assigneeId"] = nil
				trace = append(trace, "unassign")
			} else {
				input["assigneeId"] = id
				trace = append(trace, "assign")
			}
		default:
			return nil, fmt.Errorf("unknown op type %q", op.Type)
		}
	}
	if labelsChanged {
		ids := make([]string, 0, len(labelSet))
		for id := range labelSet {
			ids = append(ids, id)
		}
		input["labelIds"] = ids
	}
	if len(input) == 0 && len(comments) == 0 {
		return nil, fmt.Errorf("no operations to apply")
	}
	return &resolved{input: input, trace: trace, comments: comments, duplicateOf: duplicateOf}, nil
}

func truncateTrace(s string) string {
	if len(s) > 60 {
		s = s[:60] + "…"
	}
	return "\"" + s + "\""
}

// prevSnapshot captures the fields undo needs to restore.
func prevSnapshot(issue store.IssueRow) string {
	b, _ := json.Marshal(issue)
	return string(b)
}

// applyOps resolves and executes ops against Linear, updates the local row,
// and logs activity. Returns the refreshed issue and the activity id.
func (s *Server) applyOps(ctx context.Context, issue store.IssueRow, ops []Op, kind, outcome string, durationMS *int64) (store.IssueRow, int64, error) {
	r, err := s.resolveOps(issue, ops)
	if err != nil {
		return issue, 0, err
	}
	input, trace, comments := r.input, r.trace, r.comments

	// Linear requires a duplicate relation before an issue can enter a
	// duplicate-type state; create it first and roll it back on failure.
	relationIDs := []string{}
	if sid, ok := input["stateId"].(string); ok {
		if t, terr := s.store.StateType(sid); terr == nil && t == "duplicate" {
			if r.duplicateOf == "" {
				return issue, 0, fmt.Errorf("moving to a Duplicate state needs the canonical issue — pick which issue this duplicates")
			}
			relID, rerr := s.linear.CreateDuplicateRelation(ctx, issue.ID, r.duplicateOf)
			if rerr != nil {
				return issue, 0, fmt.Errorf("duplicate relation: %w", rerr)
			}
			relationIDs = append(relationIDs, relID)
			trace = append(trace, "mark duplicate of "+r.duplicateOf)
		}
	}
	row := issue
	if len(input) > 0 {
		updated, err := s.linear.UpdateIssue(ctx, issue.ID, input)
		if err != nil {
			for _, rid := range relationIDs {
				_ = s.linear.DeleteIssueRelation(ctx, rid)
			}
			return issue, 0, err
		}
		row = syncer.ToRow(updated)
	}
	// Comments post after the field update; ids are recorded so undo can
	// delete them again.
	commentIDs := []string{}
	for _, body := range comments {
		id, err := s.linear.CreateComment(ctx, issue.ID, body)
		if err != nil {
			return issue, 0, fmt.Errorf("comment failed: %w", err)
		}
		commentIDs = append(commentIDs, id)
	}

	// Terminal when the issue left its triage-eligible state (completed or
	// canceled state type) — those disappear from the queue immediately.
	terminal := false
	if row.StateID != "" && row.StateID != issue.StateID {
		if t, err := s.store.StateType(row.StateID); err == nil && (t == "completed" || t == "canceled") {
			terminal = true
		}
	}
	// Any macro/edit counts as triaged for queue purposes: the operator made a
	// decision on this card.
	if err := s.store.ApplySyncedIssue(row, true); err != nil {
		return issue, 0, err
	}
	_ = terminal

	detail, _ := json.Marshal(map[string]any{"ops": trace, "commentIds": commentIDs, "relationIds": relationIDs})
	actID, err := s.store.LogActivity(store.Activity{
		IssueID: issue.ID, IssueIdentifier: issue.Identifier, IssueTitle: issue.Title,
		Kind: kind, Outcome: outcome, DetailJSON: string(detail),
		PrevJSON: prevSnapshot(issue), DurationMS: durationMS,
	})
	if err != nil {
		return row, 0, err
	}
	full, err := s.store.GetIssue(issue.ID)
	if err == nil {
		// Keep the stored enrichment attached — the UI replaces its card with
		// this row, and dropping it here made reports vanish after actions.
		if e, eerr := s.store.GetEnrichment(full.ID); eerr == nil {
			full.Enrichment = e
		}
		row = full
	}
	return row, actID, nil
}

// undoActivity re-applies the pre-action snapshot to Linear and locally.
func (s *Server) undoActivity(ctx context.Context, act store.Activity) error {
	if act.Undone {
		return fmt.Errorf("already undone")
	}
	switch act.Kind {
	case "skip", "snooze":
		// Local-only actions: restore local row state.
		var prev store.IssueRow
		if err := json.Unmarshal([]byte(act.PrevJSON), &prev); err != nil {
			return err
		}
		if err := s.store.RestoreIssue(prev); err != nil {
			return err
		}
	case "macro", "edit":
		var prev store.IssueRow
		if err := json.Unmarshal([]byte(act.PrevJSON), &prev); err != nil {
			return err
		}
		// Remove comments and duplicate relations this action created.
		var detail struct {
			CommentIDs  []string `json:"commentIds"`
			RelationIDs []string `json:"relationIds"`
		}
		if act.DetailJSON != "" {
			_ = json.Unmarshal([]byte(act.DetailJSON), &detail)
		}
		for _, cid := range detail.CommentIDs {
			if err := s.linear.DeleteComment(ctx, cid); err != nil {
				return fmt.Errorf("undo: delete comment: %w", err)
			}
		}
		for _, rid := range detail.RelationIDs {
			if err := s.linear.DeleteIssueRelation(ctx, rid); err != nil {
				return fmt.Errorf("undo: delete duplicate relation: %w", err)
			}
		}
		ids := make([]string, 0, len(prev.Labels))
		for _, l := range prev.Labels {
			ids = append(ids, l.ID)
		}
		input := map[string]any{
			"stateId":  prev.StateID,
			"labelIds": ids,
		}
		if prev.Estimate != nil {
			input["estimate"] = *prev.Estimate
		} else {
			input["estimate"] = nil
		}
		setOrNil := func(key, val string) {
			if val != "" {
				input[key] = val
			} else {
				input[key] = nil
			}
		}
		setOrNil("projectId", prev.ProjectID)
		setOrNil("cycleId", prev.CycleID)
		setOrNil("assigneeId", prev.AssigneeID)
		if _, err := s.linear.UpdateIssue(ctx, act.IssueID, input); err != nil {
			return err
		}
		if err := s.store.RestoreIssue(prev); err != nil {
			return err
		}
	default:
		return fmt.Errorf("cannot undo %q", act.Kind)
	}
	if err := s.store.MarkActivityUndone(act.ID); err != nil {
		return err
	}
	_, err := s.store.LogActivity(store.Activity{
		IssueID: act.IssueID, IssueIdentifier: act.IssueIdentifier, IssueTitle: act.IssueTitle,
		Kind: "undo", Outcome: "undone",
	})
	return err
}
