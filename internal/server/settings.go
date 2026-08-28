package server

import (
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/polds/rapid-issue-triage/internal/config"
	"github.com/polds/rapid-issue-triage/internal/store"
)

// ClaudeAvail is the live probe of the Claude Code CLI.
type ClaudeAvail struct {
	Available bool   `json:"available"`
	Command   string `json:"command"`
	Path      string `json:"path,omitempty"`
	Detail    string `json:"detail"`
}

func (s *Server) claudeCommand() string {
	if p := strings.TrimSpace(s.store.GetEnrichSettings().ClaudePath); p != "" {
		return config.ExpandHome(p)
	}
	if s.defaultClaude != "" {
		return s.defaultClaude
	}
	return "claude"
}

func (s *Server) applyClaudeCommand() {
	cmd := s.claudeCommand()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.enricher != nil {
		s.enricher.Command = cmd
	}
	if s.orch != nil {
		s.orch.Command = cmd
	}
}

func (s *Server) claudeStatus() ClaudeAvail {
	cmd := s.claudeCommand()
	a := ClaudeAvail{Command: cmd}
	resolved, err := exec.LookPath(cmd)
	if err != nil {
		if filepath.IsAbs(cmd) {
			a.Detail = fmt.Sprintf("%q not found", cmd)
		} else {
			a.Detail = fmt.Sprintf("%q not found in PATH", cmd)
		}
		return a
	}
	a.Available = true
	a.Path = resolved
	a.Detail = resolved
	return a
}

func (s *Server) enrichSettingsPayload() map[string]any {
	settings := s.store.GetEnrichSettings()
	claude := s.claudeStatus()
	payload := map[string]any{
		"settings":  settings,
		"claude":    claude,
		"secrets":   s.store.SecretStatus(),
		"deepReady": s.orch != nil && claude.Available,
	}
	if s.orch != nil {
		payload["availability"] = s.orch.Toolbox.Probe(settings)
	}
	return payload
}

func (s *Server) handleGetEnrichSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.enrichSettingsPayload())
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
	s.applyClaudeCommand()
	writeJSON(w, 200, s.enrichSettingsPayload())
}

func (s *Server) handlePutSecret(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if err := s.store.SetSecret(req.Key, req.Value); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.Key == "linear_api_key" {
		key := s.store.Resolve("linear_api_key")
		if key == "" {
			key = config.Lookup("LINEAR_API_KEY")
		}
		s.linear.SetAPIKey(key)
	}
	writeJSON(w, 200, s.enrichSettingsPayload())
}

func (s *Server) handlePick(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind string `json:"kind"`
	}
	_ = decodeBody(r, &req)
	if req.Kind == "" {
		req.Kind = "folder"
	}
	if req.Kind != "folder" && req.Kind != "file" {
		writeErr(w, 400, fmt.Errorf("kind must be folder or file"))
		return
	}
	if !s.pickMu.TryLock() {
		writeErr(w, 409, fmt.Errorf("a picker is already open"))
		return
	}
	defer s.pickMu.Unlock()

	path, err := pickPath(req.Kind)
	if err != nil {
		if errors.Is(err, errPickCanceled) {
			writeJSON(w, 200, map[string]any{"path": "", "canceled": true})
			return
		}
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"path": path})
}
