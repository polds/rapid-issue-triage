package store

import (
	"testing"
)

func usageRow(issue, mode, agent, model string, in, out, cc, cr int64, cost float64) TokenUsage {
	return TokenUsage{
		IssueID: issue, Mode: mode, Agent: agent, Model: model,
		Input: in, Output: out, CacheCreation: cc, CacheRead: cr, CostUSD: cost,
	}
}

func TestRecordTokenUsageSkipsEmptyCalls(t *testing.T) {
	st := testStore(t)
	// A call that failed before spending anything must not count as a call.
	if err := st.RecordTokenUsage(TokenUsage{IssueID: "i1", Mode: "fast", Agent: "fast"}); err != nil {
		t.Fatal(err)
	}
	rep, err := st.TokenUsageReport()
	if err != nil {
		t.Fatal(err)
	}
	if rep.Totals.Calls != 0 {
		t.Fatalf("empty usage recorded: %+v", rep.Totals)
	}
	if rep.Since != "" {
		t.Fatalf("since set with no rows: %q", rep.Since)
	}
}

func TestTokenUsageReportTotalsAndBreakdowns(t *testing.T) {
	st := testStore(t)
	rows := []TokenUsage{
		usageRow("i1", "fast", "fast", "claude-sonnet-5", 100, 20, 0, 500, 0.01),
		usageRow("i2", "deep", "repo", "claude-opus-5", 200, 40, 1000, 0, 0.20),
		usageRow("i2", "deep", "linear", "claude-opus-5", 50, 10, 0, 100, 0.02),
		usageRow("i2", "deep", "synthesis", "claude-opus-5", 80, 30, 0, 200, 0.03),
	}
	for _, r := range rows {
		if err := st.RecordTokenUsage(r); err != nil {
			t.Fatal(err)
		}
	}
	rep, err := st.TokenUsageReport()
	if err != nil {
		t.Fatal(err)
	}

	if rep.Totals.Calls != 4 {
		t.Fatalf("calls = %d, want 4", rep.Totals.Calls)
	}
	// Total spans all four token kinds, not just input+output.
	if want := int64(100 + 20 + 500 + 200 + 40 + 1000 + 50 + 10 + 100 + 80 + 30 + 200); rep.Totals.Total != want {
		t.Fatalf("total = %d, want %d", rep.Totals.Total, want)
	}
	if rep.Totals.CacheRead != 800 || rep.Totals.CacheCreation != 1000 {
		t.Fatalf("cache split wrong: %+v", rep.Totals)
	}
	if got := rep.Totals.CostUSD; got < 0.2599 || got > 0.2601 {
		t.Fatalf("cost = %v, want ~0.26", got)
	}
	if rep.Issues != 2 {
		t.Fatalf("issues = %d, want 2", rep.Issues)
	}
	if rep.Since == "" {
		t.Fatal("since empty with rows present")
	}

	// Everything was just written, so today and week match the all-time total.
	if rep.Today.Total != rep.Totals.Total || rep.Week.Total != rep.Totals.Total {
		t.Fatalf("today/week %d/%d != total %d", rep.Today.Total, rep.Week.Total, rep.Totals.Total)
	}

	// By responsibility: four agents, heaviest first.
	if len(rep.ByAgent) != 4 {
		t.Fatalf("byAgent = %d slices, want 4", len(rep.ByAgent))
	}
	if rep.ByAgent[0].Key != "repo" {
		t.Fatalf("heaviest agent = %q, want repo", rep.ByAgent[0].Key)
	}
	for i := 1; i < len(rep.ByAgent); i++ {
		if rep.ByAgent[i].Total > rep.ByAgent[i-1].Total {
			t.Fatalf("byAgent not sorted descending: %+v", rep.ByAgent)
		}
	}

	if len(rep.ByMode) != 2 {
		t.Fatalf("byMode = %d slices, want 2", len(rep.ByMode))
	}
	if rep.ByMode[0].Key != "deep" || rep.ByMode[0].Calls != 3 {
		t.Fatalf("byMode[0] = %+v, want deep with 3 calls", rep.ByMode[0])
	}

	if len(rep.Models) != 2 || rep.Models[0] != "claude-opus-5" {
		t.Fatalf("models = %v", rep.Models)
	}
}

func TestReportCarriesTokenUsage(t *testing.T) {
	st := testStore(t)
	if err := st.RecordTokenUsage(usageRow("i1", "deep", "github", "m", 1, 2, 3, 4, 0.1)); err != nil {
		t.Fatal(err)
	}
	rep, err := st.Report()
	if err != nil {
		t.Fatal(err)
	}
	tokens, ok := rep["tokens"].(TokenUsageReport)
	if !ok {
		t.Fatalf("report tokens key = %T, want TokenUsageReport", rep["tokens"])
	}
	if tokens.Totals.Total != 10 {
		t.Fatalf("tokens total = %d, want 10", tokens.Totals.Total)
	}
}
