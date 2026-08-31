package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/polds/rapid-issue-triage/internal/version"
)

func newTestChecker(t *testing.T, current string, h http.HandlerFunc) *Checker {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return New(Options{
		Info:    version.Info{Version: current},
		Repo:    "polds/rapid-issue-triage",
		Enabled: true,
		BaseURL: srv.URL,
		Client:  srv.Client(),
	})
}

func TestCheckFindsNewerRelease(t *testing.T) {
	var path string
	c := newTestChecker(t, "v0.1.1", func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		if r.Header.Get("User-Agent") == "" {
			t.Error("request carried no User-Agent; github rejects those")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://example.test/releases/v0.2.0"}`))
	})
	st := c.Check(t.Context())
	if path != "/repos/polds/rapid-issue-triage/releases/latest" {
		t.Errorf("requested %q", path)
	}
	if !st.Available || st.Latest != "v0.2.0" {
		t.Errorf("status = %+v, want v0.2.0 available", st)
	}
	if st.ReleaseURL != "https://example.test/releases/v0.2.0" {
		t.Errorf("ReleaseURL = %q", st.ReleaseURL)
	}
	if st.CheckedAt == "" || st.Checking || st.Error != "" {
		t.Errorf("status = %+v, want a finished, error-free check", st)
	}
	if got := c.Status(); got != st {
		t.Errorf("Status() = %+v, want the checked status %+v", got, st)
	}
}

func TestCheckUpToDateAndDevBuild(t *testing.T) {
	body := `{"tag_name":"v0.1.1","html_url":"https://example.test/r"}`
	for _, tc := range []struct{ name, current string }{
		{"same version", "v0.1.1"},
		{"newer local build", "v0.2.0"},
		{"unreleased build", "dev"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestChecker(t, tc.current, func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(body))
			})
			if st := c.Check(t.Context()); st.Available {
				t.Errorf("status = %+v, want no update offered", st)
			}
		})
	}
}

// A repo with no releases is the normal state of a fork, not a failure.
func TestCheckNoReleasesIsNotAnError(t *testing.T) {
	c := newTestChecker(t, "v0.1.1", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	st := c.Check(t.Context())
	if st.Error != "" || st.Available || st.Latest != "" {
		t.Errorf("status = %+v, want a clean empty result", st)
	}
	if st.ReleaseURL != "https://github.com/polds/rapid-issue-triage/releases/latest" {
		t.Errorf("ReleaseURL = %q, want the releases page fallback", st.ReleaseURL)
	}
}

func TestCheckErrorsKeepLastGoodResult(t *testing.T) {
	code := http.StatusOK
	c := newTestChecker(t, "v0.1.1", func(w http.ResponseWriter, _ *http.Request) {
		if code != http.StatusOK {
			w.WriteHeader(code)
			return
		}
		_, _ = w.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://example.test/r"}`))
	})
	if st := c.Check(t.Context()); !st.Available {
		t.Fatalf("first check = %+v, want an update", st)
	}
	code = http.StatusForbidden
	st := c.Check(t.Context())
	if st.Error == "" {
		t.Error("Error is empty after a 403")
	}
	if !st.Available || st.Latest != "v0.2.0" {
		t.Errorf("status = %+v, want the last known release preserved", st)
	}
	code = http.StatusOK
	if st := c.Check(t.Context()); st.Error != "" {
		t.Errorf("Error = %q, want it cleared by a success", st.Error)
	}
}

func TestCheckRejectsBadPayloads(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"not json", `<html>nope</html>`},
		{"no tag", `{"html_url":"https://example.test/r"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestChecker(t, "v0.1.1", func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(tc.body))
			})
			if st := c.Check(t.Context()); st.Error == "" {
				t.Errorf("status = %+v, want an error", st)
			}
		})
	}
}

// The whole point of the config switch: nothing may leave the machine.
func TestDisabledCheckerNeverRequests(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("disabled checker made a request")
	}))
	defer srv.Close()
	c := New(Options{Info: version.Info{Version: "v0.1.1"}, BaseURL: srv.URL, Client: srv.Client()})
	if st := c.Check(t.Context()); st.Enabled || st.CheckedAt != "" {
		t.Errorf("status = %+v, want an untouched disabled status", st)
	}
	ctx := t.Context()
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Error("Run did not return immediately when disabled")
	}
}

func TestNewNormalizesOptions(t *testing.T) {
	cases := []struct {
		name         string
		in           Options
		wantRepo     string
		wantInterval time.Duration
	}{
		{"defaults", Options{}, DefaultRepo, DefaultInterval},
		{"floors a tiny interval", Options{Interval: time.Second}, DefaultRepo, MinInterval},
		{"keeps a sane interval", Options{Interval: 6 * time.Hour}, DefaultRepo, 6 * time.Hour},
		{"rejects a path traversal repo", Options{Repo: "../../evil"}, DefaultRepo, DefaultInterval},
		{"rejects a host in the repo", Options{Repo: "https://evil.test/a/b"}, DefaultRepo, DefaultInterval},
		{"keeps a valid repo", Options{Repo: "octocat/Hello-World"}, "octocat/Hello-World", DefaultInterval},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := New(c.in)
			if got.repo != c.wantRepo {
				t.Errorf("repo = %q, want %q", got.repo, c.wantRepo)
			}
			if got.interval != c.wantInterval {
				t.Errorf("interval = %v, want %v", got.interval, c.wantInterval)
			}
			if got.baseURL != defaultBaseURL || got.client == nil {
				t.Errorf("baseURL = %q, client = %v", got.baseURL, got.client)
			}
		})
	}
}

// Run checks on its own, and stops with its context.
func TestRunChecksOnItsOwnAndStops(t *testing.T) {
	c := newTestChecker(t, "v0.1.1", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"tag_name":"v0.3.0","html_url":"https://example.test/r"}`))
	})
	// Reach past the constructor: a test cannot wait 20s for the first check.
	c.firstDelay = time.Millisecond
	c.interval = MinInterval
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()

	deadline := time.Now().Add(3 * time.Second)
	var st Status
	for time.Now().Before(deadline) {
		if st = c.Status(); st.CheckedAt != "" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !st.Available || st.Latest != "v0.3.0" {
		t.Fatalf("status = %+v, want the background check to have recorded v0.3.0", st)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Error("Run did not return when its context was canceled")
	}
}
