package server

import (
	"net/http"

	"github.com/polds/rapid-issue-triage/internal/update"
	"github.com/polds/rapid-issue-triage/internal/version"
)

// versionResponse is the body of GET /api/version and POST /api/version/check.
// Its JSON tags are the frontend's contract (web/src/lib/types.ts).
type versionResponse struct {
	version.Info
	Update update.Status `json:"update"`
}

func (s *Server) versionResponse() versionResponse {
	return versionResponse{Info: s.updates.Info(), Update: s.updates.Status()}
}

// handleVersion reports the running build and the last known update state. It
// never blocks on the network: the background checker owns the request, this
// only reads its snapshot.
func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.versionResponse())
}

// handleVersionCheck runs a check now, for the "Check for updates" button. A
// disabled checker and one already mid-check both return the current status
// unchanged, so the button can never fan out into repeated requests.
func (s *Server) handleVersionCheck(w http.ResponseWriter, r *http.Request) {
	st := s.updates.Check(r.Context())
	writeJSON(w, http.StatusOK, versionResponse{Info: s.updates.Info(), Update: st})
}
