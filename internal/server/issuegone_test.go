package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/polds/rapid-issue-triage/internal/store"
)

// goneServer seeds one issue at sync generation 1, then prunes it the way a
// background sync does once the issue leaves the index filter. The deck in the
// browser still holds the card at that point — this is the race behind
// "Action failed: not found" on Skip and Snooze.
func goneServer(t *testing.T) (*Server, string) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	tx, err := st.Begin()
	if err != nil {
		t.Fatal(err)
	}
	row := store.IssueRow{
		ID: "i1", Identifier: "ENG-1", Title: "seeded", TeamID: "t1",
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := st.UpsertIssue(tx, 1, row); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := st.PruneStale(2); err != nil {
		t.Fatal(err)
	}
	return New(st, nil, nil, nil, nil, ""), row.ID
}

func postIssue(t *testing.T, h http.HandlerFunc, id string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/issues/"+id+"/x", strings.NewReader("{}"))
	r.SetPathValue("id", id)
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

func TestSkipAndSnoozeOnPrunedIssueReportIssueGone(t *testing.T) {
	s, id := goneServer(t)
	for name, h := range map[string]http.HandlerFunc{
		"skip":   s.handleSkip,
		"snooze": s.handleSnooze,
	} {
		t.Run(name, func(t *testing.T) {
			w := postIssue(t, h, id)
			if w.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", w.Code)
			}
			var body struct {
				Error string `json:"error"`
				Code  string `json:"code"`
			}
			if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.Code != "issue_gone" {
				t.Fatalf("code = %q, want issue_gone", body.Code)
			}
			// The bare "not found" is what the user saw as
			// "Action failed: not found"; the reply must explain itself.
			if body.Error == "not found" || body.Error == "" {
				t.Fatalf("error = %q, want an explanation", body.Error)
			}
		})
	}
}

// A live issue is untouched by the new error path.
func TestSkipOnLiveIssueStillSucceeds(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	tx, err := st.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertIssue(tx, 1, store.IssueRow{
		ID: "i1", Identifier: "ENG-1", Title: "live", TeamID: "t1",
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	w := postIssue(t, New(st, nil, nil, nil, nil, "").handleSkip, "i1")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", w.Code, w.Body.String())
	}
}
