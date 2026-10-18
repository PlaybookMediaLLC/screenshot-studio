package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// OnboardingService runs the onboarding agent; *onboarding.Service is one.
type OnboardingService interface {
	Start(context.Context, product.Actor, onboarding.StartInput) (*onboarding.StartResult, error)
	Get(context.Context, product.Actor, string) (*product.OnboardingRunRecord, error)
	Cancel(context.Context, product.Actor, string) (*product.OnboardingRunRecord, error)
	Rerun(context.Context, product.Actor, string, string) (*onboarding.StartResult, error)
	CancelWorkspace(context.Context, string) error
}

// The onboarding agent's routes (docs/rfcs/032-background-onboarding-agent.md).
func (s *Server) registerOnboarding(mux *http.ServeMux) {
	mux.Handle("GET /v1/ideal-customer-profile", s.authenticateProduct(http.HandlerFunc(s.getIdealCustomerProfile)))
	mux.Handle("POST /v1/ideal-customer-profile", s.authenticateProduct(http.HandlerFunc(s.upsertIdealCustomerProfile)))
	mux.Handle("POST /v1/onboarding-runs", s.authenticateProduct(http.HandlerFunc(s.startOnboardingRun)))
	mux.Handle("GET /v1/onboarding-runs/latest", s.authenticateProduct(http.HandlerFunc(s.latestOnboardingRun)))
	mux.Handle("GET /v1/onboarding-runs/{id}", s.authenticateProduct(http.HandlerFunc(s.getOnboardingRun)))
	mux.Handle("POST /v1/onboarding-runs/{id}/cancel", s.authenticateProduct(http.HandlerFunc(s.cancelOnboardingRun)))
	mux.Handle("POST /v1/onboarding-runs/{id}/rerun", s.authenticateProduct(http.HandlerFunc(s.rerunOnboardingRun)))
}

func (s *Server) getIdealCustomerProfile(w http.ResponseWriter, r *http.Request) {
	profile, err := s.configuration.GetIdealCustomerProfile(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"idealCustomerProfile": profile})
}

// upsertIdealCustomerProfile validates and applies the change in the product layer.
func (s *Server) upsertIdealCustomerProfile(w http.ResponseWriter, r *http.Request) {
	var input product.UpsertIdealCustomerProfileInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	profile, err := s.configuration.UpsertIdealCustomerProfile(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

// startOnboardingRun is the fast path: drafts within ten seconds, then the
// background run. A replay or an active run answers 200 with that run.
func (s *Server) startOnboardingRun(w http.ResponseWriter, r *http.Request) {
	if s.onboarding == nil {
		writeError(w, http.StatusServiceUnavailable, "onboarding is unavailable")
		return
	}
	var input onboarding.StartInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	input.URL, input.Sentence, input.IdempotencyKey = strings.TrimSpace(input.URL), strings.TrimSpace(input.Sentence), strings.TrimSpace(input.IdempotencyKey)
	result, err := s.onboarding.Start(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, result)
}

// getOnboardingRun answers a running run's progress from its workflow.
func (s *Server) getOnboardingRun(w http.ResponseWriter, r *http.Request) {
	var run *product.OnboardingRunRecord
	var err error
	if s.onboarding != nil {
		run, err = s.onboarding.Get(r.Context(), workspaceActor(r), r.PathValue("id"))
	} else {
		run, err = s.configuration.GetOnboardingRun(r.Context(), workspaceActor(r), r.PathValue("id"))
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run})
}

func (s *Server) cancelOnboardingRun(w http.ResponseWriter, r *http.Request) {
	if s.onboarding == nil {
		writeError(w, http.StatusServiceUnavailable, "onboarding is unavailable")
		return
	}
	run, err := s.onboarding.Cancel(r.Context(), workspaceActor(r), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run})
}

// rerunOnboardingRun starts a new run for the run's URL; a replayed
// idempotency key returns the run it started.
func (s *Server) rerunOnboardingRun(w http.ResponseWriter, r *http.Request) {
	if s.onboarding == nil {
		writeError(w, http.StatusServiceUnavailable, "onboarding is unavailable")
		return
	}
	var input struct {
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := s.onboarding.Rerun(r.Context(), workspaceActor(r), r.PathValue("id"), strings.TrimSpace(input.IdempotencyKey))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, result)
}

func (s *Server) latestOnboardingRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.configuration.LatestOnboardingRun(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run})
}
