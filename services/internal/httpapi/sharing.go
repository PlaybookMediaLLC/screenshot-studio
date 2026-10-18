package httpapi

import (
	"context"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// SharingStore publishes share links and keeps a workspace's Slack, Notion,
// and Figma connections.
type SharingStore interface {
	CreateShareLink(context.Context, product.Actor, product.ShareLinkInput) (*product.ShareLinkRecord, error)
	ListShareLinks(context.Context, product.Actor) ([]product.ShareLinkRecord, error)
	GetShareLink(context.Context, product.Actor, string) (*product.ShareLinkRecord, error)
	UpdateShareLink(context.Context, product.Actor, string, product.ShareLinkUpdate) (*product.ShareLinkRecord, error)
	RevokeShareLink(context.Context, product.Actor, string) error
	ResolveShareLink(context.Context, string) (*product.PublicShareLink, error)
	ShareLinkObjectURL(context.Context, string, string) (string, string, error)
	SaveIntegration(context.Context, product.Actor, product.IntegrationInput) (*product.IntegrationRecord, error)
	ListIntegrations(context.Context, product.Actor) ([]product.IntegrationRecord, error)
	IntegrationCredentials(context.Context, product.Actor, string) (*product.IntegrationWithCredentials, error)
	UpdateIntegrationCredentials(context.Context, product.Actor, string, product.IntegrationCredentialsUpdate) error
	DeleteIntegration(context.Context, product.Actor, string) error
}

func (s *Server) registerSharing(mux *http.ServeMux) {
	mux.Handle("GET /v1/share-links", s.authenticateProduct(http.HandlerFunc(s.listShareLinks)))
	mux.Handle("POST /v1/share-links", s.authenticateProduct(http.HandlerFunc(s.createShareLink)))
	mux.Handle("GET /v1/share-links/{id}", s.authenticateProduct(http.HandlerFunc(s.getShareLink)))
	mux.Handle("PATCH /v1/share-links/{id}", s.authenticateProduct(http.HandlerFunc(s.updateShareLink)))
	mux.Handle("DELETE /v1/share-links/{id}", s.authenticateProduct(http.HandlerFunc(s.revokeShareLink)))
	// The share page has no session: only the facade may resolve a token.
	mux.Handle("GET /v1/internal/share-links/{token}", s.authenticateService(http.HandlerFunc(s.resolveShareLink)))
	mux.Handle("GET /v1/internal/share-links/{token}/object-url", s.authenticateService(http.HandlerFunc(s.shareLinkObjectURL)))
	mux.Handle("GET /v1/integrations", s.authenticateProduct(http.HandlerFunc(s.listIntegrations)))
	mux.Handle("POST /v1/integrations", s.authenticateProduct(http.HandlerFunc(s.saveIntegration)))
	mux.Handle("GET /v1/integrations/{id}/credentials", s.authenticateProduct(http.HandlerFunc(s.integrationCredentials)))
	mux.Handle("PUT /v1/integrations/{id}/credentials", s.authenticateProduct(http.HandlerFunc(s.updateIntegrationCredentials)))
	mux.Handle("DELETE /v1/integrations/{id}", s.authenticateProduct(http.HandlerFunc(s.deleteIntegration)))
}

func (s *Server) listShareLinks(w http.ResponseWriter, r *http.Request) {
	items, err := s.configuration.ListShareLinks(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"shareLinks": items})
}

func (s *Server) createShareLink(w http.ResponseWriter, r *http.Request) {
	var input product.ShareLinkInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid share link")
		return
	}
	item, err := s.configuration.CreateShareLink(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) getShareLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	item, err := s.configuration.GetShareLink(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) updateShareLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var input product.ShareLinkUpdate
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid share link update")
		return
	}
	item, err := s.configuration.UpdateShareLink(r.Context(), workspaceActor(r), id, input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) revokeShareLink(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.configuration.RevokeShareLink(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
}

func (s *Server) resolveShareLink(w http.ResponseWriter, r *http.Request) {
	link, err := s.configuration.ResolveShareLink(r.Context(), r.PathValue("token"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, link)
}

func (s *Server) shareLinkObjectURL(w http.ResponseWriter, r *http.Request) {
	variant := r.URL.Query().Get("variant")
	if variant == "" {
		variant = "media"
	}
	url, mediaType, err := s.configuration.ShareLinkObjectURL(r.Context(), r.PathValue("token"), variant)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"mediaType": mediaType, "url": url})
}

func (s *Server) listIntegrations(w http.ResponseWriter, r *http.Request) {
	items, err := s.configuration.ListIntegrations(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"integrations": items})
}

func (s *Server) saveIntegration(w http.ResponseWriter, r *http.Request) {
	var input product.IntegrationInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid integration")
		return
	}
	item, err := s.configuration.SaveIntegration(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) integrationCredentials(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	item, err := s.configuration.IntegrationCredentials(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) updateIntegrationCredentials(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var input product.IntegrationCredentialsUpdate
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid credentials")
		return
	}
	if err := s.configuration.UpdateIntegrationCredentials(r.Context(), workspaceActor(r), id, input); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"updated": true})
}

func (s *Server) deleteIntegration(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.configuration.DeleteIntegration(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
