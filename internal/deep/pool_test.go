package deep

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/polds/rapid-issue-triage/internal/store"
)

func testOrchestrator(t *testing.T, maxConcurrent int) *Orchestrator {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return &Orchestrator{
		Store: st, Toolbox: &Toolbox{Store: st}, MaxConcurrent: maxConcurrent,
		runs: map[string]*run{},
	}
}

func issue(id, ident string) store.IssueRow {
	return store.IssueRow{ID: id, Identifier: ident, Title: ident + " title"}
}

// lastQueuedPosition returns the position on the newest queued status event.
func lastQueuedPosition(t *testing.T, o *Orchestrator, runID string) int {
	t.Helper()
	events, err := o.Store.EnrichEvents(runID, 0)
	if err != nil {
		t.Fatal(err)
	}
	pos := 0
	for _, ev := range events {
		if ev.Agent != "orchestrator" || ev.Kind != "status" {
			continue
		}
		var p struct {
			State    string `json:"state"`
			Position int    `json:"position"`
		}
		if json.Unmarshal(ev.Payload, &p) == nil && p.State == "queued" {
			pos = p.Position
		}
	}
	return pos
}

// TestStartQueuesWhenPoolIsFull pins the pool's bookkeeping without executing
// anything: both slots are already taken, so every new run must line up.
func TestStartQueuesWhenPoolIsFull(t *testing.T) {
	o := testOrchestrator(t, 2)
	o.active = 2

	first, err := o.Start(issue("i1", "ENG-1"), store.EnrichSettings{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := o.Start(issue("i2", "ENG-2"), store.EnrichSettings{})
	if err != nil {
		t.Fatal(err)
	}

	if first.Status != "queued" || first.Position != 1 {
		t.Errorf("first placement = %+v, want queued at 1", first)
	}
	if second.Status != "queued" || second.Position != 2 {
		t.Errorf("second placement = %+v, want queued at 2", second)
	}
	// The row a late-attaching browser reads must agree with the placement.
	row, err := o.Store.GetEnrichRun(first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "queued" {
		t.Errorf("stored status = %q, want queued", row.Status)
	}
	// ...and so must the event stream, which is what drives the live UI.
	if got := lastQueuedPosition(t, o, second.ID); got != 2 {
		t.Errorf("announced position = %d, want 2", got)
	}
}

// TestQueueAdvancesAsSlotsFree covers the part a static snapshot cannot: the
// line moves up and everyone behind is re-announced.
func TestQueueAdvancesAsSlotsFree(t *testing.T) {
	o := testOrchestrator(t, 1)
	o.active = 1

	held, err := o.Start(issue("i1", "ENG-1"), store.EnrichSettings{})
	if err != nil {
		t.Fatal(err)
	}
	behind, err := o.Start(issue("i2", "ENG-2"), store.EnrichSettings{})
	if err != nil {
		t.Fatal(err)
	}
	if behind.Position != 2 {
		t.Fatalf("second placement = %+v, want position 2", behind)
	}

	// The occupying run finishes. Nothing is enabled in these settings, so the
	// runs the drain launches fail fast instead of shelling out to claude.
	o.mu.Lock()
	o.active--
	o.mu.Unlock()
	o.drain("")

	if got := lastQueuedPosition(t, o, behind.ID); got != 1 {
		t.Errorf("second run's announced position = %d, want 1 after the line moved", got)
	}
	waitFinished(t, o, held.ID, behind.ID)
	o.mu.Lock()
	queued, active := len(o.queue), o.active
	o.mu.Unlock()
	if queued != 0 || active != 0 {
		t.Errorf("pool left with %d queued / %d active, want 0 / 0", queued, active)
	}
}

func waitFinished(t *testing.T, o *Orchestrator, ids ...string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for _, id := range ids {
		for {
			row, err := o.Store.GetEnrichRun(id)
			if err != nil {
				t.Fatal(err)
			}
			if row.Status != "running" && row.Status != "queued" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("run %s stuck at %q", id, row.Status)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestMaxConcurrentDefaults(t *testing.T) {
	if got := (&Orchestrator{}).maxConcurrent(); got != 2 {
		t.Errorf("maxConcurrent() = %d, want 2", got)
	}
	if got := (&Orchestrator{MaxConcurrent: 5}).maxConcurrent(); got != 5 {
		t.Errorf("maxConcurrent() = %d, want 5", got)
	}
}
