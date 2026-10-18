package httpapi

import (
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// The onboarding agent's routes (docs/rfcs/032-background-onboarding-agent.md).
func (s *Server) registerOnboarding(mux *http.ServeMux) {
	mux.Handle("GET /v1/ideal-customer-profile", s.authenticateProduct(http.HandlerFunc(s.getIdealCustomerProfile)))
	mux.Handle("POST /v1/ideal-customer-profile", s.authenticateProduct(http.HandlerFunc(s.upsertIdealCustomerProfile)))
}

func (s *Server) getIdealCustomerProfile(w http.ResponseWriter, r *http.Request) {
	profile, err := s.configuration.GetIdealCustomerProfile(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"idealCustomerProfile": profile})
}

// upsertIdealCustomerProfile validates and applies the change in the product layer.
func (s *Server) upsertIdealCustomerProfile(w http.ResponseWriter, r *http.Request) {
	var input product.UpsertIdealCustomerProfileInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	profile, err := s.configuration.UpsertIdealCustomerProfile(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}
