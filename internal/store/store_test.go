package store

import (
	"path/filepath"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func mustIssue(t *testing.T, st *Store, r IssueRow, gen int64) {
	t.Helper()
	tx, err := st.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertIssue(tx, gen, r); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func sampleIssue(id, ident, team string, pri int, labels ...LabelChip) IssueRow {
	return IssueRow{
		ID: id, Identifier: ident, Title: ident + " title", TeamID: team,
		Priority: pri, Labels: labels, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func TestMetaRoundTrip(t *testing.T) {
	st := testStore(t)
	if v, err := st.GetMeta("missing"); err != nil || v != "" {
		t.Fatalf("missing: %q %v", v, err)
	}
	if err := st.SetMeta("k", "v1"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetMeta("k", "v2"); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetMeta("k")
	if err != nil || got != "v2" {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestQueueFilterEmpty(t *testing.T) {
	if !(QueueFilter{}).Empty() {
		t.Fatal("empty filter should be empty")
	}
	if (QueueFilter{Search: "  "}).Empty() == false && (QueueFilter{Search: "x"}).Empty() {
		t.Fatal("whitespace search is empty; non-empty search is not")
	}
	if (QueueFilter{Search: "core"}).Empty() {
		t.Fatal("search should not be empty")
	}
	if (QueueFilter{TeamIDs: []string{"t"}}).Empty() {
		t.Fatal("teams should not be empty")
	}
}

func TestIssueQueueSkipSnoozeTriageAndFilters(t *testing.T) {
	st := testStore(t)
	bug := LabelChip{ID: "l1", Name: "bug", Color: "#f00"}
	infra := LabelChip{ID: "l2", Name: "infra", Color: "#00f"}
	mustIssue(t, st, sampleIssue("a", "CORE-1", "team-a", 1, bug), 1)
	mustIssue(t, st, sampleIssue("b", "CORE-2", "team-b", 2, infra), 1)
	mustIssue(t, st, sampleIssue("c", "OPS-9", "team-a", 1, bug, infra), 1)

	q, err := st.Queue(QueueFilter{}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 3 {
		t.Fatalf("queue len %d", len(q))
	}
	n, err := st.QueueCount(QueueFilter{})
	if err != nil || n != 3 {
		t.Fatalf("count %d %v", n, err)
	}

	q, err = st.Queue(QueueFilter{TeamIDs: []string{"team-a"}}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 2 {
		t.Fatalf("team-a: %d", len(q))
	}
	q, err = st.Queue(QueueFilter{ExcludeTeams: []string{"team-a"}}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 1 || q[0].ID != "b" {
		t.Fatalf("exclude team: %+v", q)
	}
	q, err = st.Queue(QueueFilter{Priorities: []int{2}}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 1 || q[0].ID != "b" {
		t.Fatalf("priority: %+v", q)
	}
	q, err = st.Queue(QueueFilter{Labels: []string{"BUG"}}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 2 {
		t.Fatalf("labels: %d", len(q))
	}
	q, err = st.Queue(QueueFilter{ExcludeLabels: []string{"infra"}}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 1 || q[0].ID != "a" {
		t.Fatalf("exclude labels: %+v", q)
	}
	q, err = st.Queue(QueueFilter{Search: "ops-"}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 1 || q[0].ID != "c" {
		t.Fatalf("search: %+v", q)
	}

	q, err = st.Queue(QueueFilter{}, []string{"a", "b"}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(q) != 1 || q[0].ID != "c" {
		t.Fatalf("exclude ids: %+v", q)
	}

	if _, err := st.Queue(QueueFilter{}, nil, 0); err != nil {
		t.Fatal(err)
	}

	if err := st.MarkSkipped("a"); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetIssue("a")
	if err != nil || got.SkipCount != 1 {
		t.Fatalf("skip: %+v %v", got, err)
	}
	if err := st.MarkSnoozed("b", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	n, err = st.QueueCount(QueueFilter{})
	if err != nil || n != 2 {
		t.Fatalf("snoozed count %d %v", n, err)
	}
	if err := st.MarkTriaged("c"); err != nil {
		t.Fatal(err)
	}
	n, err = st.QueueCount(QueueFilter{})
	if err != nil || n != 1 {
		t.Fatalf("triaged count %d %v", n, err)
	}
	counts, err := st.TeamCounts()
	if err != nil {
		t.Fatal(err)
	}
	if counts["team-a"] != 1 {
		t.Fatalf("team counts: %+v", counts)
	}

	if _, err := st.GetIssue("missing"); err == nil {
		t.Fatal("expected not found")
	}

	got.SkipCount = 3
	if err := st.RestoreIssue(got); err != nil {
		t.Fatal(err)
	}
	got, _ = st.GetIssue("a")
	if got.SkipCount != 3 {
		t.Fatalf("restore skip %d", got.SkipCount)
	}

	got.Title = "updated"
	if err := st.ApplySyncedIssue(got, true); err != nil {
		t.Fatal(err)
	}
	got, _ = st.GetIssue("a")
	if got.Title != "updated" || got.TriagedAt == "" {
		t.Fatalf("apply synced: %+v", got)
	}

	if err := st.SetIssueContext("a", `{"k":1}`); err != nil {
		t.Fatal(err)
	}
	ctx, at, err := st.GetIssueContext("a")
	if err != nil || ctx != `{"k":1}` || at == "" {
		t.Fatalf("context %q %q %v", ctx, at, err)
	}

	pruned, err := st.PruneStale(2)
	if err != nil || pruned != 3 {
		t.Fatalf("prune %d %v", pruned, err)
	}
}

func TestMacrosCRUD(t *testing.T) {
	st := testStore(t)
	m, err := st.CreateMacro(Macro{Name: "Accept", KeyBinding: "1", Outcome: "accepted", Steps: []MacroStep{{Type: "set_state", StateType: "started"}}, Position: 0})
	if err != nil || m.ID == 0 {
		t.Fatalf("create: %+v %v", m, err)
	}
	got, err := st.GetMacro(m.ID)
	if err != nil || got.Name != "Accept" || len(got.Steps) != 1 {
		t.Fatalf("get: %+v %v", got, err)
	}
	got.Name = "Accept+"
	if err := st.UpdateMacro(got); err != nil {
		t.Fatal(err)
	}
	list, err := st.ListMacros()
	if err != nil || len(list) != 1 || list[0].Name != "Accept+" {
		t.Fatalf("list: %+v %v", list, err)
	}
	if err := st.DeleteMacro(m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetMacro(m.ID); err == nil {
		t.Fatal("expected deleted macro not found")
	}
}

func TestEnrichSettingsAndEnrichmentHash(t *testing.T) {
	st := testStore(t)
	def := st.GetEnrichSettings()
	if def.Mode != "fast" {
		t.Fatalf("default mode %q", def.Mode)
	}
	es := EnrichSettings{Mode: "deep", ClaudePath: "/opt/claude"}
	es.Sources.Repo.Enabled = true
	es.Sources.Repo.Paths = []string{"~/src"}
	if err := st.SetEnrichSettings(es); err != nil {
		t.Fatal(err)
	}
	got := st.GetEnrichSettings()
	if got.Mode != "deep" || got.ClaudePath != "/opt/claude" || !got.Sources.Repo.Enabled {
		t.Fatalf("settings: %+v", got)
	}
	got.Mode = "weird"
	if err := st.SetEnrichSettings(got); err != nil {
		t.Fatal(err)
	}
	if st.GetEnrichSettings().Mode != "fast" {
		t.Fatal("unknown mode should coerce to fast")
	}

	mustIssue(t, st, sampleIssue("i1", "CORE-1", "t", 0), 1)
	if err := st.SaveEnrichment(Enrichment{IssueID: "i1", Summary: "s", Verdict: "actionable", Reasoning: "r", Confidence: 0.8, Model: "m"}); err != nil {
		t.Fatal(err)
	}
	e, err := st.GetEnrichment("i1")
	if err != nil || e == nil || e.Summary != "s" || e.Stale {
		t.Fatalf("enrichment: %+v %v", e, err)
	}
	missing, err := st.GetEnrichment("nope")
	if err != nil || missing != nil {
		t.Fatalf("missing enrichment: %+v %v", missing, err)
	}

	tx, err := st.Begin()
	if err != nil {
		t.Fatal(err)
	}
	row := sampleIssue("i1", "CORE-1", "t", 0)
	row.Title = "changed"
	if err := st.UpsertIssue(tx, 1, row); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	q, err := st.Queue(QueueFilter{}, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.AttachEnrichments(q); err != nil {
		t.Fatal(err)
	}
	if len(q) != 1 || q[0].Enrichment == nil || !q[0].Enrichment.Stale {
		t.Fatalf("stale attach: %+v", q[0].Enrichment)
	}

	heads, err := st.UnenrichedQueueHeads(5)
	if err != nil {
		t.Fatal(err)
	}
	if len(heads) != 0 {
		t.Fatalf("heads: %v", heads)
	}
	mustIssue(t, st, sampleIssue("i2", "CORE-2", "t", 0), 1)
	heads, err = st.UnenrichedQueueHeads(5)
	if err != nil || len(heads) != 1 || heads[0] != "i2" {
		t.Fatalf("unenriched: %v %v", heads, err)
	}

	h1 := IssueContentHash("a", "b")
	h2 := IssueContentHash("a", "c")
	if h1 == h2 || len(h1) != 16 {
		t.Fatalf("hash %s %s", h1, h2)
	}
}

func TestActivityReportAndUndo(t *testing.T) {
	st := testStore(t)
	ms := int64(1200)
	id, err := st.LogActivity(Activity{
		IssueID: "i", IssueIdentifier: "CORE-1", IssueTitle: "t",
		Kind: "macro", Outcome: "accepted", DurationMS: &ms,
	})
	if err != nil || id == 0 {
		t.Fatalf("log: %d %v", id, err)
	}
	a, err := st.GetActivity(id)
	if err != nil || a.Outcome != "accepted" {
		t.Fatalf("get activity: %+v %v", a, err)
	}
	rep, err := st.Report()
	if err != nil {
		t.Fatal(err)
	}
	if rep["today"].(int) < 1 || rep["allTime"].(int) < 1 {
		t.Fatalf("report counts: %+v", rep)
	}
	if rep["streakDays"].(int) < 1 {
		t.Fatalf("streak: %+v", rep["streakDays"])
	}
	if err := st.MarkActivityUndone(id); err != nil {
		t.Fatal(err)
	}
	a, _ = st.GetActivity(id)
	if !a.Undone {
		t.Fatal("expected undone")
	}
}

func TestMetadataLookupsAndEnrichRuns(t *testing.T) {
	st := testStore(t)
	tx, err := st.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceTeams(tx, [][]any{{"t1", "CORE", "Core"}}); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceStates(tx, [][]any{{"s1", "t1", "Triage", "triage", "#fff", 0.0}}); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceLabels(tx, [][]any{{"l1", "t1", "bug", "#f00", 0, nil}}); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceProjects(tx, [][]any{{"p1", "Infra", "started"}}); err != nil {
		t.Fatal(err)
	}
	nowISO := time.Now().UTC().Format(time.RFC3339)
	start := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	end := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	if err := st.ReplaceCycles(tx, [][]any{{"c1", "t1", 1.0, "C1", start, end}}); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceUsers(tx, [][]any{{"u1", "Ada", "Ada", "ada@x", 1}}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	meta, err := st.Metadata()
	if err != nil {
		t.Fatal(err)
	}
	teams := meta["teams"].([]map[string]any)
	if len(teams) != 1 || teams[0]["key"] != "CORE" {
		t.Fatalf("teams: %+v", meta["teams"])
	}
	id, err := st.LabelIDByName("t1", "BUG")
	if err != nil || id != "l1" {
		t.Fatalf("label: %s %v", id, err)
	}
	id, err = st.StateIDByName("t1", "triage")
	if err != nil || id != "s1" {
		t.Fatalf("state name: %s %v", id, err)
	}
	id, err = st.StateIDByType("t1", "triage")
	if err != nil || id != "s1" {
		t.Fatalf("state type: %s %v", id, err)
	}
	typ, err := st.StateType("s1")
	if err != nil || typ != "triage" {
		t.Fatalf("type: %s %v", typ, err)
	}
	id, err = st.ActiveCycleID("t1", nowISO)
	if err != nil || id != "c1" {
		t.Fatalf("cycle: %s %v", id, err)
	}
	id, err = st.MyUserID()
	if err != nil || id != "u1" {
		t.Fatalf("me: %s %v", id, err)
	}

	run := EnrichRun{ID: "r1", IssueID: "i1", IssueIdentifier: "CORE-1", Mode: "deep", Status: "running"}
	if err := st.CreateEnrichRun(run); err != nil {
		t.Fatal(err)
	}
	if err := st.AppendEnrichEvent("r1", 1, "repo", "status", []byte(`{"state":"running"}`)); err != nil {
		t.Fatal(err)
	}
	if err := st.FinishEnrichRun("r1", "done", `{"summary":"ok"}`, ""); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetEnrichRun("r1")
	if err != nil || got.Status != "done" || got.ReportJSON == "" {
		t.Fatalf("run: %+v %v", got, err)
	}
	latest, err := st.LatestRunForIssue("i1")
	if err != nil || latest.ID != "r1" {
		t.Fatalf("latest: %+v %v", latest, err)
	}
	ev, err := st.EnrichEvents("r1", 0)
	if err != nil || len(ev) != 1 || ev[0].Kind != "status" {
		t.Fatalf("events: %+v %v", ev, err)
	}
}

func TestMustJSONAndErrRow(t *testing.T) {
	if mustJSON(map[string]int{"a": 1}) != `{"a":1}` {
		t.Fatalf("json: %s", mustJSON(map[string]int{"a": 1}))
	}
	ch := make(chan int)
	if mustJSON(ch) != "null" {
		t.Fatalf("bad json: %s", mustJSON(ch))
	}
}

func TestLabelGroupsFor(t *testing.T) {
	st := testStore(t)
	tx, err := st.Begin()
	if err != nil {
		t.Fatal(err)
	}
	// "Area" is a group; infra and ci-cd are its mutually exclusive children.
	// "bug" is ungrouped and must never come back from this lookup.
	err = st.ReplaceLabels(tx, [][]any{
		{"g1", "t1", "Area", "#000", 1, nil},
		{"l1", "t1", "infrastructure", "#f00", 0, "g1"},
		{"l2", "t1", "ci-cd", "#0f0", 0, "g1"},
		{"l3", "t1", "bug", "#00f", 0, nil},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	got, err := st.LabelGroupsFor([]string{"l1", "l2", "l3"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want the two grouped labels, got %+v", got)
	}
	for _, m := range got {
		if m.GroupID != "g1" || m.GroupName != "Area" {
			t.Fatalf("group not resolved: %+v", m)
		}
	}

	// An ungrouped label alone yields nothing, and so does an empty request.
	if got, err := st.LabelGroupsFor([]string{"l3"}); err != nil || len(got) != 0 {
		t.Fatalf("ungrouped: %+v %v", got, err)
	}
	if got, err := st.LabelGroupsFor(nil); err != nil || got != nil {
		t.Fatalf("empty: %+v %v", got, err)
	}
}
