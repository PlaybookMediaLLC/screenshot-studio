package httpapi

import (
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// Store screenshot reviews (shareable snapshots with comments) and store
// publishing credentials. Link visitors never call these directly: the web
// verifies a signed review link and calls as its service principal.

func (s *Server) registerStoreScreenshots(mux *http.ServeMux) {
	mux.Handle("POST /v1/store-reviews", s.authenticateProduct(http.HandlerFunc(s.createStoreReview)))
	mux.Handle("GET /v1/store-reviews", s.authenticateProduct(http.HandlerFunc(s.listStoreReviews)))
	mux.Handle("GET /v1/store-reviews/{id}", s.authenticateProduct(http.HandlerFunc(s.getStoreReview)))
	mux.Handle("GET /v1/store-reviews/{id}/shared", s.authenticateProduct(http.HandlerFunc(s.getSharedStoreReview)))
	mux.Handle("POST /v1/store-reviews/{id}/revoke", s.authenticateProduct(http.HandlerFunc(s.revokeStoreReview)))
	mux.Handle("POST /v1/store-reviews/{id}/comments", s.authenticateProduct(http.HandlerFunc(s.addStoreReviewComment)))
	mux.Handle("PUT /v1/store-reviews/{id}/comments/{commentId}/resolution", s.authenticateProduct(http.HandlerFunc(s.resolveStoreReviewComment)))
	mux.Handle("GET /v1/store-publishing/credentials", s.authenticateProduct(http.HandlerFunc(s.listStoreCredentials)))
	mux.Handle("POST /v1/store-publishing/credentials", s.authenticateProduct(http.HandlerFunc(s.createStoreCredential)))
	mux.Handle("POST /v1/store-publishing/credentials/{id}/secret", s.authenticateProduct(http.HandlerFunc(s.getStoreCredentialSecret)))
	mux.Handle("DELETE /v1/store-publishing/credentials/{id}", s.authenticateProduct(http.HandlerFunc(s.deleteStoreCredential)))
}

func pathID(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	id := r.PathValue(name)
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid "+name)
		return "", false
	}
	return id, true
}

func (s *Server) createStoreReview(w http.ResponseWriter, r *http.Request) {
	var input product.CreateStoreReviewInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid review request")
		return
	}
	review, err := s.configuration.CreateStoreReview(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, review)
}

func (s *Server) listStoreReviews(w http.ResponseWriter, r *http.Request) {
	reviews, err := s.configuration.ListStoreReviews(r.Context(), workspaceActor(r), r.URL.Query().Get("projectId"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviews": reviews})
}

func (s *Server) getStoreReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	review, err := s.configuration.GetStoreReview(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, review)
}

func (s *Server) getSharedStoreReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	review, err := s.configuration.GetSharedStoreReview(r.Context(), workspaceActor(r), id, r.Header.Get("X-Share-Token-Id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, review)
}

func (s *Server) revokeStoreReview(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.configuration.RevokeStoreReview(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
}

func (s *Server) addStoreReviewComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var input product.AddStoreReviewCommentInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid comment")
		return
	}
	input.ShareTokenID = r.Header.Get("X-Share-Token-Id")
	comment, err := s.configuration.AddStoreReviewComment(r.Context(), workspaceActor(r), id, input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, comment)
}

func (s *Server) resolveStoreReviewComment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	commentID, ok := pathID(w, r, "commentId")
	if !ok {
		return
	}
	var input struct {
		Resolved bool `json:"resolved"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid resolution")
		return
	}
	if err := s.configuration.ResolveStoreReviewComment(r.Context(), workspaceActor(r), id, commentID, input.Resolved); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"resolved": input.Resolved})
}

func (s *Server) listStoreCredentials(w http.ResponseWriter, r *http.Request) {
	credentials, err := s.configuration.ListStorePublishingCredentials(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"credentials": credentials})
}

func (s *Server) createStoreCredential(w http.ResponseWriter, r *http.Request) {
	var input product.CreateStorePublishingCredentialInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid credential")
		return
	}
	credential, err := s.configuration.CreateStorePublishingCredential(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, credential)
}

func (s *Server) getStoreCredentialSecret(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	secret, err := s.configuration.GetStorePublishingCredentialSecret(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, secret)
}

func (s *Server) deleteStoreCredential(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.configuration.DeleteStorePublishingCredential(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
