// Package server exposes the local HTTP API and serves the embedded web UI.
package server

import (
	"context"
	"encoding/json"
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
	store    *store.Store
	linear   *linear.Client
	syncer   *syncer.Syncer
	enricher *ai.Enricher       // nil when AI is disabled
	orch     *deep.Orchestrator // nil when deep enrichment is unavailable

	// enriching guards against duplicate concurrent enrichments per issue.
	mu        sync.Mutex
	enriching map[string]bool

	viewsCache   []linear.CustomView
	viewsCacheAt time.Time
}

func New(st *store.Store, lc *linear.Client, sy *syncer.Syncer, en *ai.Enricher, orch *deep.Orchestrator) *Server {
	return &Server{store: st, linear: lc, syncer: sy, enricher: en, orch: orch, enriching: map[string]bool{}}
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

func decodeBody(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

// bgCtx detaches long Linear calls from request cancellation where we must not
// leave half-applied state.
func bgCtx() context.Context { return context.Background() }
