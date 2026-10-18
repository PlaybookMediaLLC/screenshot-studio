package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
)

// ContentDraftPlatformStore is content drafts' second round (RFC 037): the
// queue and its settings, best times, moving and resuming posts, review,
// guest share links, revisions, and live posts' engagement.
type ContentDraftPlatformStore interface {
	GetContentDraftSettings(context.Context, product.Actor) (*product.ContentDraftSettings, error)
	UpdateContentDraftSettings(context.Context, product.Actor, product.ContentDraftSettingsUpdate) (*product.ContentDraftSettings, error)
	NextQueueSlot(context.Context, product.Actor) (time.Time, error)
	BestPostingTimes(context.Context, product.Actor) ([]product.BestTime, error)
	MoveContentDraftPost(context.Context, product.Actor, string, time.Time) (*product.MovedDraftPost, error)
	ResumeContentDraftThread(context.Context, product.Actor, string) (*product.MovedDraftPost, error)
	ListContentDraftPostsBetween(context.Context, product.Actor, time.Time, time.Time) ([]product.CalendarPost, error)
	ReviewContentDraft(context.Context, product.Actor, string, product.ContentDraftReviewInput) (*product.ContentDraftRecord, error)
	ShareContentDraft(context.Context, product.Actor, string, bool) (*product.ContentDraftRecord, error)
	GetSharedContentDraft(context.Context, string) (*product.SharedContentDraft, error)
	AddGuestComment(context.Context, string, product.GuestCommentInput) (*product.SharedContentDraft, error)
	ListContentDraftRevisions(context.Context, product.Actor, string) ([]product.ContentDraftRevisionRecord, error)
	GetContentDraftRevision(context.Context, product.Actor, string, string) (*product.ContentDraftRevisionRecord, error)
	RefreshDraftPostMetrics(context.Context, product.Actor, string) (*product.ContentDraftPost, error)
}

func (s *Server) registerContentDraftPlatform(mux *http.ServeMux) {
	mux.Handle("GET /v1/content-draft-settings", s.authenticateProduct(http.HandlerFunc(s.getContentDraftSettings)))
	mux.Handle("PUT /v1/content-draft-settings", s.authenticateProduct(http.HandlerFunc(s.updateContentDraftSettings)))
	mux.Handle("GET /v1/content-draft-queue/next", s.authenticateProduct(http.HandlerFunc(s.nextQueueSlot)))
	mux.Handle("GET /v1/content-draft-queue/best-times", s.authenticateProduct(http.HandlerFunc(s.bestPostingTimes)))
	mux.Handle("GET /v1/content-draft-posts", s.authenticateProduct(http.HandlerFunc(s.listContentDraftPostsBetween)))
	mux.Handle("POST /v1/content-draft-posts/{id}/move", s.authenticateProduct(http.HandlerFunc(s.moveContentDraftPost)))
	mux.Handle("POST /v1/content-draft-posts/{id}/resume", s.authenticateProduct(http.HandlerFunc(s.resumeContentDraftThread)))
	mux.Handle("POST /v1/content-draft-posts/{id}/metrics", s.authenticateProduct(http.HandlerFunc(s.refreshDraftPostMetrics)))
	mux.Handle("POST /v1/content-drafts/{id}/review", s.authenticateProduct(http.HandlerFunc(s.reviewContentDraft)))
	mux.Handle("PUT /v1/content-drafts/{id}/share", s.authenticateProduct(http.HandlerFunc(s.shareContentDraft)))
	mux.Handle("GET /v1/content-drafts/{id}/revisions", s.authenticateProduct(http.HandlerFunc(s.listContentDraftRevisions)))
	mux.Handle("GET /v1/content-drafts/{id}/revisions/{revisionId}", s.authenticateProduct(http.HandlerFunc(s.getContentDraftRevision)))
	// A guest's share link: only the web app, with the service credential, reads it.
	mux.Handle("GET /v1/internal/content-draft-shares/{token}", s.authenticateService(http.HandlerFunc(s.getSharedContentDraft)))
	mux.Handle("POST /v1/internal/content-draft-shares/{token}/comments", s.authenticateService(http.HandlerFunc(s.addGuestComment)))
}

func (s *Server) getContentDraftSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.configuration.GetContentDraftSettings(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) updateContentDraftSettings(w http.ResponseWriter, r *http.Request) {
	var input product.ContentDraftSettingsUpdate
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid drafts settings")
		return
	}
	settings, err := s.configuration.UpdateContentDraftSettings(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) nextQueueSlot(w http.ResponseWriter, r *http.Request) {
	at, err := s.configuration.NextQueueSlot(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]time.Time{"scheduledFor": at})
}

func (s *Server) bestPostingTimes(w http.ResponseWriter, r *http.Request) {
	times, err := s.configuration.BestPostingTimes(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": times})
}

func (s *Server) listContentDraftPostsBetween(w http.ResponseWriter, r *http.Request) {
	from, fromErr := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	to, toErr := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil {
		writeError(w, http.StatusBadRequest, "from and to are RFC 3339 times")
		return
	}
	posts, err := s.configuration.ListContentDraftPostsBetween(r.Context(), workspaceActor(r), from, to)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": posts})
}

// startMovedPost stops the old post's workflow and starts the new one's.
func (s *Server) startMovedPost(w http.ResponseWriter, r *http.Request, moved *product.MovedDraftPost) bool {
	if moved.Cancelled != "" {
		if err := s.scheduler.Cancel(r.Context(), moved.Cancelled); err != nil {
			writeError(w, http.StatusServiceUnavailable, "could not stop the moved post's workflow")
			return false
		}
	}
	if err := s.scheduler.Start(r.Context(), temporalpublishing.ScheduleInput{
		OrganizationID: moved.Scheduled.OrganizationID, PostID: moved.Scheduled.ID, ScheduledFor: moved.Scheduled.ScheduledFor,
	}); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not start publishing workflow")
		return false
	}
	return true
}

func (s *Server) moveContentDraftPost(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input struct {
		ScheduledFor time.Time `json:"scheduledFor"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid post move")
		return
	}
	moved, err := s.configuration.MoveContentDraftPost(r.Context(), workspaceActor(r), id, input.ScheduledFor)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if s.startMovedPost(w, r, moved) {
		writeJSON(w, http.StatusOK, moved)
	}
}

func (s *Server) resumeContentDraftThread(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	resumed, err := s.configuration.ResumeContentDraftThread(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if s.startMovedPost(w, r, resumed) {
		writeJSON(w, http.StatusCreated, resumed)
	}
}

func (s *Server) refreshDraftPostMetrics(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	post, err := s.configuration.RefreshDraftPostMetrics(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, post)
}

func (s *Server) reviewContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input product.ContentDraftReviewInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid review")
		return
	}
	draft, err := s.configuration.ReviewContentDraft(r.Context(), workspaceActor(r), id, input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (s *Server) shareContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid share setting")
		return
	}
	draft, err := s.configuration.ShareContentDraft(r.Context(), workspaceActor(r), id, input.Enabled)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (s *Server) listContentDraftRevisions(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	revisions, err := s.configuration.ListContentDraftRevisions(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": revisions})
}

func (s *Server) getContentDraftRevision(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	revisionID := r.PathValue("revisionId")
	if !ok {
		return
	}
	if !resourceIDPattern.MatchString(revisionID) {
		writeError(w, http.StatusBadRequest, "invalid revision ID")
		return
	}
	revision, err := s.configuration.GetContentDraftRevision(r.Context(), workspaceActor(r), id, revisionID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, revision)
}

func (s *Server) getSharedContentDraft(w http.ResponseWriter, r *http.Request) {
	draft, err := s.configuration.GetSharedContentDraft(r.Context(), r.PathValue("token"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func (s *Server) addGuestComment(w http.ResponseWriter, r *http.Request) {
	var input product.GuestCommentInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid comment")
		return
	}
	draft, err := s.configuration.AddGuestComment(r.Context(), r.PathValue("token"), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, draft)
}
