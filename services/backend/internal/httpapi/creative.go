package httpapi

import (
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

func (s *Server) listCreativeTemplates(w http.ResponseWriter, r *http.Request) {
	items, err := s.configuration.ListCreativeTemplates(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": items})
}

func (s *Server) createCreativeTemplate(w http.ResponseWriter, r *http.Request) {
	var input product.CreateCreativeTemplateInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid creative template")
		return
	}
	item, err := s.configuration.CreateCreativeTemplate(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) createCreativeVariant(w http.ResponseWriter, r *http.Request) {
	var input product.CreateCreativeVariantInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid creative variant")
		return
	}
	item, err := s.configuration.CreateCreativeVariant(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) decideCreativeVariant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid creative variant ID")
		return
	}
	var input product.CreativeApprovalInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid creative approval")
		return
	}
	result, err := s.configuration.DecideCreativeVariant(r.Context(), workspaceActor(r), id, input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
