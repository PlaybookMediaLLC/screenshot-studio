package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// ContentDraftStore keeps a workspace's hand-written post drafts (RFC 037).
type ContentDraftStore interface {
	CreateContentDraft(context.Context, product.Actor, product.ContentDraftInput) (*product.ContentDraftRecord, error)
	GetContentDraft(context.Context, product.Actor, string) (*product.ContentDraftRecord, error)
	ListContentDrafts(context.Context, product.Actor, product.ContentDraftListQuery) (*product.ContentDraftPage, error)
	UpdateContentDraft(context.Context, product.Actor, string, product.ContentDraftUpdate) (*product.ContentDraftRecord, error)
	DeleteContentDraft(context.Context, product.Actor, string) error
}

func (s *Server) registerContentDrafts(mux *http.ServeMux) {
	mux.Handle("GET /v1/content-drafts", s.authenticateProduct(http.HandlerFunc(s.listContentDrafts)))
	mux.Handle("POST /v1/content-drafts", s.authenticateProduct(http.HandlerFunc(s.createContentDraft)))
	mux.Handle("GET /v1/content-drafts/{id}", s.authenticateProduct(http.HandlerFunc(s.getContentDraft)))
	mux.Handle("PATCH /v1/content-drafts/{id}", s.authenticateProduct(http.HandlerFunc(s.updateContentDraft)))
	mux.Handle("DELETE /v1/content-drafts/{id}", s.authenticateProduct(http.HandlerFunc(s.deleteContentDraft)))
}

// writeContentDraftError answers a stale write with the version the draft is
// at, so the client can load it instead of overwriting newer work.
func writeContentDraftError(w http.ResponseWriter, err error) {
	var stale *product.ContentDraftVersionConflictError
	if errors.As(err, &stale) {
		writeJSON(w, http.StatusConflict, map[string]any{
			"code": "content_draft_version_conflict", "currentVersion": stale.Current, "error": err.Error(),
		})
		return
	}
	writeStoreError(w, err)
}

func contentDraftID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid content draft ID")
		return "", false
	}
	return id, true
}

func (s *Server) listContentDrafts(w http.ResponseWriter, r *http.Request) {
	limit, ok := queryLimit(r, 24, 100)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid content draft limit")
		return
	}
	query := r.URL.Query()
	page, err := s.configuration.ListContentDrafts(r.Context(), workspaceActor(r), product.ContentDraftListQuery{
		Cursor: query.Get("cursor"), Limit: limit, Status: query.Get("status"),
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createContentDraft(w http.ResponseWriter, r *http.Request) {
	var input product.ContentDraftInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid content draft request")
		return
	}
	item, err := s.configuration.CreateContentDraft(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) getContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	item, err := s.configuration.GetContentDraft(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) updateContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input product.ContentDraftUpdate
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid content draft update")
		return
	}
	item, err := s.configuration.UpdateContentDraft(r.Context(), workspaceActor(r), id, input)
	if err != nil {
		writeContentDraftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	if err := s.configuration.DeleteContentDraft(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
