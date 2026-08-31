package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/polds/rapid-issue-triage/internal/store"
)

// --- deep runs ---

func (s *Server) handleDeepEnrich(w http.ResponseWriter, r *http.Request) {
	s.applyClaudeCommand()
	if s.orch == nil {
		writeErr(w, 400, fmt.Errorf("deep enrichment unavailable (AI disabled)"))
		return
	}
	if st := s.claudeStatus(); !st.Available {
		writeErr(w, 400, fmt.Errorf("claude not found: %s — set the path in Settings", st.Detail))
		return
	}
	issue, err := s.store.GetIssue(r.PathValue("id"))
	if err != nil {
		writeIssueErr(w, err)
		return
	}
	settings := s.store.GetEnrichSettings()
	// The pool may hold the run behind others; the placement says which, and
	// the same states arrive again over SSE as the line moves.
	placed, err := s.orch.Start(issue, settings)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 202, placed)
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

	live, unsub := s.orch.Subscribe(runID)
	defer unsub()

	var lastSeq int64
	if s.replayRunEvents(w, fl, runID, &lastSeq) {
		return
	}
	if live == nil {
		s.pollRunEvents(w, fl, r, runID, &lastSeq)
		return
	}
	s.forwardLiveRunEvents(w, fl, r, runID, live, &lastSeq)
}

// runUnfinished reports whether a run may still produce events. A pooled run
// sits at "queued" until a slot frees up, which is every bit as unfinished as
// "running" — treating it as terminal would close the stream on a run that
// has not started yet.
func runUnfinished(status string) bool {
	return status == "running" || status == "queued"
}

func sendSSE(w http.ResponseWriter, ev store.EnrichEvent) {
	b, _ := json.Marshal(ev)
	fmt.Fprintf(w, "data: %s\n\n", b)
}

func orchestratorFinished(ev store.EnrichEvent) bool {
	if ev.Agent != "orchestrator" {
		return false
	}
	if ev.Kind == "error" {
		return true
	}
	var p struct {
		State string `json:"state"`
		Error string `json:"error"`
	}
	_ = json.Unmarshal(ev.Payload, &p)
	return p.State == "done"
}

func (s *Server) replayRunEvents(w http.ResponseWriter, fl http.Flusher, runID string, lastSeq *int64) bool {
	events, err := s.store.EnrichEvents(runID, *lastSeq)
	if err != nil {
		return false
	}
	done := false
	for _, ev := range events {
		sendSSE(w, ev)
		*lastSeq = ev.Seq
		if ev.Kind == "status" || ev.Kind == "error" {
			done = done || orchestratorFinished(ev)
		}
	}
	fl.Flush()
	return done
}

func (s *Server) pollRunEvents(w http.ResponseWriter, fl http.Flusher, r *http.Request, runID string, lastSeq *int64) {
	t := time.NewTicker(1 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-t.C:
			if s.replayRunEvents(w, fl, runID, lastSeq) {
				return
			}
			run, err := s.store.GetEnrichRun(runID)
			if err == nil && !runUnfinished(run.Status) {
				s.replayRunEvents(w, fl, runID, lastSeq)
				return
			}
		}
	}
}

func (s *Server) forwardLiveRunEvents(w http.ResponseWriter, fl http.Flusher, r *http.Request, runID string, live <-chan store.EnrichEvent, lastSeq *int64) {
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-live:
			if ev.Seq <= *lastSeq {
				continue
			}
			if ev.Seq > *lastSeq+1 {
				if s.replayRunEvents(w, fl, runID, lastSeq) {
					return
				}
				continue
			}
			sendSSE(w, ev)
			*lastSeq = ev.Seq
			fl.Flush()
			if orchestratorFinished(ev) {
				return
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
		if dot := strings.IndexByte(src, '.'); dot > 0 {
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
