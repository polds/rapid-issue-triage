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
	st := &opState{issue: issue, input: map[string]any{}, labelSet: map[string]bool{}}
	for _, l := range issue.Labels {
		st.labelSet[l.ID] = true
	}
	for _, op := range ops {
		if err := s.applyOp(st, op); err != nil {
			return nil, err
		}
	}
	if st.labelsChanged {
		ids := make([]string, 0, len(st.labelSet))
		for id := range st.labelSet {
			ids = append(ids, id)
		}
		st.input["labelIds"] = ids
	}
	if len(st.input) == 0 && len(st.comments) == 0 {
		return nil, fmt.Errorf("no operations to apply")
	}
	return &resolved{input: st.input, trace: st.trace, comments: st.comments, duplicateOf: st.duplicateOf}, nil
}

type opState struct {
	issue         store.IssueRow
	input         map[string]any
	trace         []string
	comments      []string
	duplicateOf   string
	labelSet      map[string]bool
	labelsChanged bool
}

func (s *Server) applyOp(st *opState, op Op) error {
	switch op.Type {
	case "add_label", "remove_label":
		return s.applyLabelOp(st, op)
	case "set_state":
		return s.applyStateOp(st, op)
	case "set_estimate":
		return applyEstimateOp(st, op)
	case "set_project":
		return applyProjectOp(st, op)
	case "set_cycle":
		return s.applyCycleOp(st, op)
	case "post_ai_report":
		return s.applyAIReportOp(st)
	case "add_comment":
		return applyCommentOp(st, op)
	case "set_assignee":
		return s.applyAssigneeOp(st, op)
	default:
		return fmt.Errorf("unknown op type %q", op.Type)
	}
}

func (s *Server) applyLabelOp(st *opState, op Op) error {
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
		id, err := s.store.LabelIDByName(st.issue.TeamID, name)
		if err != nil {
			return fmt.Errorf("label %q not found for this team", name)
		}
		refs = append(refs, ref{id, name})
	}
	if len(refs) == 0 {
		return fmt.Errorf("%s: label reference missing", op.Type)
	}
	for _, rf := range refs {
		if op.Type == "add_label" {
			st.labelSet[rf.id] = true
			st.trace = append(st.trace, "add label "+rf.display)
		} else {
			delete(st.labelSet, rf.id)
			st.trace = append(st.trace, "remove label "+rf.display)
		}
	}
	st.labelsChanged = true
	return nil
}

func (s *Server) applyStateOp(st *opState, op Op) error {
	id := op.StateID
	var err error
	if id == "" && op.StateName != "" {
		id, err = s.store.StateIDByName(st.issue.TeamID, op.StateName)
		if err != nil {
			return fmt.Errorf("state %q not found for this team", op.StateName)
		}
	}
	if id == "" && op.StateType != "" {
		id, err = s.store.StateIDByType(st.issue.TeamID, op.StateType)
		if err != nil {
			return fmt.Errorf("no %q state for this team", op.StateType)
		}
	}
	if id == "" {
		return fmt.Errorf("set_state: state reference missing")
	}
	st.input["stateId"] = id
	if op.DuplicateOfID != "" {
		st.duplicateOf = op.DuplicateOfID
	}
	st.trace = append(st.trace, "set state")
	return nil
}

func applyEstimateOp(st *opState, op Op) error {
	if op.Clear {
		st.input["estimate"] = nil
		st.trace = append(st.trace, "clear estimate")
	} else if op.Estimate != nil {
		st.input["estimate"] = *op.Estimate
		st.trace = append(st.trace, fmt.Sprintf("estimate %v", *op.Estimate))
	}
	return nil
}

func applyProjectOp(st *opState, op Op) error {
	if op.Clear || op.ProjectID == "" {
		st.input["projectId"] = nil
		st.trace = append(st.trace, "clear project")
		return nil
	}
	st.input["projectId"] = op.ProjectID
	st.trace = append(st.trace, "set project")
	return nil
}

func (s *Server) applyCycleOp(st *opState, op Op) error {
	id := op.CycleID
	if id == "active" {
		var err error
		id, err = s.store.ActiveCycleID(st.issue.TeamID, time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			return fmt.Errorf("no active cycle for this team")
		}
	}
	if op.Clear || id == "" {
		st.input["cycleId"] = nil
		st.trace = append(st.trace, "clear cycle")
		return nil
	}
	st.input["cycleId"] = id
	st.trace = append(st.trace, "set cycle")
	return nil
}

func (s *Server) applyAIReportOp(st *opState) error {
	e, err := s.store.GetEnrichment(st.issue.ID)
	if err != nil {
		return err
	}
	body, err := formatEnrichmentComment(e, st.issue.URL)
	if err != nil {
		return err
	}
	st.comments = append(st.comments, body)
	st.trace = append(st.trace, "post AI report comment")
	return nil
}

func applyCommentOp(st *opState, op Op) error {
	body := strings.TrimSpace(op.Body)
	if body == "" {
		return fmt.Errorf("add_comment: empty comment body")
	}
	st.comments = append(st.comments, body)
	st.trace = append(st.trace, "comment: "+truncateTrace(body))
	return nil
}

func (s *Server) applyAssigneeOp(st *opState, op Op) error {
	id := op.AssigneeID
	if id == "me" {
		var err error
		id, err = s.store.MyUserID()
		if err != nil {
			return fmt.Errorf("viewer not synced yet")
		}
	}
	if op.Clear || id == "" {
		st.input["assigneeId"] = nil
		st.trace = append(st.trace, "unassign")
		return nil
	}
	st.input["assigneeId"] = id
	st.trace = append(st.trace, "assign")
	return nil
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
	relationIDs, err := s.ensureDuplicateRelation(ctx, issue.ID, r)
	if err != nil {
		return issue, 0, err
	}
	row := issue
	if len(r.input) > 0 {
		updated, err := s.linear.UpdateIssue(ctx, issue.ID, r.input)
		if err != nil {
			for _, rid := range relationIDs {
				_ = s.linear.DeleteIssueRelation(ctx, rid)
			}
			return issue, 0, err
		}
		row = syncer.ToRow(updated)
	}
	commentIDs, err := s.postComments(ctx, issue.ID, r.comments)
	if err != nil {
		return issue, 0, err
	}
	if err := s.store.ApplySyncedIssue(row, true); err != nil {
		return issue, 0, err
	}
	detail, _ := json.Marshal(map[string]any{"ops": r.trace, "commentIds": commentIDs, "relationIds": relationIDs})
	actID, err := s.store.LogActivity(store.Activity{
		IssueID: issue.ID, IssueIdentifier: issue.Identifier, IssueTitle: issue.Title,
		Kind: kind, Outcome: outcome, DetailJSON: string(detail),
		PrevJSON: prevSnapshot(issue), DurationMS: durationMS,
	})
	if err != nil {
		return row, 0, err
	}
	return s.issueAfterAction(issue.ID, row), actID, nil
}

func (s *Server) ensureDuplicateRelation(ctx context.Context, issueID string, r *resolved) ([]string, error) {
	sid, ok := r.input["stateId"].(string)
	if !ok {
		return nil, nil
	}
	t, err := s.store.StateType(sid)
	if err != nil || t != "duplicate" {
		return nil, nil
	}
	if r.duplicateOf == "" {
		return nil, fmt.Errorf("moving to a Duplicate state needs the canonical issue — pick which issue this duplicates")
	}
	relID, err := s.linear.CreateDuplicateRelation(ctx, issueID, r.duplicateOf)
	if err != nil {
		return nil, fmt.Errorf("duplicate relation: %w", err)
	}
	r.trace = append(r.trace, "mark duplicate of "+r.duplicateOf)
	return []string{relID}, nil
}

func (s *Server) postComments(ctx context.Context, issueID string, bodies []string) ([]string, error) {
	ids := make([]string, 0, len(bodies))
	for _, body := range bodies {
		id, err := s.linear.CreateComment(ctx, issueID, body)
		if err != nil {
			return nil, fmt.Errorf("comment failed: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *Server) issueAfterAction(id string, fallback store.IssueRow) store.IssueRow {
	full, err := s.store.GetIssue(id)
	if err != nil {
		return fallback
	}
	if e, eerr := s.store.GetEnrichment(full.ID); eerr == nil {
		full.Enrichment = e
	}
	return full
}

func (s *Server) undoActivity(ctx context.Context, act store.Activity) error {
	if act.Undone {
		return fmt.Errorf("already undone")
	}
	switch act.Kind {
	case "skip", "snooze":
		if err := s.restoreLocalIssue(act.PrevJSON); err != nil {
			return err
		}
	case "macro", "edit":
		if err := s.undoLinearMutation(ctx, act); err != nil {
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

func (s *Server) restoreLocalIssue(prevJSON string) error {
	var prev store.IssueRow
	if err := json.Unmarshal([]byte(prevJSON), &prev); err != nil {
		return err
	}
	return s.store.RestoreIssue(prev)
}

func (s *Server) undoLinearMutation(ctx context.Context, act store.Activity) error {
	var prev store.IssueRow
	if err := json.Unmarshal([]byte(act.PrevJSON), &prev); err != nil {
		return err
	}
	if err := s.deleteUndoSideEffects(ctx, act.DetailJSON); err != nil {
		return err
	}
	input := undoIssueInput(prev)
	if _, err := s.linear.UpdateIssue(ctx, act.IssueID, input); err != nil {
		return err
	}
	return s.store.RestoreIssue(prev)
}

func (s *Server) deleteUndoSideEffects(ctx context.Context, detailJSON string) error {
	var detail struct {
		CommentIDs  []string `json:"commentIds"`
		RelationIDs []string `json:"relationIds"`
	}
	if detailJSON != "" {
		_ = json.Unmarshal([]byte(detailJSON), &detail)
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
	return nil
}

func undoIssueInput(prev store.IssueRow) map[string]any {
	ids := make([]string, 0, len(prev.Labels))
	for _, l := range prev.Labels {
		ids = append(ids, l.ID)
	}
	input := map[string]any{"stateId": prev.StateID, "labelIds": ids}
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
	return input
}
