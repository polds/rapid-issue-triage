package server

import (
	"errors"
	"strings"
	"testing"

	"github.com/polds/rapid-issue-triage/internal/store"
)

func member(id, name, gid, gname string) store.LabelGroupMember {
	return store.LabelGroupMember{ID: id, Name: name, GroupID: gid, GroupName: gname}
}

func TestGroupsWithSiblingsKeepsOnlyClashes(t *testing.T) {
	members := []store.LabelGroupMember{
		member("l1", "infrastructure", "g1", "Area"),
		member("l2", "ci-cd", "g1", "Area"),
		member("l3", "api", "g2", "Component"), // alone in its group
	}
	got := groupsWithSiblings(members)
	if len(got) != 1 {
		t.Fatalf("want 1 clashing group, got %d", len(got))
	}
	if got[0][0].Name != "ci-cd" || got[0][1].Name != "infrastructure" {
		t.Fatalf("group not sorted by name: %+v", got[0])
	}
}

func TestClassifyGroupSplitsIncomingFromExisting(t *testing.T) {
	g := []store.LabelGroupMember{
		member("l1", "ci-cd", "g1", "Area"),
		member("l2", "infrastructure", "g1", "Area"),
	}
	c, drop := classifyGroup(g, map[string]bool{"l2": true})
	if !c.Resolvable {
		t.Fatal("one incoming + one existing should be resolvable")
	}
	if len(c.Existing) != 1 || c.Existing[0] != "ci-cd" {
		t.Fatalf("existing: %v", c.Existing)
	}
	if len(c.Incoming) != 1 || c.Incoming[0] != "infrastructure" {
		t.Fatalf("incoming: %v", c.Incoming)
	}
	if len(drop) != 1 || drop[0] != "l1" {
		t.Fatalf("drop: %v", drop)
	}
}

func TestClassifyGroupTwoIncomingIsNotResolvable(t *testing.T) {
	g := []store.LabelGroupMember{
		member("l1", "ci-cd", "g1", "Area"),
		member("l2", "infrastructure", "g1", "Area"),
	}
	c, _ := classifyGroup(g, map[string]bool{"l1": true, "l2": true})
	if c.Resolvable {
		t.Fatal("two incoming siblings cannot be resolved by replacing")
	}
	if len(c.Existing) != 0 {
		t.Fatalf("existing: %v", c.Existing)
	}
}

func TestClassifyGroupPreexistingClashIsNotResolvable(t *testing.T) {
	g := []store.LabelGroupMember{
		member("l1", "ci-cd", "g1", "Area"),
		member("l2", "infrastructure", "g1", "Area"),
	}
	c, _ := classifyGroup(g, map[string]bool{})
	if c.Resolvable {
		t.Fatal("a clash this action did not create cannot be auto-resolved")
	}
}

func TestConflictMessagesNameTheLabels(t *testing.T) {
	cases := []struct {
		name string
		c    labelGroupConflict
		want []string
	}{
		{
			"replaceable",
			labelGroupConflict{Group: "Area", Existing: []string{"ci-cd"}, Incoming: []string{"infrastructure"}},
			[]string{`"Area"`, "only one label", `already has "ci-cd"`, `adds "infrastructure"`},
		},
		{
			"macro adds two",
			labelGroupConflict{Group: "Area", Incoming: []string{"ci-cd", "infrastructure"}},
			[]string{`adds "ci-cd" and "infrastructure"`, "drop one of them from the macro"},
		},
		{
			"already on the issue",
			labelGroupConflict{Group: "Area", Existing: []string{"ci-cd", "infrastructure"}},
			[]string{`already has "ci-cd" and "infrastructure"`, "remove one in Linear"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.c.message()
			for _, want := range tc.want {
				if !strings.Contains(got, want) {
					t.Errorf("message %q missing %q", got, want)
				}
			}
		})
	}
}

func TestLabelGroupErrorResolvable(t *testing.T) {
	yes := &labelGroupError{conflicts: []labelGroupConflict{{Resolvable: true}}}
	if !yes.resolvable() {
		t.Fatal("all-resolvable should be resolvable")
	}
	mixed := &labelGroupError{conflicts: []labelGroupConflict{{Resolvable: true}, {}}}
	if mixed.resolvable() {
		t.Fatal("one unresolvable conflict makes the whole action unresolvable")
	}
	if (&labelGroupError{}).resolvable() {
		t.Fatal("no conflicts is not resolvable")
	}
}

func TestLabelGroupErrorJoinsConflicts(t *testing.T) {
	e := &labelGroupError{conflicts: []labelGroupConflict{
		{Group: "Area", Existing: []string{"ci-cd"}, Incoming: []string{"infrastructure"}},
		{Group: "Component", Existing: []string{"api"}, Incoming: []string{"web"}},
	}}
	if got := e.Error(); !strings.Contains(got, `"Area"`) || !strings.Contains(got, `"Component"`) {
		t.Fatalf("both groups should be named: %q", got)
	}
}

func TestExclusiveLabelHintRewritesLinearWording(t *testing.T) {
	raw := errors.New("linear: labelIds not exclusive child labels")
	got := exclusiveLabelHint(raw)
	if !strings.Contains(got.Error(), "same Linear label group") {
		t.Fatalf("hint not applied: %v", got)
	}
	if !errors.Is(got, raw) {
		t.Fatal("original error should stay wrapped")
	}
	other := errors.New("linear: rate limited")
	if got := exclusiveLabelHint(other); !errors.Is(got, other) || got.Error() != other.Error() {
		t.Fatal("unrelated errors must pass through untouched")
	}
	if exclusiveLabelHint(nil) != nil {
		t.Fatal("nil must stay nil")
	}
}

func TestListJoinsNames(t *testing.T) {
	for _, tc := range []struct {
		in   []string
		want string
	}{
		{nil, ""},
		{[]string{"a"}, `"a"`},
		{[]string{"a", "b"}, `"a" and "b"`},
		{[]string{"a", "b", "c"}, `"a", "b" and "c"`},
	} {
		if got := list(tc.in); got != tc.want {
			t.Errorf("list(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
