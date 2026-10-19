package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// This optional extension keeps older test doubles and staged backend
// deployments explicit: unsupported endpoints return unavailable, never success.
type releaseAutomationStore interface {
	AcceptGitHubEvent(context.Context, product.AcceptGitHubEventInput) (*product.GitHubEventAcceptance, error)
	ReleaseAutomationOverview(context.Context, product.Actor) (*product.AutomationOverview, error)
	SaveReleaseAutomation(context.Context, product.Actor, product.SaveAutomationInput) (*product.AutomationDefinition, error)
	ActivateReleaseAutomation(context.Context, product.Actor, string, int) (*product.AutomationDefinition, error)
	DisableReleaseAutomation(context.Context, product.Actor, string, int) error
	SetReleaseAutomationMode(context.Context, product.Actor, string, bool, *bool) error
	StopWatchingAutomationSource(context.Context, product.Actor, string) error
	PreviewReleaseAutomation(context.Context, product.Actor, product.AutomationPreviewInput) (*product.AutomationPreview, error)
	ListAutomationHistory(context.Context, product.Actor, string) ([]product.AutomationHistoryItem, error)
	GetAutomationRun(context.Context, product.Actor, string) (*product.AutomationRunDetail, error)
	GetReleaseAutomationVersion(context.Context, product.Actor, string) (*product.AutomationVersion, error)
	CancelReleaseAutomationRun(context.Context, product.Actor, string) error
	RetryReleaseAutomationRun(context.Context, product.Actor, string) error
}

func (s *Server) automationStore(w http.ResponseWriter) releaseAutomationStore {
	store, ok := s.configuration.(releaseAutomationStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "release automation unavailable")
		return nil
	}
	return store
}

func (s *Server) registerReleaseAutomation(mux *http.ServeMux) {
	mux.Handle("POST /v1/internal/github/events", s.authenticateService(http.HandlerFunc(s.acceptGitHubEvent)))
	mux.Handle("GET /v1/release-automation", s.authenticateProduct(http.HandlerFunc(s.automationOverview)))
	mux.Handle("PUT /v1/release-automation", s.authenticateProduct(http.HandlerFunc(s.saveAutomation)))
	mux.Handle("POST /v1/release-automation/preview", s.authenticateProduct(http.HandlerFunc(s.previewAutomation)))
	mux.Handle("POST /v1/release-automation/{id}/activation", s.authenticateProduct(http.HandlerFunc(s.activateAutomation)))
	mux.Handle("POST /v1/release-automation/{id}/disable", s.authenticateProduct(http.HandlerFunc(s.disableAutomation)))
	mux.Handle("PUT /v1/release-automation/sources/{id}/mode", s.authenticateProduct(http.HandlerFunc(s.automationSourceMode)))
	mux.Handle("POST /v1/release-automation/sources/{id}/disconnect", s.authenticateProduct(http.HandlerFunc(s.automationSourceDisconnect)))
	mux.Handle("GET /v1/release-automation/versions/{id}", s.authenticateProduct(http.HandlerFunc(s.automationVersion)))
	mux.Handle("GET /v1/release-automation/runs", s.authenticateProduct(http.HandlerFunc(s.automationHistory)))
	mux.Handle("GET /v1/release-automation/runs/{id}", s.authenticateProduct(http.HandlerFunc(s.automationRun)))
	mux.Handle("POST /v1/release-automation/runs/{id}/cancel", s.authenticateProduct(http.HandlerFunc(s.cancelAutomationRun)))
	mux.Handle("POST /v1/release-automation/runs/{id}/retry", s.authenticateProduct(http.HandlerFunc(s.retryAutomationRun)))
}

func (s *Server) acceptGitHubEvent(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	var input product.AcceptGitHubEventInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "invalid event")
		return
	}
	// Bound the durable acceptance phase below GitHub's response deadline.
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	result, err := store.AcceptGitHubEvent(ctx, input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) automationOverview(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	result, err := store.ReleaseAutomationOverview(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) saveAutomation(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	var input product.SaveAutomationInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "invalid draft")
		return
	}
	result, err := store.SaveReleaseAutomation(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) activateAutomation(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	var input struct {
		Revision int `json:"revision"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "invalid revision")
		return
	}
	result, err := store.ActivateReleaseAutomation(r.Context(), workspaceActor(r), r.PathValue("id"), input.Revision)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) disableAutomation(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	var input struct {
		Revision int `json:"revision"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "invalid revision")
		return
	}
	if err := store.DisableReleaseAutomation(r.Context(), workspaceActor(r), r.PathValue("id"), input.Revision); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"disabled": true})
}
func (s *Server) automationSourceMode(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	var input struct {
		Enabled          *bool `json:"enabled"`
		CollectUnmatched *bool `json:"collectUnmatched"`
	}
	if err := decodeJSON(r, &input); err != nil || input.Enabled == nil {
		writeError(w, 400, "invalid mode")
		return
	}
	if err := store.SetReleaseAutomationMode(r.Context(), workspaceActor(r), r.PathValue("id"), *input.Enabled, input.CollectUnmatched); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"updated": true})
}

func (s *Server) automationSourceDisconnect(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	if err := store.StopWatchingAutomationSource(r.Context(), workspaceActor(r), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"disconnected": true})
}
func (s *Server) previewAutomation(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	var input product.AutomationPreviewInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, 400, "invalid preview")
		return
	}
	result, err := store.PreviewReleaseAutomation(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) automationVersion(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	result, err := store.GetReleaseAutomationVersion(r.Context(), workspaceActor(r), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) automationHistory(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	result, err := store.ListAutomationHistory(r.Context(), workspaceActor(r), r.URL.Query().Get("before"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": result})
}
func (s *Server) automationRun(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	result, err := store.GetAutomationRun(r.Context(), workspaceActor(r), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) cancelAutomationRun(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	if err := store.CancelReleaseAutomationRun(r.Context(), workspaceActor(r), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"requested": true})
}
func (s *Server) retryAutomationRun(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	if err := store.RetryReleaseAutomationRun(r.Context(), workspaceActor(r), r.PathValue("id")); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"requested": true})
}
