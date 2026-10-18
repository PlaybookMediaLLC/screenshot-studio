package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

type fakeOnboarding struct {
	actor product.Actor
	input onboarding.StartInput
}

func (f *fakeOnboarding) Start(_ context.Context, actor product.Actor, input onboarding.StartInput) (*onboarding.StartResult, error) {
	f.actor, f.input = actor, input
	if input.URL == "ftp://bad" {
		return nil, product.ErrInvalidInput
	}
	return &onboarding.StartResult{Created: input.IdempotencyKey != "replay", Run: &product.OnboardingRunRecord{ID: "run-1"}}, nil
}

// A new run answers 201, a replay 200, bad input 400, and a backend without
// the agent 503; the actor comes from the forwarded headers, never the body.
func TestStartOnboardingRunStatuses(t *testing.T) {
	agent := &fakeOnboarding{}
	handler := NewWithOnboarding(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", &fakeConfiguration{}, agent)
	created := configurationRequest(handler, http.MethodPost, "/v1/onboarding-runs", `{"url":" https://acme.test ","sentence":" Invoices "}`)
	if created.Code != http.StatusCreated || !strings.Contains(created.Body.String(), `"id":"run-1"`) ||
		agent.input.URL != "https://acme.test" || agent.input.Sentence != "Invoices" || agent.actor.OrganizationID == "" {
		t.Fatalf("created status=%d body=%s input=%+v actor=%+v", created.Code, created.Body, agent.input, agent.actor)
	}
	if replay := configurationRequest(handler, http.MethodPost, "/v1/onboarding-runs", `{"url":"https://acme.test","idempotencyKey":"replay"}`); replay.Code != http.StatusOK {
		t.Fatalf("replay status=%d", replay.Code)
	}
	if bad := configurationRequest(handler, http.MethodPost, "/v1/onboarding-runs", `{"url":"ftp://bad"}`); bad.Code != http.StatusBadRequest {
		t.Fatalf("bad status=%d", bad.Code)
	}
	if unknown := configurationRequest(handler, http.MethodPost, "/v1/onboarding-runs", `{"url":"https://acme.test","workspaceId":"other"}`); unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d", unknown.Code)
	}
	without := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", &fakeConfiguration{})
	if unavailable := configurationRequest(without, http.MethodPost, "/v1/onboarding-runs", `{"url":"https://acme.test"}`); unavailable.Code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable status=%d", unavailable.Code)
	}
}
