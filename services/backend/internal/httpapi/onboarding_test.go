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
	actor     product.Actor
	cancelled []string
	input     onboarding.StartInput
}

func (f *fakeOnboarding) Get(_ context.Context, _ product.Actor, id string) (*product.OnboardingRunRecord, error) {
	return &product.OnboardingRunRecord{ID: id, Progress: 55}, nil
}
func (f *fakeOnboarding) Cancel(_ context.Context, _ product.Actor, id string) (*product.OnboardingRunRecord, error) {
	f.cancelled = append(f.cancelled, id)
	return &product.OnboardingRunRecord{ID: id}, nil
}
func (f *fakeOnboarding) Rerun(_ context.Context, _ product.Actor, id, key string) (*onboarding.StartResult, error) {
	f.input = onboarding.StartInput{IdempotencyKey: key, URL: id}
	return &onboarding.StartResult{Created: true, Run: &product.OnboardingRunRecord{ID: "run-2"}}, nil
}
func (f *fakeOnboarding) CancelWorkspace(_ context.Context, organizationID string) error {
	f.cancelled = append(f.cancelled, "workspace:"+organizationID)
	return nil
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

// Reads, cancels, and re-runs go through the onboarding service; requesting
// workspace deletion cancels the workspace's run (AC 13).
func TestOnboardingRunReadCancelRerunAndDeletion(t *testing.T) {
	agent := &fakeOnboarding{}
	handler := NewWithOnboarding(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", &fakeConfiguration{}, agent)
	if read := configurationRequest(handler, http.MethodGet, "/v1/onboarding-runs/run-1", ""); read.Code != http.StatusOK || !strings.Contains(read.Body.String(), `"progress":55`) {
		t.Fatalf("read status=%d body=%s", read.Code, read.Body)
	}
	if cancel := configurationRequest(handler, http.MethodPost, "/v1/onboarding-runs/run-1/cancel", ""); cancel.Code != http.StatusOK || agent.cancelled[0] != "run-1" {
		t.Fatalf("cancel status=%d cancelled=%v", cancel.Code, agent.cancelled)
	}
	if rerun := configurationRequest(handler, http.MethodPost, "/v1/onboarding-runs/run-1/rerun", `{"idempotencyKey":" k "}`); rerun.Code != http.StatusCreated ||
		agent.input.IdempotencyKey != "k" || agent.input.URL != "run-1" {
		t.Fatalf("rerun status=%d input=%+v", rerun.Code, agent.input)
	}
	deletion := configurationRequest(handler, http.MethodPost, "/v1/workspace/deletion", `{"confirmation":"Workspace"}`)
	if deletion.Code != http.StatusOK || agent.cancelled[len(agent.cancelled)-1] != "workspace:org-1" {
		t.Fatalf("deletion status=%d body=%s cancelled=%v", deletion.Code, deletion.Body, agent.cancelled)
	}
}
