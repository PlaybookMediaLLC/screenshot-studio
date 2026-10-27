package httpapi

import (
	"net/http"
	"strings"
)

func (s *Server) verifySupportGrant(w http.ResponseWriter, r *http.Request) {
	organizationID := strings.TrimSpace(r.URL.Query().Get("organizationId"))
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if organizationID == "" || len(organizationID) > 128 || scope == "" || len(scope) > 128 {
		writeError(w, http.StatusBadRequest, "organizationId and scope are required")
		return
	}
	grant, err := s.configuration.VerifySupportGrant(r.Context(), workspaceActor(r), organizationID, scope)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, grant)
}

func (s *Server) enterpriseFeature(w http.ResponseWriter, r *http.Request) {
	feature := r.PathValue("feature")
	if feature != "ssoEnabled" && feature != "scimEnabled" {
		writeError(w, http.StatusBadRequest, "invalid enterprise feature")
		return
	}
	if err := s.configuration.RequireEnterpriseFeature(r.Context(), workspaceActor(r), feature); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": true})
}
