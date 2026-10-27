package httpapi

import (
	"net/http"
)

// registerRender exposes the asset and design reads that rendering and the
// tenant storage proxy need, scoped to the forwarded principal's workspace.
func (s *Server) registerRender(mux *http.ServeMux) {
	mux.Handle("GET /v1/assets/lookup", s.authenticateProduct(http.HandlerFunc(s.findAssets)))
	mux.Handle("GET /v1/design-renders/{renderKey}", s.authenticateProduct(http.HandlerFunc(s.findDesignRender)))
}

func (s *Server) findAssets(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	items, err := s.configuration.FindAssets(r.Context(), workspaceActor(r), query["id"], query.Get("objectKey"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": items})
}

func (s *Server) findDesignRender(w http.ResponseWriter, r *http.Request) {
	item, err := s.configuration.FindDesignRender(r.Context(), workspaceActor(r), r.PathValue("renderKey"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}
