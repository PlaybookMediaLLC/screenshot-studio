package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// WriteStore is the Write workspace (RFC 041): social sets with their tags
// and thread finishers, and a draft's properties, plan, copies, recovered
// backups and activity.
type WriteStore interface {
	ListSocialSets(context.Context, product.Actor) ([]product.SocialSetRecord, error)
	GetSocialSet(context.Context, product.Actor, string) (*product.SocialSetRecord, error)
	CreateSocialSet(context.Context, product.Actor, product.SocialSetInput) (*product.SocialSetRecord, error)
	UpdateSocialSet(context.Context, product.Actor, string, product.SocialSetInput) (*product.SocialSetRecord, error)
	DeleteSocialSet(context.Context, product.Actor, string) error
	ListContentDraftTags(context.Context, product.Actor, string) ([]product.ContentDraftTagRecord, error)
	CreateContentDraftTag(context.Context, product.Actor, string, product.ContentDraftTagInput) (*product.ContentDraftTagRecord, error)
	UpdateContentDraftTag(context.Context, product.Actor, string, string, product.ContentDraftTagInput) (*product.ContentDraftTagRecord, error)
	DeleteContentDraftTag(context.Context, product.Actor, string, string) error
	ListContentDraftFinishers(context.Context, product.Actor, string) ([]product.ContentDraftFinisherRecord, error)
	CreateContentDraftFinisher(context.Context, product.Actor, string, product.ContentDraftFinisherInput) (*product.ContentDraftFinisherRecord, error)
	UpdateContentDraftFinisher(context.Context, product.Actor, string, string, product.ContentDraftFinisherInput) (*product.ContentDraftFinisherRecord, error)
	DeleteContentDraftFinisher(context.Context, product.Actor, string, string) error
	UpdateContentDraftProperties(context.Context, product.Actor, string, product.ContentDraftPropertiesInput) (*product.ContentDraftRecord, error)
	PlanContentDraft(context.Context, product.Actor, string, product.ContentDraftPlanInput) (*product.ContentDraftRecord, error)
	DuplicateContentDraft(context.Context, product.Actor, string) (*product.ContentDraftCopyResult, error)
	CopyContentDraftToSet(context.Context, product.Actor, string, product.ContentDraftCopyInput) (*product.ContentDraftCopyResult, error)
	RecoverContentDraftRevision(context.Context, product.Actor, string, string) (*product.ContentDraftCopyResult, error)
	ListContentDraftActivity(context.Context, product.Actor, string) ([]product.ContentDraftActivity, error)
	ListPlannedContentDrafts(context.Context, product.Actor, time.Time, time.Time, string) ([]product.ContentDraftRecord, error)
	RetryContentDraftPost(context.Context, product.Actor, string) (*product.MovedDraftPost, error)
	ReconcileContentDraftPost(context.Context, product.Actor, string, product.ReconcileInput) (*product.ContentDraftPost, error)
}

func (s *Server) registerWrite(mux *http.ServeMux) {
	mux.Handle("GET /v1/social-sets", s.authenticateProduct(http.HandlerFunc(s.listSocialSets)))
	mux.Handle("POST /v1/social-sets", s.authenticateProduct(http.HandlerFunc(s.createSocialSet)))
	mux.Handle("GET /v1/social-sets/{id}", s.authenticateProduct(http.HandlerFunc(s.getSocialSet)))
	mux.Handle("PATCH /v1/social-sets/{id}", s.authenticateProduct(http.HandlerFunc(s.updateSocialSet)))
	mux.Handle("DELETE /v1/social-sets/{id}", s.authenticateProduct(http.HandlerFunc(s.deleteSocialSet)))
	mux.Handle("GET /v1/social-sets/{id}/tags", s.authenticateProduct(http.HandlerFunc(s.listDraftTags)))
	mux.Handle("POST /v1/social-sets/{id}/tags", s.authenticateProduct(http.HandlerFunc(s.createDraftTag)))
	mux.Handle("PATCH /v1/social-sets/{id}/tags/{itemId}", s.authenticateProduct(http.HandlerFunc(s.updateDraftTag)))
	mux.Handle("DELETE /v1/social-sets/{id}/tags/{itemId}", s.authenticateProduct(http.HandlerFunc(s.deleteDraftTag)))
	mux.Handle("GET /v1/social-sets/{id}/finishers", s.authenticateProduct(http.HandlerFunc(s.listDraftFinishers)))
	mux.Handle("POST /v1/social-sets/{id}/finishers", s.authenticateProduct(http.HandlerFunc(s.createDraftFinisher)))
	mux.Handle("PATCH /v1/social-sets/{id}/finishers/{itemId}", s.authenticateProduct(http.HandlerFunc(s.updateDraftFinisher)))
	mux.Handle("DELETE /v1/social-sets/{id}/finishers/{itemId}", s.authenticateProduct(http.HandlerFunc(s.deleteDraftFinisher)))
	mux.Handle("PATCH /v1/content-drafts/{id}/properties", s.authenticateProduct(http.HandlerFunc(s.updateDraftProperties)))
	mux.Handle("POST /v1/content-drafts/{id}/plan", s.authenticateProduct(http.HandlerFunc(s.planContentDraft)))
	mux.Handle("POST /v1/content-drafts/{id}/duplicate", s.authenticateProduct(http.HandlerFunc(s.duplicateContentDraft)))
	mux.Handle("POST /v1/content-drafts/{id}/copy", s.authenticateProduct(http.HandlerFunc(s.copyContentDraft)))
	mux.Handle("POST /v1/content-drafts/{id}/revisions/{revisionId}/recover", s.authenticateProduct(http.HandlerFunc(s.recoverContentDraft)))
	mux.Handle("GET /v1/content-drafts/{id}/activity", s.authenticateProduct(http.HandlerFunc(s.contentDraftActivity)))
	mux.Handle("GET /v1/content-draft-plans", s.authenticateProduct(http.HandlerFunc(s.listPlannedContentDrafts)))
	mux.Handle("POST /v1/content-draft-posts/{id}/retry", s.authenticateProduct(http.HandlerFunc(s.retryContentDraftPost)))
	mux.Handle("POST /v1/content-draft-posts/{id}/reconcile", s.authenticateProduct(http.HandlerFunc(s.reconcileContentDraftPost)))
}

// pathIDs reads path values that must be resource IDs.
func pathIDs(w http.ResponseWriter, r *http.Request, names ...string) ([]string, bool) {
	values := make([]string, 0, len(names))
	for _, name := range names {
		value := r.PathValue(name)
		if !resourceIDPattern.MatchString(value) {
			writeError(w, http.StatusBadRequest, "invalid "+name)
			return nil, false
		}
		values = append(values, value)
	}
	return values, true
}

// respond writes a store result, or its error.
func respond[T any](w http.ResponseWriter, status int, value T, err error) {
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, status, value)
}

func (s *Server) listSocialSets(w http.ResponseWriter, r *http.Request) {
	sets, err := s.configuration.ListSocialSets(r.Context(), workspaceActor(r))
	respond(w, http.StatusOK, map[string]any{"items": sets}, err)
}

func (s *Server) createSocialSet(w http.ResponseWriter, r *http.Request) {
	var input product.SocialSetInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid social set")
		return
	}
	set, err := s.configuration.CreateSocialSet(r.Context(), workspaceActor(r), input)
	respond(w, http.StatusCreated, set, err)
}

func (s *Server) getSocialSet(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	set, err := s.configuration.GetSocialSet(r.Context(), workspaceActor(r), ids[0])
	respond(w, http.StatusOK, set, err)
}

func (s *Server) updateSocialSet(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	var input product.SocialSetInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid social set")
		return
	}
	set, err := s.configuration.UpdateSocialSet(r.Context(), workspaceActor(r), ids[0], input)
	respond(w, http.StatusOK, set, err)
}

func (s *Server) deleteSocialSet(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	err := s.configuration.DeleteSocialSet(r.Context(), workspaceActor(r), ids[0])
	respond(w, http.StatusOK, map[string]bool{"deleted": true}, err)
}

func (s *Server) listDraftTags(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	tags, err := s.configuration.ListContentDraftTags(r.Context(), workspaceActor(r), ids[0])
	respond(w, http.StatusOK, map[string]any{"items": tags}, err)
}

func (s *Server) createDraftTag(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	var input product.ContentDraftTagInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid tag")
		return
	}
	tag, err := s.configuration.CreateContentDraftTag(r.Context(), workspaceActor(r), ids[0], input)
	respond(w, http.StatusCreated, tag, err)
}

func (s *Server) updateDraftTag(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id", "itemId")
	if !ok {
		return
	}
	var input product.ContentDraftTagInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid tag")
		return
	}
	tag, err := s.configuration.UpdateContentDraftTag(r.Context(), workspaceActor(r), ids[0], ids[1], input)
	respond(w, http.StatusOK, tag, err)
}

func (s *Server) deleteDraftTag(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id", "itemId")
	if !ok {
		return
	}
	err := s.configuration.DeleteContentDraftTag(r.Context(), workspaceActor(r), ids[0], ids[1])
	respond(w, http.StatusOK, map[string]bool{"deleted": true}, err)
}

func (s *Server) listDraftFinishers(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	finishers, err := s.configuration.ListContentDraftFinishers(r.Context(), workspaceActor(r), ids[0])
	respond(w, http.StatusOK, map[string]any{"items": finishers}, err)
}

func (s *Server) createDraftFinisher(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	var input product.ContentDraftFinisherInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid finisher")
		return
	}
	finisher, err := s.configuration.CreateContentDraftFinisher(r.Context(), workspaceActor(r), ids[0], input)
	respond(w, http.StatusCreated, finisher, err)
}

func (s *Server) updateDraftFinisher(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id", "itemId")
	if !ok {
		return
	}
	var input product.ContentDraftFinisherInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid finisher")
		return
	}
	finisher, err := s.configuration.UpdateContentDraftFinisher(r.Context(), workspaceActor(r), ids[0], ids[1], input)
	respond(w, http.StatusOK, finisher, err)
}

func (s *Server) deleteDraftFinisher(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id", "itemId")
	if !ok {
		return
	}
	err := s.configuration.DeleteContentDraftFinisher(r.Context(), workspaceActor(r), ids[0], ids[1])
	respond(w, http.StatusOK, map[string]bool{"deleted": true}, err)
}

func (s *Server) updateDraftProperties(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input product.ContentDraftPropertiesInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid draft properties")
		return
	}
	draft, err := s.configuration.UpdateContentDraftProperties(r.Context(), workspaceActor(r), id, input)
	respond(w, http.StatusOK, draft, err)
}

func (s *Server) planContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input product.ContentDraftPlanInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid plan")
		return
	}
	draft, err := s.configuration.PlanContentDraft(r.Context(), workspaceActor(r), id, input)
	respond(w, http.StatusOK, draft, err)
}

func (s *Server) duplicateContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	result, err := s.configuration.DuplicateContentDraft(r.Context(), workspaceActor(r), id)
	respond(w, http.StatusCreated, result, err)
}

func (s *Server) copyContentDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	var input product.ContentDraftCopyInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid copy")
		return
	}
	result, err := s.configuration.CopyContentDraftToSet(r.Context(), workspaceActor(r), id, input)
	respond(w, http.StatusCreated, result, err)
}

func (s *Server) recoverContentDraft(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id", "revisionId")
	if !ok {
		return
	}
	result, err := s.configuration.RecoverContentDraftRevision(r.Context(), workspaceActor(r), ids[0], ids[1])
	respond(w, http.StatusCreated, result, err)
}

func (s *Server) contentDraftActivity(w http.ResponseWriter, r *http.Request) {
	id, ok := contentDraftID(w, r)
	if !ok {
		return
	}
	items, err := s.configuration.ListContentDraftActivity(r.Context(), workspaceActor(r), id)
	respond(w, http.StatusOK, map[string]any{"items": items}, err)
}

func (s *Server) listPlannedContentDrafts(w http.ResponseWriter, r *http.Request) {
	from, fromErr := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	to, toErr := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil {
		writeError(w, http.StatusBadRequest, "from and to are RFC 3339 times")
		return
	}
	setID := r.URL.Query().Get("socialSetId")
	if setID != "" && !resourceIDPattern.MatchString(setID) {
		writeError(w, http.StatusBadRequest, "invalid social set ID")
		return
	}
	items, err := s.configuration.ListPlannedContentDrafts(r.Context(), workspaceActor(r), from, to, setID)
	respond(w, http.StatusOK, map[string]any{"items": items}, err)
}

// retryContentDraftPost publishes one failed destination again and starts
// its workflow; the draft's other posts are left as they are.
func (s *Server) retryContentDraftPost(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	retried, err := s.configuration.RetryContentDraftPost(r.Context(), workspaceActor(r), ids[0])
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if s.startMovedPost(w, r, retried) {
		writeJSON(w, http.StatusCreated, retried)
	}
}

// reconcileContentDraftPost records what a person found for a post whose
// outcome was unknown. Nothing is sent to the platform.
func (s *Server) reconcileContentDraftPost(w http.ResponseWriter, r *http.Request) {
	ids, ok := pathIDs(w, r, "id")
	if !ok {
		return
	}
	var input product.ReconcileInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid reconciliation")
		return
	}
	post, err := s.configuration.ReconcileContentDraftPost(r.Context(), workspaceActor(r), ids[0], input)
	respond(w, http.StatusOK, map[string]any{"post": post}, err)
}
