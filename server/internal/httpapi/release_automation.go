package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

// This optional extension keeps older test doubles and staged backend
// deployments explicit: unsupported endpoints return unavailable, never success.
type releaseAutomationStore interface {
	ArchiveReleaseAutomation(context.Context, product.Actor, string, int, bool) error
	AcceptGitHubEvent(context.Context, product.AcceptGitHubEventInput) (*product.GitHubEventAcceptance, error)
	ReleaseAutomationOverview(context.Context, product.Actor) (*product.AutomationOverview, error)
	SaveReleaseAutomation(context.Context, product.Actor, product.SaveAutomationInput) (*product.AutomationDefinition, error)
	ActivateReleaseAutomation(context.Context, product.Actor, string, int) (*product.AutomationDefinition, error)
	DisableReleaseAutomation(context.Context, product.Actor, string, int) error
	SetReleaseAutomationMode(context.Context, product.Actor, string, bool, *bool, *string) error
	StopWatchingAutomationSource(context.Context, product.Actor, string) error
	PreviewReleaseAutomation(context.Context, product.Actor, product.AutomationPreviewInput) (*product.AutomationPreview, error)
	ListAutomationHistory(context.Context, product.Actor, product.AutomationHistoryFilter) ([]product.AutomationHistoryItem, error)
	ListReleaseAutomationVersions(context.Context, product.Actor, string) ([]product.AutomationVersion, error)
	GetAutomationRun(context.Context, product.Actor, string) (*product.AutomationRunDetail, error)
	GetReleaseAutomationVersion(context.Context, product.Actor, string) (*product.AutomationVersion, error)
	CancelReleaseAutomationRun(context.Context, product.Actor, string) error
	RetryReleaseAutomationRun(context.Context, product.Actor, string) error
}

// The product configuration must keep satisfying the optional extension;
// a signature drift would otherwise surface only as a runtime 503.
var _ releaseAutomationStore = (*product.Configuration)(nil)

func (s *Server) automationStore(w http.ResponseWriter) releaseAutomationStore {
	store, ok := s.configuration.(releaseAutomationStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "release automation unavailable")
		return nil
	}
	return store
}

func (s *Server) registerReleaseAutomation(mux *http.ServeMux) {
	mux.Handle("PUT /v1/release-automation/{id}/archive", s.authenticateProduct(http.HandlerFunc(s.archiveAutomation)))
	mux.Handle("POST /v1/internal/github/events", s.authenticateService(http.HandlerFunc(s.acceptGitHubEvent)))
	mux.Handle("GET /v1/release-automation", s.authenticateProduct(http.HandlerFunc(s.automationOverview)))
	mux.Handle("PUT /v1/release-automation", s.authenticateProduct(http.HandlerFunc(s.saveAutomation)))
	mux.Handle("POST /v1/release-automation/preview", s.authenticateProduct(http.HandlerFunc(s.previewAutomation)))
	mux.Handle("POST /v1/release-automation/{id}/activation", s.authenticateProduct(http.HandlerFunc(s.activateAutomation)))
	mux.Handle("POST /v1/release-automation/{id}/disable", s.authenticateProduct(http.HandlerFunc(s.disableAutomation)))
	mux.Handle("PUT /v1/release-automation/sources/{id}/mode", s.authenticateProduct(http.HandlerFunc(s.automationSourceMode)))
	mux.Handle("POST /v1/release-automation/sources/{id}/disconnect", s.authenticateProduct(http.HandlerFunc(s.automationSourceDisconnect)))
	mux.Handle("GET /v1/release-automation/versions/{id}", s.authenticateProduct(http.HandlerFunc(s.automationVersion)))
	mux.Handle("GET /v1/release-automation/definitions/{id}/versions", s.authenticateProduct(http.HandlerFunc(s.automationVersions)))
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
	if err := decodeJSONLimit(r, &input, automation.MaxGitHubPayloadBytes+(1<<20)); err != nil {
		writeError(w, 400, "invalid or oversized GitHub event")
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
		Enabled          *bool   `json:"enabled"`
		CollectUnmatched *bool   `json:"collectUnmatched"`
		Branch           *string `json:"branch"`
	}
	if err := decodeJSON(r, &input); err != nil || input.Enabled == nil {
		writeError(w, 400, "invalid mode")
		return
	}
	if err := store.SetReleaseAutomationMode(r.Context(), workspaceActor(r), r.PathValue("id"), *input.Enabled, input.CollectUnmatched, input.Branch); err != nil {
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
	query := r.URL.Query()
	filter := product.AutomationHistoryFilter{Mode: query.Get("mode"), Before: query.Get("before"), DefinitionID: query.Get("definitionId"), VersionID: query.Get("versionId"),
		SourceAppID: query.Get("sourceAppId"), Family: automation.Family(query.Get("family")), Status: query.Get("status")}
	if value := query.Get("limit"); value != "" {
		limit, err := strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 50 {
			writeError(w, 400, "limit must be 1–50")
			return
		}
		filter.Limit = limit
	}
	for name, target := range map[string]**time.Time{"since": &filter.Since, "until": &filter.Until} {
		if value := query.Get(name); value != "" {
			parsed, err := time.Parse(time.RFC3339, value)
			if err != nil {
				writeError(w, 400, "invalid "+name)
				return
			}
			*target = &parsed
		}
	}
	result, err := store.ListAutomationHistory(r.Context(), workspaceActor(r), filter)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if query.Get("summary") == "true" {
		items := make([]product.AutomationHistorySummary, 0, len(result))
		for _, item := range result {
			items = append(items, product.SummarizeAutomationRun(item))
		}
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	writeJSON(w, 200, map[string]any{"items": result})
}
func (s *Server) automationVersions(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	result, err := store.ListReleaseAutomationVersions(r.Context(), workspaceActor(r), r.PathValue("id"))
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

func (s *Server) archiveAutomation(w http.ResponseWriter, r *http.Request) {
	store := s.automationStore(w)
	if store == nil {
		return
	}
	var input struct {
		Revision int   `json:"revision"`
		Archived *bool `json:"archived"`
	}
	if err := decodeJSON(r, &input); err != nil || input.Archived == nil || input.Revision < 1 {
		writeError(w, 400, "invalid archive request")
		return
	}
	if err := store.ArchiveReleaseAutomation(r.Context(), workspaceActor(r), r.PathValue("id"), input.Revision, *input.Archived); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"archived": *input.Archived})
}
