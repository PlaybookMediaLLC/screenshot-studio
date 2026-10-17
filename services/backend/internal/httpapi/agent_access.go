package httpapi

import (
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// Agent consent (RFC 037): the web's OAuth consent page validates a request,
// then records a signed-in owner's or admin's approval. The code it returns
// is exchanged for a workspace API key at the social backend's /oauth/token.
func (s *Server) registerAgentAccess(mux *http.ServeMux) {
	mux.Handle("POST /v1/agent-authorizations/preview", s.authenticateProduct(http.HandlerFunc(s.previewAgentAuthorization)))
	mux.Handle("POST /v1/agent-authorizations", s.authenticateProduct(http.HandlerFunc(s.approveAgentAuthorization)))
}

func (s *Server) previewAgentAuthorization(w http.ResponseWriter, r *http.Request) {
	var input product.AgentAuthorizationRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent authorization request")
		return
	}
	consent, err := s.configuration.DescribeAgentClient(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, consent)
}

func (s *Server) approveAgentAuthorization(w http.ResponseWriter, r *http.Request) {
	var input product.AgentAuthorizationRequest
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid agent authorization request")
		return
	}
	code, err := s.configuration.ApproveAgentAccess(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, code)
}
