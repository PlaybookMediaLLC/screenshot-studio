package httpapi

import "net/http"

func (s *Server) getEntitlements(w http.ResponseWriter, r *http.Request) {
	summary, err := s.configuration.GetEntitlementSummary(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) getFeatureDecision(w http.ResponseWriter, r *http.Request) {
	decision, err := s.configuration.GetFeatureDecision(r.Context(), workspaceActor(r), r.PathValue("feature"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, decision)
}
