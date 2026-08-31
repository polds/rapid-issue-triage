package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/polds/rapid-issue-triage/internal/store"
	"github.com/polds/rapid-issue-triage/internal/update"
	"github.com/polds/rapid-issue-triage/internal/version"
)

// The response is flat: version.Info is embedded, so the frontend reads
// `version` and `update.available` off one object. Nothing else in CI checks
// that shape against web/src/lib/types.ts.
func TestHandleVersionShape(t *testing.T) {
	s := &Server{updates: update.New(update.Options{
		Info:    version.Info{Version: "v0.1.1", Commit: "abc123", Date: "2026-08-28T00:00:00Z"},
		Enabled: true,
	})}
	rec := httptest.NewRecorder()
	s.handleVersion(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Version string `json:"version"`
		Commit  string `json:"commit"`
		Date    string `json:"date"`
		Dev     bool   `json:"dev"`
		Update  struct {
			Enabled   bool   `json:"enabled"`
			Available bool   `json:"available"`
			Latest    string `json:"latest"`
			CheckedAt string `json:"checkedAt"`
		} `json:"update"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body)
	}
	if body.Version != "v0.1.1" || body.Commit != "abc123" || body.Date != "2026-08-28T00:00:00Z" {
		t.Errorf("build stamp = %+v", body)
	}
	if body.Dev || !body.Update.Enabled || body.Update.Available {
		t.Errorf("update block = %+v", body.Update)
	}
	// Nothing has run yet, so the check reports as never performed rather than
	// as a failure.
	if body.Update.CheckedAt != "" || body.Update.Latest != "" {
		t.Errorf("unchecked status leaked a result: %+v", body.Update)
	}
}

// A disabled checker still answers with the running version — the UI shows it
// and simply offers no update state.
func TestHandleVersionCheckDisabled(t *testing.T) {
	s := &Server{updates: update.New(update.Options{Info: version.Info{Version: "dev", Dev: true}})}
	rec := httptest.NewRecorder()
	s.handleVersionCheck(rec, httptest.NewRequest(http.MethodPost, "/api/version/check", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body versionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Version != "dev" || !body.Dev {
		t.Errorf("build stamp = %+v", body.Info)
	}
	if body.Update.Enabled || body.Update.CheckedAt != "" {
		t.Errorf("disabled checker performed a check: %+v", body.Update)
	}
}

// A nil checker is a valid construction (tests that never touch /api/version
// pass one), and it must not turn the version endpoint into a panic.
func TestNilCheckerBecomesDisabled(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	s := New(st, nil, nil, nil, nil, "", nil)
	rec := httptest.NewRecorder()
	s.handleVersion(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body versionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Update.Enabled {
		t.Errorf("update block = %+v, want a disabled checker", body.Update)
	}
}
