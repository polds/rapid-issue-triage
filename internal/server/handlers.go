package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/polds/rapid-issue-triage/internal/linear"
	"github.com/polds/rapid-issue-triage/internal/store"
)

// errStopProbe short-circuits filter validation after the first page.
var errStopProbe = errors.New("probe ok")

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

// parseQueueFilter builds a view filter from query params. `team` remains as
// a shorthand for teams=<id>.
func parseQueueFilter(q url.Values) store.QueueFilter {
	csv := func(key string) []string {
		v := strings.TrimSpace(q.Get(key))
		if v == "" {
			return nil
		}
		parts := strings.Split(v, ",")
		out := parts[:0]
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	f := store.QueueFilter{
		TeamIDs:       csv("teams"),
		ExcludeTeams:  csv("excludeTeams"),
		Labels:        csv("labels"),
		ExcludeLabels: csv("excludeLabels"),
		Search:        q.Get("search"),
	}
	if t := q.Get("team"); t != "" {
		f.TeamIDs = append(f.TeamIDs, t)
	}
	for _, p := range csv("priorities") {
		if n, err := strconv.Atoi(p); err == nil {
			f.Priorities = append(f.Priorities, n)
		}
	}
	return f
}

func (s *Server) handleQueue(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var exclude []string
	if e := q.Get("exclude"); e != "" {
		exclude = strings.Split(e, ",")
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	filter := parseQueueFilter(q)
	rows, err := s.store.Queue(filter, exclude, limit)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if err := s.store.AttachEnrichments(rows); err != nil {
		writeErr(w, 500, err)
		return
	}
	count, _ := s.store.QueueCount(filter)
	writeJSON(w, 200, map[string]any{"issues": rows, "remaining": count})
}

// handleViews lists Linear custom views (cached for 5 minutes).
func (s *Server) handleViews(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	cached, at := s.viewsCache, s.viewsCacheAt
	s.mu.Unlock()
	if cached != nil && time.Since(at) < 5*time.Minute && r.URL.Query().Get("refresh") == "" {
		writeJSON(w, 200, map[string]any{"views": cached})
		return
	}
	views, err := s.linear.CustomViews(r.Context())
	if err != nil {
		if cached != nil {
			writeJSON(w, 200, map[string]any{"views": cached})
			return
		}
		writeErr(w, 502, err)
		return
	}
	// Only issue views are usable as an issue queue filter.
	filtered := views[:0]
	for _, v := range views {
		if v.ModelName == "" || strings.EqualFold(v.ModelName, "issue") {
			filtered = append(filtered, v)
		}
	}
	s.mu.Lock()
	s.viewsCache, s.viewsCacheAt = filtered, time.Now()
	s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"views": filtered})
}

// --- index (sync) filter management ---

const recentSyncFiltersKey = "recent_sync_filters"

func (s *Server) handleGetFilter(w http.ResponseWriter, r *http.Request) {
	var recent []map[string]any
	if raw, _ := s.store.GetMeta(recentSyncFiltersKey); raw != "" {
		_ = json.Unmarshal([]byte(raw), &recent)
	}
	stored, _ := s.store.GetMeta("active_sync_filter")
	writeJSON(w, 200, map[string]any{
		"filter":        s.syncer.ActiveFilter(),
		"default":       s.syncer.DefaultFilter(),
		"overridden":    stored != "",
		"recent":        recent,
		"syncStatus":    s.syncer.Status(),
	})
}

func (s *Server) handlePutFilter(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Filter map[string]any `json:"filter"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if len(req.Filter) == 0 {
		writeErr(w, 400, fmt.Errorf("filter must be a non-empty Linear IssueFilter object"))
		return
	}
	// Validate against Linear before committing: a 1-issue probe query.
	err := s.linear.Issues(r.Context(), req.Filter, 1, func(page []linear.Issue) error {
		return errStopProbe // one page is enough
	})
	if err != nil && err != errStopProbe {
		writeErr(w, 422, fmt.Errorf("Linear rejected this filter: %w", err))
		return
	}
	raw, _ := json.Marshal(req.Filter)
	if err := s.store.SetMeta("active_sync_filter", string(raw)); err != nil {
		writeErr(w, 500, err)
		return
	}
	s.pushRecentSyncFilter(string(raw))
	s.syncer.Kick()
	writeJSON(w, 200, map[string]any{"ok": true, "reindexing": true})
}

func (s *Server) handleDeleteFilter(w http.ResponseWriter, r *http.Request) {
	if err := s.store.SetMeta("active_sync_filter", ""); err != nil {
		writeErr(w, 500, err)
		return
	}
	s.syncer.Kick()
	writeJSON(w, 200, map[string]any{"ok": true, "reindexing": true})
}

// pushRecentSyncFilter records a filter in the recent list (dedup, cap 10).
func (s *Server) pushRecentSyncFilter(raw string) {
	var recent []map[string]any
	if prev, _ := s.store.GetMeta(recentSyncFiltersKey); prev != "" {
		_ = json.Unmarshal([]byte(prev), &recent)
	}
	out := []map[string]any{{"filter": json.RawMessage(raw), "usedAt": time.Now().UTC().Format(time.RFC3339)}}
	for _, e := range recent {
		if b, _ := json.Marshal(e["filter"]); string(b) != raw {
			out = append(out, e)
		}
		if len(out) >= 10 {
			break
		}
	}
	b, _ := json.Marshal(out)
	_ = s.store.SetMeta(recentSyncFiltersKey, string(b))
}

// handleLinearSearch searches Linear issues live (for the duplicate-of
// picker; canonical issues are usually not in the local untriaged index).
func (s *Server) handleLinearSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, 200, map[string]any{"issues": []any{}})
		return
	}
	res, err := s.orch.Toolbox.Call(r.Context(), "linear.search", []string{q})
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	writeJSON(w, 200, res)
}

// handleGetIssue returns one issue row with its enrichment attached.
func (s *Server) handleGetIssue(w http.ResponseWriter, r *http.Request) {
	issue, err := s.store.GetIssue(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	if e, err := s.store.GetEnrichment(issue.ID); err == nil {
		issue.Enrichment = e
	}
	writeJSON(w, 200, map[string]any{"issue": issue})
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
		DurationMS    *int64 `json:"durationMs"`
		DuplicateOfID string `json:"duplicateOfId"`
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
	steps := macro.Steps
	if req.DuplicateOfID != "" {
		steps = make([]store.MacroStep, len(macro.Steps))
		copy(steps, macro.Steps)
		for i := range steps {
			if steps[i].Type == "set_state" {
				steps[i].DuplicateOfID = req.DuplicateOfID
			}
		}
	}
	row, actID, err := s.applyOps(bgCtx(), issue, steps, "macro", macro.Outcome, req.DurationMS)
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
	// Detached context: an enrichment keeps running (and is stored) even if
	// the client navigates away mid-run.
	comments := s.commentsText(bgCtx(), id)
	enr, err := s.enricher.Enrich(bgCtx(), issue, comments)
	if err != nil {
		log.Printf("enrich %s: %v", issue.Identifier, err)
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
