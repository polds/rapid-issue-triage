package server

import (
	"fmt"
	"slices"
	"strings"

	"github.com/polds/rapid-issue-triage/internal/store"
)

// Linear label groups are mutually exclusive: at most one child of a group may
// be on an issue. An update carrying two siblings is rejected with the opaque
// "labelIds not exclusive child labels". These helpers catch that before the
// mutation is sent, name the labels involved, and — when the action adds
// exactly one sibling — let the caller resolve it by replacing the ones the
// issue already carries.

// labelGroupConflict is one group with more than one label landing on the issue.
type labelGroupConflict struct {
	Group    string   `json:"group"`    // label group name, e.g. "Area"
	Existing []string `json:"existing"` // sibling names already on the issue
	Incoming []string `json:"incoming"` // sibling names this action adds
	// Resolvable reports whether replacing Existing with Incoming is an
	// unambiguous fix — true only when the action adds exactly one sibling.
	Resolvable bool `json:"resolvable"`
}

// labelGroupError is returned by resolveOps when the resulting label set would
// violate a group's exclusivity. Handlers surface it as a structured 409 so the
// UI can prompt instead of dead-ending on Linear's own wording.
type labelGroupError struct {
	conflicts []labelGroupConflict
}

func (e *labelGroupError) Error() string {
	parts := make([]string, 0, len(e.conflicts))
	for _, c := range e.conflicts {
		parts = append(parts, c.message())
	}
	return strings.Join(parts, "; ")
}

// resolvable reports whether every conflict can be fixed by replacing.
func (e *labelGroupError) resolvable() bool {
	for _, c := range e.conflicts {
		if !c.Resolvable {
			return false
		}
	}
	return len(e.conflicts) > 0
}

func (c labelGroupConflict) message() string {
	const allows = " allows only one label per issue"
	switch {
	case len(c.Incoming) == 0:
		return fmt.Sprintf("%s%s, but this issue already has %s — remove one in Linear first",
			quote(c.Group), allows, list(c.Existing))
	case len(c.Existing) == 0:
		return fmt.Sprintf("%s%s, and this action adds %s — drop one of them from the macro",
			quote(c.Group), allows, list(c.Incoming))
	default:
		return fmt.Sprintf("%s%s: this issue already has %s and this action adds %s",
			quote(c.Group), allows, list(c.Existing), list(c.Incoming))
	}
}

func quote(s string) string { return "\"" + s + "\"" }

func list(names []string) string {
	q := make([]string, len(names))
	for i, n := range names {
		q[i] = quote(n)
	}
	switch len(q) {
	case 0:
		return ""
	case 1:
		return q[0]
	default:
		return strings.Join(q[:len(q)-1], ", ") + " and " + q[len(q)-1]
	}
}

// resolveLabelGroups inspects the label set resolveOps has built. With
// replaceGroupLabels set it drops the siblings the issue already carried in
// favor of the single one being added; otherwise any group holding more than
// one label is reported as a conflict.
func (s *Server) resolveLabelGroups(st *opState, opts opOptions) error {
	if !st.labelsChanged {
		return nil
	}
	ids := make([]string, 0, len(st.labelSet))
	for id := range st.labelSet {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	members, err := s.store.LabelGroupsFor(ids)
	if err != nil {
		return err
	}
	var conflicts []labelGroupConflict
	for _, g := range groupsWithSiblings(members) {
		c, drop := classifyGroup(g, st.added)
		if c.Resolvable && opts.replaceGroupLabels {
			for _, id := range drop {
				delete(st.labelSet, id)
			}
			st.trace = append(st.trace, fmt.Sprintf("replace %s label %s → %s",
				quote(c.Group), list(c.Existing), list(c.Incoming)))
			continue
		}
		conflicts = append(conflicts, c)
	}
	if len(conflicts) > 0 {
		return &labelGroupError{conflicts: conflicts}
	}
	return nil
}

// groupsWithSiblings buckets members by group and keeps only the groups holding
// more than one label, in a stable order.
func groupsWithSiblings(members []store.LabelGroupMember) [][]store.LabelGroupMember {
	byGroup := map[string][]store.LabelGroupMember{}
	var order []string
	for _, m := range members {
		if _, seen := byGroup[m.GroupID]; !seen {
			order = append(order, m.GroupID)
		}
		byGroup[m.GroupID] = append(byGroup[m.GroupID], m)
	}
	slices.Sort(order)
	var out [][]store.LabelGroupMember
	for _, gid := range order {
		g := byGroup[gid]
		if len(g) < 2 {
			continue
		}
		slices.SortFunc(g, func(a, b store.LabelGroupMember) int { return strings.Compare(a.Name, b.Name) })
		out = append(out, g)
	}
	return out
}

// classifyGroup splits one group's labels into the ones this action adds and
// the ones the issue already carried, and reports the ids to drop if the caller
// chooses to replace.
func classifyGroup(g []store.LabelGroupMember, added map[string]bool) (labelGroupConflict, []string) {
	// Both slices start empty so they serialize as [] rather than null: the UI
	// reads their lengths to decide what the conflict means.
	c := labelGroupConflict{Group: g[0].GroupName, Existing: []string{}, Incoming: []string{}}
	var drop []string
	for _, m := range g {
		if added[m.ID] {
			c.Incoming = append(c.Incoming, m.Name)
			continue
		}
		c.Existing = append(c.Existing, m.Name)
		drop = append(drop, m.ID)
	}
	// Replacing is only unambiguous when exactly one label is being added:
	// with two incoming siblings there is no basis for picking a winner.
	c.Resolvable = len(c.Incoming) == 1 && len(c.Existing) > 0
	return c, drop
}

// exclusiveLabelHint rewrites Linear's own wording when a conflict slipped past
// resolveLabelGroups — a group created or changed since the last sync.
func exclusiveLabelHint(err error) error {
	if err == nil || !strings.Contains(err.Error(), "not exclusive child labels") {
		return err
	}
	return fmt.Errorf("two of these labels belong to the same Linear label group, "+
		"which allows only one label per issue; the local label index may be stale — "+
		"refresh from Linear and try again (%w)", err)
}
