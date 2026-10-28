package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

type githubProductionStore interface {
	GetGitHubProduction(context.Context, product.Actor, string, string) (*product.GitHubProductionState, error)
	SaveGitHubProduction(context.Context, product.Actor, string, product.SaveProductionPolicyInput) (*product.ProductionPolicyVersion, error)
	PreviewGitHubProduction(context.Context, product.Actor, string, product.ProductionPreviewInput) (automation.ProductionDecision, error)
	GitHubProductionCatalog(context.Context, product.Actor, string, int64, int) (*product.GitHubProductionCatalog, error)
	GetGitHubRecovery(context.Context, product.Actor, string) (*product.GitHubRecoveryStatus, error)
	InspectGitHubRecovery(context.Context, product.Actor, string, bool) (*product.GitHubRecoveryStatus, error)
}

var _ githubProductionStore = (*product.Configuration)(nil)

func (s *Server) registerGitHubProduction(mux *http.ServeMux) {
	for _, pattern := range []string{"GET /v1/github/sources/{id}/production", "PUT /v1/github/sources/{id}/production", "POST /v1/github/sources/{id}/production-preview", "GET /v1/github/sources/{id}/production-catalog", "GET /v1/github/sources/{id}/delivery-recovery", "POST /v1/github/sources/{id}/delivery-recovery"} {
		mux.Handle(pattern, s.authenticateProduct(http.HandlerFunc(s.githubProduction)))
	}
}
func (s *Server) githubProduction(w http.ResponseWriter, r *http.Request) {
	store, ok := s.configuration.(githubProductionStore)
	if !ok {
		writeError(w, 503, "GitHub production policies unavailable")
		return
	}
	actor, id := workspaceActor(r), r.PathValue("id")
	var result any
	var err error
	switch r.Pattern {
	case "GET /v1/github/sources/{id}/production":
		result, err = store.GetGitHubProduction(r.Context(), actor, id, r.URL.Query().Get("cursor"))
	case "PUT /v1/github/sources/{id}/production":
		var input product.SaveProductionPolicyInput
		if decodeJSON(r, &input) != nil {
			writeError(w, 400, "invalid production policy")
			return
		}
		result, err = store.SaveGitHubProduction(r.Context(), actor, id, input)
	case "POST /v1/github/sources/{id}/production-preview":
		var input product.ProductionPreviewInput
		if decodeJSON(r, &input) != nil {
			writeError(w, 400, "invalid preview")
			return
		}
		result, err = store.PreviewGitHubProduction(r.Context(), actor, id, input)
	case "GET /v1/github/sources/{id}/production-catalog":
		runText, attemptText := r.URL.Query().Get("runId"), r.URL.Query().Get("attempt")
		run, runErr := strconv.ParseInt(runText, 10, 64)
		attempt, attemptErr := strconv.Atoi(attemptText)
		if runText != "" && runErr != nil || attemptText != "" && attemptErr != nil || run < 0 || attempt < 0 || (run == 0) != (attempt == 0) {
			writeError(w, 400, "invalid run attempt")
			return
		}
		result, err = store.GitHubProductionCatalog(r.Context(), actor, id, run, attempt)
	case "GET /v1/github/sources/{id}/delivery-recovery":
		result, err = store.GetGitHubRecovery(r.Context(), actor, id)
	case "POST /v1/github/sources/{id}/delivery-recovery":
		var input struct {
			Redeliver bool `json:"redeliver"`
		}
		if decodeJSON(r, &input) != nil {
			writeError(w, 400, "invalid recovery request")
			return
		}
		result, err = store.InspectGitHubRecovery(r.Context(), actor, id, input.Redeliver)
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
