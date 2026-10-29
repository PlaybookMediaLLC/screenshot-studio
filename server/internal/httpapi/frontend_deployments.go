package httpapi

import (
	"context"
	fd "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/frontenddeploy"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"net/http"
	"time"
)

type frontendStore interface {
	FrontendSources(context.Context, product.Actor) ([]product.FrontendSourceRecord, error)
	SaveFrontendSource(context.Context, product.Actor, product.FrontendSourceInput) (*product.FrontendSourceRecord, error)
	FrontendHistory(context.Context, product.Actor, string) ([]product.FrontendEvidenceRecord, error)
	AcceptFrontendWebhook(context.Context, string, string, []byte) error
}

var _ frontendStore = (*product.Configuration)(nil)

func (s *Server) frontendStore(w http.ResponseWriter) frontendStore {
	v, ok := s.configuration.(frontendStore)
	if !ok {
		writeError(w, 503, "deployment sources unavailable")
		return nil
	}
	return v
}

func (s *Server) registerFrontendDeployments(mux *http.ServeMux) {
	mux.Handle("GET /v1/frontend-sources", s.authenticateProduct(http.HandlerFunc(s.frontendSources)))
	mux.Handle("PUT /v1/frontend-sources", s.authenticateProduct(http.HandlerFunc(s.saveFrontendSource)))
	mux.Handle("GET /v1/frontend-sources/{id}/history", s.authenticateProduct(http.HandlerFunc(s.frontendHistory)))
	mux.Handle("POST /v1/frontend-sources/preview", s.authenticateProduct(http.HandlerFunc(s.previewFrontend)))
	mux.Handle("POST /v1/internal/frontend-webhooks/{id}", s.authenticateService(http.HandlerFunc(s.frontendWebhook)))
}
func (s *Server) frontendSources(w http.ResponseWriter, r *http.Request) {
	store := s.frontendStore(w)
	if store == nil {
		return
	}
	out, err := store.FrontendSources(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"sources": out})
}
func (s *Server) saveFrontendSource(w http.ResponseWriter, r *http.Request) {
	store := s.frontendStore(w)
	if store == nil {
		return
	}
	var in product.FrontendSourceInput
	if decodeJSON(r, &in) != nil {
		writeError(w, 400, "invalid source")
		return
	}
	out, err := store.SaveFrontendSource(r.Context(), workspaceActor(r), in)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) frontendHistory(w http.ResponseWriter, r *http.Request) {
	store := s.frontendStore(w)
	if store == nil {
		return
	}
	out, err := store.FrontendHistory(r.Context(), workspaceActor(r), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": out})
}
func (s *Server) previewFrontend(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.productReadActor(w, r); !ok {
		return
	}
	var in struct {
		Policy      fd.Policy      `json:"policy"`
		Observation fd.Observation `json:"observation"`
	}
	if decodeJSON(r, &in) != nil || fd.ValidatePolicy(in.Policy) != nil {
		writeError(w, 400, "invalid preview")
		return
	}
	writeJSON(w, 200, fd.Evaluate(in.Policy, in.Observation, time.Now()))
}
func (s *Server) frontendWebhook(w http.ResponseWriter, r *http.Request) {
	store := s.frontendStore(w)
	if store == nil {
		return
	}
	var in struct {
		Signature string `json:"signature"`
		Body      string `json:"body"`
	}
	if decodeJSONLimit(r, &in, 6*fd.MaxBody+8192) != nil || len(in.Body) > fd.MaxBody || len(in.Signature) > 4096 {
		writeError(w, 400, "invalid webhook")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if err := store.AcceptFrontendWebhook(ctx, r.PathValue("id"), in.Signature, []byte(in.Body)); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 202, map[string]bool{"accepted": true})
}
