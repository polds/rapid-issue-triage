package server

import (
	"net/http"

	"github.com/polds/rapid-issue-triage/internal/store"
)

// GET /api/theme — the persisted appearance override. The browser caches it
// in localStorage so the first paint does not flash the default palette; this
// is the source of truth it reconciles against.
func (s *Server) handleGetTheme(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.store.GetUITheme())
}

// PUT /api/theme — validate and persist a Linear theme string; "" clears it.
// The value is only ever six hex colors, so nothing else reaches a stylesheet.
func (s *Server) handlePutTheme(w http.ResponseWriter, r *http.Request) {
	var t store.UITheme
	if err := decodeBody(r, &t); err != nil {
		writeErr(w, 400, err)
		return
	}
	saved, err := s.store.SetUITheme(t)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, 200, saved)
}
