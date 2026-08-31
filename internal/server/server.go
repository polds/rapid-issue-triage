// Package server exposes the local HTTP API and serves the embedded web UI.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/polds/rapid-issue-triage/internal/ai"
	"github.com/polds/rapid-issue-triage/internal/deep"
	"github.com/polds/rapid-issue-triage/internal/linear"
	"github.com/polds/rapid-issue-triage/internal/store"
	"github.com/polds/rapid-issue-triage/internal/syncer"
)

type Server struct {
	store         *store.Store
	linear        *linear.Client
	syncer        *syncer.Syncer
	enricher      *ai.Enricher       // nil when AI is disabled in config
	orch          *deep.Orchestrator // nil when AI is disabled in config
	defaultClaude string

	// enriching guards against duplicate concurrent enrichments per issue.
	mu        sync.Mutex
	enriching map[string]bool
	pickMu    sync.Mutex

	viewsCache   []linear.CustomView
	viewsCacheAt time.Time
}

func New(st *store.Store, lc *linear.Client, sy *syncer.Syncer, en *ai.Enricher, orch *deep.Orchestrator, defaultClaude string) *Server {
	s := &Server{
		store: st, linear: lc, syncer: sy, enricher: en, orch: orch,
		defaultClaude: defaultClaude, enriching: map[string]bool{},
	}
	s.applyClaudeCommand()
	return s
}

func (s *Server) Handler(ui fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/meta", s.handleMeta)
	mux.HandleFunc("GET /api/queue", s.handleQueue)
	mux.HandleFunc("GET /api/linear/search", s.handleLinearSearch)
	mux.HandleFunc("GET /api/issues/{id}", s.handleGetIssue)
	mux.HandleFunc("GET /api/issues/{id}/context", s.handleIssueContext)
	mux.HandleFunc("POST /api/issues/{id}/apply", s.handleApply)
	mux.HandleFunc("POST /api/issues/{id}/macro/{macroId}", s.handleRunMacro)
	mux.HandleFunc("POST /api/issues/{id}/skip", s.handleSkip)
	mux.HandleFunc("POST /api/issues/{id}/snooze", s.handleSnooze)
	mux.HandleFunc("POST /api/issues/{id}/enrich", s.handleEnrich)
	mux.HandleFunc("POST /api/issues/{id}/enrich/deep", s.handleDeepEnrich)
	mux.HandleFunc("GET /api/issues/{id}/runs/latest", s.handleIssueLatestRun)
	mux.HandleFunc("GET /api/enrich/settings", s.handleGetEnrichSettings)
	mux.HandleFunc("PUT /api/enrich/settings", s.handlePutEnrichSettings)
	mux.HandleFunc("PUT /api/secrets", s.handlePutSecret)
	mux.HandleFunc("POST /api/pick", s.handlePick)
	mux.HandleFunc("GET /api/enrich/runs/{id}", s.handleRunGet)
	mux.HandleFunc("GET /api/enrich/runs/{id}/events", s.handleRunEvents)
	mux.HandleFunc("GET /api/enrich/runs/{id}/log", s.handleRunLog)
	mux.HandleFunc("POST /api/toolbox", s.handleToolbox)
	mux.HandleFunc("POST /api/activity/{id}/undo", s.handleUndo)
	mux.HandleFunc("GET /api/macros", s.handleListMacros)
	mux.HandleFunc("POST /api/macros", s.handleCreateMacro)
	mux.HandleFunc("PUT /api/macros/{id}", s.handleUpdateMacro)
	mux.HandleFunc("DELETE /api/macros/{id}", s.handleDeleteMacro)
	mux.HandleFunc("GET /api/views", s.handleViews)
	mux.HandleFunc("GET /api/filter", s.handleGetFilter)
	mux.HandleFunc("PUT /api/filter", s.handlePutFilter)
	mux.HandleFunc("DELETE /api/filter", s.handleDeleteFilter)
	mux.HandleFunc("GET /api/report", s.handleReport)
	mux.HandleFunc("GET /api/sync/status", s.handleSyncStatus)
	mux.HandleFunc("POST /api/sync/refresh", s.handleSyncRefresh)
	mux.Handle("/", spaHandler(ui))
	return mux
}

// spaHandler serves the embedded frontend with an index.html fallback so
// client-side routes (/reports, /macros) deep-link correctly.
func spaHandler(ui fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(ui))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(ui, p); err != nil {
			r2 := new(http.Request)
			*r2 = *r
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

// writeActionErr reports a failed apply/macro run. A label-group clash is a
// conflict the user can resolve, not a Linear outage: it goes out as a 409 with
// the offending groups attached so the UI can prompt for a replacement.
func writeActionErr(w http.ResponseWriter, err error) {
	if lg, ok := errors.AsType[*labelGroupError](err); ok {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":      lg.Error(),
			"code":       "label_group_conflict",
			"conflicts":  lg.conflicts,
			"resolvable": lg.resolvable(),
		})
		return
	}
	writeErr(w, 502, err)
}

// issueGoneMsg explains a card action that named an issue the index no longer
// holds. The bare "not found" from the store reads as a bug; this is a normal
// race with the background sync.
const issueGoneMsg = "this issue is no longer indexed — the background sync dropped it after it left the index filter (triaged, closed, or reassigned in Linear)"

// writeIssueErr answers a request whose issue the store could not load. A
// pruned row goes out as a 404 carrying the machine-readable "issue_gone", so
// the UI can retire the card instead of reporting "Action failed: not found":
// the syncer deletes rows that leave the index filter, and a deck fetched
// minutes ago can still be holding one. Anything else is a real fault and a
// 500 — the old code answered 404 for those too.
func writeIssueErr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": issueGoneMsg,
			"code":  "issue_gone",
		})
		return
	}
	writeErr(w, http.StatusInternalServerError, err)
}

func decodeBody(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

// bgCtx detaches long Linear calls from request cancellation where we must not
// leave half-applied state.
func bgCtx() context.Context { return context.Background() }
