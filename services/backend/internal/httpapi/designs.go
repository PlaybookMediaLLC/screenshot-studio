package httpapi

import (
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/google/uuid"
)

func (s *Server) createDesign(w http.ResponseWriter, r *http.Request) {
	var input product.CreateDesignInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid design request")
		return
	}
	item, err := s.configuration.CreateDesign(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) getDesign(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid design ID")
		return
	}
	item, err := s.configuration.GetDesign(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) updateDesignDocument(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid design ID")
		return
	}
	var input struct {
		Document map[string]any `json:"document"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid design document")
		return
	}
	if err := s.configuration.UpdateDesignDocument(r.Context(), workspaceActor(r), id, input.Document); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (s *Server) setDesignRender(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid design ID")
		return
	}
	var input struct {
		AssetID   string  `json:"assetId"`
		RenderKey *string `json:"renderKey"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid design render")
		return
	}
	if _, err := uuid.Parse(input.AssetID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid asset ID")
		return
	}
	if err := s.configuration.SetDesignRender(r.Context(), workspaceActor(r), id, input.AssetID, input.RenderKey); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (s *Server) listCampaignDesigns(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid campaign ID")
		return
	}
	items, err := s.configuration.ListCampaignDesigns(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"designs": items})
}
