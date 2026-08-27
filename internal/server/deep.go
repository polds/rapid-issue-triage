package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/polds/rapid-issue-triage/internal/deep"
	"github.com/polds/rapid-issue-triage/internal/store"
)

// --- enrichment settings ---

func (s *Server) handleGetEnrichSettings(w http.ResponseWriter, r *http.Request) {
	settings := s.store.GetEnrichSettings()
	writeJSON(w, 200, map[string]any{
		"settings":     settings,
		"availability": s.orch.Toolbox.Probe(settings),
		"deepReady":    s.orch != nil,
	})
}

func (s *Server) handlePutEnrichSettings(w http.ResponseWriter, r *http.Request) {
	var settings store.EnrichSettings
	if err := decodeBody(r, &settings); err != nil {
		writeErr(w, 400, err)
		return
	}
	if settings.Mode != "deep" {
		settings.Mode = "fast"
	}
	if err := s.store.SetEnrichSettings(settings); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"settings":     settings,
		"availability": s.orch.Toolbox.Probe(settings),
	})
}

// --- deep runs ---

func (s *Server) handleDeepEnrich(w http.ResponseWriter, r *http.Request) {
	if s.orch == nil {
		writeErr(w, 400, fmt.Errorf("deep enrichment unavailable (claude not found)"))
		return
	}
	issue, err := s.store.GetIssue(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	settings := s.store.GetEnrichSettings()
	runID, err := s.orch.Start(issue, settings)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 202, map[string]any{"runId": runID})
}

func (s *Server) handleRunGet(w http.ResponseWriter, r *http.Request) {
	run, err := s.store.GetEnrichRun(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	writeJSON(w, 200, run)
}

func (s *Server) handleIssueLatestRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.store.LatestRunForIssue(r.PathValue("id"))
	if err != nil {
		writeJSON(w, 200, map[string]any{"run": nil})
		return
	}
	writeJSON(w, 200, map[string]any{"run": run})
}

// handleRunEvents streams a run's events over SSE: full replay from the
// store, then live events until the run finishes.
func (s *Server) handleRunEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	if _, err := s.store.GetEnrichRun(runID); err != nil {
		writeErr(w, 404, err)
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, 500, fmt.Errorf("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	send := func(ev store.EnrichEvent) {
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
	}

	live, unsub := s.orch.Subscribe(runID)
	defer unsub()

	var lastSeq int64
	replay := func() bool {
		events, err := s.store.EnrichEvents(runID, lastSeq)
		if err != nil {
			return false
		}
		done := false
		for _, ev := range events {
			send(ev)
			lastSeq = ev.Seq
			if ev.Kind == "status" || ev.Kind == "error" {
				var p struct {
					State string `json:"state"`
					Error string `json:"error"`
				}
				_ = json.Unmarshal(ev.Payload, &p)
				if (ev.Agent == "orchestrator" && p.State == "done") || (ev.Agent == "orchestrator" && ev.Kind == "error") {
					done = true
				}
			}
		}
		fl.Flush()
		return done
	}
	if replay() {
		return
	}

	if live == nil {
		// Run not in memory (finished or restarted): poll the store briefly.
		t := time.NewTicker(1 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-t.C:
				if replay() {
					return
				}
				run, err := s.store.GetEnrichRun(runID)
				if err == nil && run.Status != "running" {
					replay()
					return
				}
			}
		}
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-live:
			if ev.Seq <= lastSeq {
				continue
			}
			// A gap means a dropped broadcast; re-sync from the store.
			if ev.Seq > lastSeq+1 {
				if replay() {
					return
				}
				continue
			}
			send(ev)
			lastSeq = ev.Seq
			fl.Flush()
			if ev.Agent == "orchestrator" {
				var p struct {
					State string `json:"state"`
				}
				_ = json.Unmarshal(ev.Payload, &p)
				if p.State == "done" || ev.Kind == "error" {
					return
				}
			}
		}
	}
}

// handleRunLog returns the complete action log as downloadable JSON.
func (s *Server) handleRunLog(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	run, err := s.store.GetEnrichRun(runID)
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	events, err := s.store.EnrichEvents(runID, 0)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s-%s.json", run.IssueIdentifier, runID))
	writeJSON(w, 200, map[string]any{"run": run, "events": events})
}

// --- toolbox: authenticated read-only proxy for scout agents ---

func (s *Server) handleToolbox(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string   `json:"token"`
		Agent string   `json:"agent"`
		Tool  string   `json:"tool"`
		Args  []string `json:"args"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	runID, ok := s.orch.ValidateToken(req.Token)
	if !ok {
		writeErr(w, 403, fmt.Errorf("invalid or expired run token"))
		return
	}
	// Gate by current settings: a disabled source stays disabled mid-run.
	settings := s.store.GetEnrichSettings()
	src := req.Tool
	if i := len(src); i > 0 {
		if dot := indexByte(src, '.'); dot > 0 {
			src = src[:dot]
		}
	}
	enabled := map[string]bool{
		"linear":  settings.Sources.Linear.Enabled,
		"github":  settings.Sources.GitHub.Enabled,
		"datadog": settings.Sources.Datadog.Enabled,
		"gcloud":  settings.Sources.Gcloud.Enabled,
	}
	if !enabled[src] {
		writeErr(w, 403, fmt.Errorf("source %q is disabled in settings", src))
		return
	}
	result, err := s.orch.Toolbox.Call(r.Context(), req.Tool, req.Args)
	s.orch.LogToolCall(runID, req.Agent, req.Tool, req.Args, result, err)
	if err != nil {
		writeJSON(w, 200, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"result": result})
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

var _ = deep.Availability{}
