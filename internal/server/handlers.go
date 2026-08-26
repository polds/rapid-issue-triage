package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/polds/rapid-issue-triage/internal/store"
)

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	meta, err := s.store.Metadata()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	meta["sync"] = s.syncer.Status()
	counts, err := s.store.TeamCounts()
	if err == nil {
		meta["teamCounts"] = counts
	}
	meta["aiEnabled"] = s.enricher != nil
	writeJSON(w, 200, meta)
}

func (s *Server) handleQueue(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var exclude []string
	if e := q.Get("exclude"); e != "" {
		exclude = strings.Split(e, ",")
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	rows, err := s.store.Queue(q.Get("team"), exclude, limit)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if err := s.store.AttachEnrichments(rows); err != nil {
		writeErr(w, 500, err)
		return
	}
	count, _ := s.store.QueueCount(q.Get("team"))
	writeJSON(w, 200, map[string]any{"issues": rows, "remaining": count})
}

// handleIssueContext returns comments, fetched live from Linear and cached
// for 10 minutes.
func (s *Server) handleIssueContext(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cached, fetchedAt, err := s.store.GetIssueContext(id)
	if err == nil && cached != "" {
		if ts, perr := time.Parse(time.RFC3339, fetchedAt); perr == nil && time.Since(ts) < 10*time.Minute {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(cached))
			return
		}
	}
	comments, err := s.linear.IssueComments(r.Context(), id)
	if err != nil {
		// Serve stale cache over an error if we have one.
		if cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(cached))
			return
		}
		writeErr(w, 502, err)
		return
	}
	payload, _ := json.Marshal(map[string]any{"comments": comments})
	_ = s.store.SetIssueContext(id, string(payload))
	w.Header().Set("Content-Type", "application/json")
	w.Write(payload)
}

type applyRequest struct {
	Ops        []Op   `json:"ops"`
	Outcome    string `json:"outcome"`
	DurationMS *int64 `json:"durationMs"`
}

func (s *Server) handleApply(w http.ResponseWriter, r *http.Request) {
	var req applyRequest
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	issue, err := s.store.GetIssue(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	outcome := req.Outcome
	if outcome == "" {
		outcome = "edited"
	}
	row, actID, err := s.applyOps(bgCtx(), issue, req.Ops, "edit", outcome, req.DurationMS)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, 200, map[string]any{"issue": row, "activityId": actID})
}

func (s *Server) handleRunMacro(w http.ResponseWriter, r *http.Request) {
	macroID, err := strconv.ParseInt(r.PathValue("macroId"), 10, 64)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	var req struct {
		DurationMS *int64 `json:"durationMs"`
	}
	_ = decodeBody(r, &req)
	macro, err := s.store.GetMacro(macroID)
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	issue, err := s.store.GetIssue(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	row, actID, err := s.applyOps(bgCtx(), issue, macro.Steps, "macro", macro.Outcome, req.DurationMS)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, 200, map[string]any{"issue": row, "activityId": actID, "macro": macro.Name})
}

func (s *Server) handleSkip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DurationMS *int64 `json:"durationMs"`
	}
	_ = decodeBody(r, &req)
	issue, err := s.store.GetIssue(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	if err := s.store.MarkSkipped(issue.ID); err != nil {
		writeErr(w, 500, err)
		return
	}
	actID, err := s.store.LogActivity(store.Activity{
		IssueID: issue.ID, IssueIdentifier: issue.Identifier, IssueTitle: issue.Title,
		Kind: "skip", Outcome: "skipped", PrevJSON: prevSnapshot(issue), DurationMS: req.DurationMS,
	})
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"activityId": actID})
}

func (s *Server) handleSnooze(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Hours      int    `json:"hours"`
		DurationMS *int64 `json:"durationMs"`
	}
	_ = decodeBody(r, &req)
	if req.Hours <= 0 {
		req.Hours = 24 * 7
	}
	issue, err := s.store.GetIssue(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	if err := s.store.MarkSnoozed(issue.ID, time.Now().Add(time.Duration(req.Hours)*time.Hour)); err != nil {
		writeErr(w, 500, err)
		return
	}
	actID, err := s.store.LogActivity(store.Activity{
		IssueID: issue.ID, IssueIdentifier: issue.Identifier, IssueTitle: issue.Title,
		Kind: "snooze", Outcome: "snoozed", PrevJSON: prevSnapshot(issue), DurationMS: req.DurationMS,
	})
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"activityId": actID})
}

func (s *Server) handleEnrich(w http.ResponseWriter, r *http.Request) {
	if s.enricher == nil {
		writeErr(w, 400, fmt.Errorf("AI enrichment is disabled"))
		return
	}
	id := r.PathValue("id")
	s.mu.Lock()
	if s.enriching[id] {
		s.mu.Unlock()
		writeJSON(w, 202, map[string]any{"status": "in_progress"})
		return
	}
	s.enriching[id] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.enriching, id)
		s.mu.Unlock()
	}()

	issue, err := s.store.GetIssue(id)
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	comments := s.commentsText(r.Context(), id)
	enr, err := s.enricher.Enrich(r.Context(), issue, comments)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	if err := s.store.SaveEnrichment(enr); err != nil {
		writeErr(w, 500, err)
		return
	}
	saved, _ := s.store.GetEnrichment(id)
	writeJSON(w, 200, map[string]any{"enrichment": saved})
}

// commentsText renders the cached/live comment thread as plain text for the
// AI prompt. Best-effort: empty on failure.
func (s *Server) commentsText(ctx context.Context, issueID string) string {
	cached, _, err := s.store.GetIssueContext(issueID)
	if err != nil || cached == "" {
		comments, err := s.linear.IssueComments(ctx, issueID)
		if err != nil {
			return ""
		}
		payload, _ := json.Marshal(map[string]any{"comments": comments})
		cached = string(payload)
		_ = s.store.SetIssueContext(issueID, cached)
	}
	var parsed struct {
		Comments []struct {
			Body string `json:"body"`
			User *struct {
				DisplayName string `json:"displayName"`
				Name        string `json:"name"`
			} `json:"user"`
			CreatedAt string `json:"createdAt"`
		} `json:"comments"`
	}
	if err := json.Unmarshal([]byte(cached), &parsed); err != nil {
		return ""
	}
	var b strings.Builder
	for _, c := range parsed.Comments {
		who := "someone"
		if c.User != nil {
			if c.User.DisplayName != "" {
				who = c.User.DisplayName
			} else {
				who = c.User.Name
			}
		}
		fmt.Fprintf(&b, "[%s] %s: %s\n", c.CreatedAt, who, c.Body)
	}
	return b.String()
}

func (s *Server) handleUndo(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	act, err := s.store.GetActivity(id)
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	if err := s.undoActivity(bgCtx(), act); err != nil {
		writeErr(w, 502, err)
		return
	}
	issue, err := s.store.GetIssue(act.IssueID)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "issue": issue})
}

func (s *Server) handleListMacros(w http.ResponseWriter, r *http.Request) {
	macros, err := s.store.ListMacros()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"macros": macros})
}

func (s *Server) handleCreateMacro(w http.ResponseWriter, r *http.Request) {
	var m store.Macro
	if err := decodeBody(r, &m); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := validateMacro(m); err != nil {
		writeErr(w, 400, err)
		return
	}
	created, err := s.store.CreateMacro(m)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, created)
}

func (s *Server) handleUpdateMacro(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	var m store.Macro
	if err := decodeBody(r, &m); err != nil {
		writeErr(w, 400, err)
		return
	}
	m.ID = id
	if err := validateMacro(m); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.store.UpdateMacro(m); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, m)
}

func (s *Server) handleDeleteMacro(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.store.DeleteMacro(id); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func validateMacro(m store.Macro) error {
	if strings.TrimSpace(m.Name) == "" {
		return fmt.Errorf("macro name is required")
	}
	if len(m.Steps) == 0 {
		return fmt.Errorf("macro needs at least one step")
	}
	switch m.Outcome {
	case "accepted", "cancelled", "done", "custom", "":
	default:
		return fmt.Errorf("outcome must be accepted, cancelled, done, or custom")
	}
	return nil
}

func (s *Server) handleReport(w http.ResponseWriter, r *http.Request) {
	rep, err := s.store.Report()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, rep)
}

func (s *Server) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.syncer.Status())
}

func (s *Server) handleSyncRefresh(w http.ResponseWriter, r *http.Request) {
	s.syncer.Kick()
	writeJSON(w, 202, map[string]any{"status": "started"})
}

// PrefetchEnrichments runs forever, keeping the next few queue items enriched
// so cards arrive with AI context already attached.
func (s *Server) PrefetchEnrichments(ctx context.Context, n int) {
	if s.enricher == nil || n <= 0 {
		return
	}
	t := time.NewTicker(20 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		ids, err := s.store.UnenrichedQueueHeads(n)
		if err != nil {
			continue
		}
		for _, id := range ids {
			s.mu.Lock()
			busy := s.enriching[id]
			if !busy {
				s.enriching[id] = true
			}
			s.mu.Unlock()
			if busy {
				continue
			}
			issue, err := s.store.GetIssue(id)
			if err == nil {
				comments := s.commentsText(ctx, id)
				if enr, err := s.enricher.Enrich(ctx, issue, comments); err == nil {
					_ = s.store.SaveEnrichment(enr)
				} else {
					log.Printf("prefetch enrich %s: %v", issue.Identifier, err)
				}
			}
			s.mu.Lock()
			delete(s.enriching, id)
			s.mu.Unlock()
		}
	}
}
