package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
)

// ContentDraftStore keeps a workspace's hand-written post drafts (RFC 037).
type ContentDraftStore interface {
	CreateContentDraft(context.Context, product.Actor, product.ContentDraftInput) (*product.ContentDraftRecord, error)
	GetContentDraft(context.Context, product.Actor, string) (*product.ContentDraftRecord, error)
	ListContentDrafts(context.Context, product.Actor, product.ContentDraftListQuery) (*product.ContentDraftPage, error)
	UpdateContentDraft(context.Context, product.Actor, string, product.ContentDraftUpdate) (*product.ContentDraftRecord, error)
	DeleteContentDraft(context.Context, product.Actor, string) error
	ScheduleContentDraft(context.Context, product.Actor, string, product.ScheduleContentDraftInput) (*product.ScheduleContentDraftResult, error)
	ListContentDraftPosts(context.Context, product.Actor, string) ([]product.ContentDraftPost, error)
	IssueContentDraftCollabToken(context.Context, product.Actor, string) (*product.CollabToken, error)
	AuthorizeCollab(context.Context, string, string) (*product.CollabGrant, error)
	LoadCollabState(context.Context, string, string) ([]byte, error)
	StoreCollabState(context.Context, string, string, []byte) error
}

func (s *Server) registerContentDrafts(mux *http.ServeMux) {
	mux.Handle("GET /v1/content-drafts", s.authenticateProduct(http.HandlerFunc(s.listContentDrafts)))
	mux.Handle("POST /v1/content-drafts", s.authenticateProduct(http.HandlerFunc(s.createContentDraft)))
	mux.Handle("GET /v1/content-drafts/{id}", s.authenticateProduct(http.HandlerFunc(s.getContentDraft)))
	mux.Handle("PATCH /v1/content-drafts/{id}", s.authenticateProduct(http.HandlerFunc(s.updateContentDraft)))
	mux.Handle("DELETE /v1/content-drafts/{id}", s.authenticateProduct(http.HandlerFunc(s.deleteContentDraft)))
	mux.Handle("POST /v1/content-drafts/{id}/schedule", s.authenticateProduct(http.HandlerFunc(s.scheduleContentDraft)))
	mux.Handle("GET /v1/content-drafts/{id}/posts", s.authenticateProduct(http.HandlerFunc(s.listContentDraftPosts)))
	mux.Handle("POST /v1/content-drafts/{id}/collab-token", s.authenticateProduct(http.HandlerFunc(s.issueCollabToken)))
	s.registerCollab(mux)
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

// scheduleContentDraft queues the draft to its channels, then stops the
// workflows of posts a reschedule replaced and starts the new ones. Starting
// is idempotent, so a replay after a failed start finishes the job.
func (s *Server) scheduleContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input product.ScheduleContentDraftInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid content draft schedule")
		return
	}
	result, err := s.configuration.ScheduleContentDraft(r.Context(), workspaceActor(r), id, input)
	if err != nil {
		writeContentDraftError(w, err)
		return
	}
	for _, postID := range result.Cancelled {
		if err := s.scheduler.Cancel(r.Context(), postID); err != nil {
			writeError(w, http.StatusServiceUnavailable, "could not stop a replaced publishing workflow")
			return
		}
	}
	for _, post := range result.Scheduled {
		if err := s.scheduler.Start(r.Context(), temporalpublishing.ScheduleInput{
			OrganizationID: post.OrganizationID, PostID: post.ID, ScheduledFor: post.ScheduledFor,
		}); err != nil {
			writeError(w, http.StatusServiceUnavailable, "could not start publishing workflow")
			return
		}
	}
	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, result)
}

func (s *Server) listContentDraftPosts(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	posts, err := s.configuration.ListContentDraftPosts(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": posts})
}

func (s *Server) issueCollabToken(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	token, err := s.configuration.IssueContentDraftCollabToken(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeCollabError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, token)
}
