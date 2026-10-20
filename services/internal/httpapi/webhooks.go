package httpapi

import (
	"context"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
)

// WebhookStore manages a workspace's outbound webhooks (RFC 043).
type WebhookStore interface {
	ListWebhooks(context.Context, product.Actor) ([]product.WebhookRecord, error)
	CreateWebhook(context.Context, product.Actor, product.WebhookInput) (*product.WebhookWithSecret, error)
	UpdateWebhook(context.Context, product.Actor, string, product.WebhookUpdate) (*product.WebhookRecord, error)
	RotateWebhookSecret(context.Context, product.Actor, string) (*product.WebhookWithSecret, error)
	DeleteWebhook(context.Context, product.Actor, string) error
	TestWebhook(context.Context, product.Actor, string) (*product.WebhookDeliveryRecord, error)
	ListWebhookDeliveries(context.Context, product.Actor, string) ([]product.WebhookDeliveryRecord, error)
	RetryWebhookDelivery(context.Context, product.Actor, string) (*product.WebhookDeliveryRecord, error)
}

func (s *Server) registerWebhooks(mux *http.ServeMux) {
	product := func(handler http.HandlerFunc) http.Handler { return s.authenticateProduct(handler) }
	mux.Handle("GET /v1/webhooks", product(s.listWebhooks))
	mux.Handle("POST /v1/webhooks", product(s.createWebhook))
	mux.Handle("PATCH /v1/webhooks/{id}", product(s.updateWebhook))
	mux.Handle("DELETE /v1/webhooks/{id}", product(s.deleteWebhook))
	mux.Handle("POST /v1/webhooks/{id}/rotate", product(s.rotateWebhookSecret))
	mux.Handle("POST /v1/webhooks/{id}/test", product(s.testWebhook))
	mux.Handle("GET /v1/webhooks/{id}/deliveries", product(s.listWebhookDeliveries))
	mux.Handle("POST /v1/webhook-deliveries/{id}/retry", product(s.retryWebhookDelivery))
}

func (s *Server) listWebhooks(w http.ResponseWriter, r *http.Request) {
	items, err := s.configuration.ListWebhooks(r.Context(), workspaceActor(r))
	respond(w, http.StatusOK, map[string]any{"events": webhooks.EventTypes, "items": items}, err)
}

func (s *Server) createWebhook(w http.ResponseWriter, r *http.Request) {
	var input product.WebhookInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid webhook")
		return
	}
	created, err := s.configuration.CreateWebhook(r.Context(), workspaceActor(r), input)
	respond(w, http.StatusCreated, created, err)
}

func (s *Server) updateWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var input product.WebhookUpdate
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid webhook")
		return
	}
	updated, err := s.configuration.UpdateWebhook(r.Context(), workspaceActor(r), id, input)
	respond(w, http.StatusOK, updated, err)
}

func (s *Server) deleteWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.configuration.DeleteWebhook(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) rotateWebhookSecret(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	rotated, err := s.configuration.RotateWebhookSecret(r.Context(), workspaceActor(r), id)
	respond(w, http.StatusOK, rotated, err)
}

func (s *Server) testWebhook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	delivery, err := s.configuration.TestWebhook(r.Context(), workspaceActor(r), id)
	respond(w, http.StatusAccepted, delivery, err)
}

func (s *Server) listWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	items, err := s.configuration.ListWebhookDeliveries(r.Context(), workspaceActor(r), id)
	respond(w, http.StatusOK, map[string]any{"items": items}, err)
}

func (s *Server) retryWebhookDelivery(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	delivery, err := s.configuration.RetryWebhookDelivery(r.Context(), workspaceActor(r), id)
	respond(w, http.StatusAccepted, delivery, err)
}
