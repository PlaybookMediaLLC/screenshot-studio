package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

type contentDraftFake struct {
	fakeConfiguration
	update product.ContentDraftUpdate
}

func (f *contentDraftFake) UpdateContentDraft(_ context.Context, _ product.Actor, _ string, input product.ContentDraftUpdate) (*product.ContentDraftRecord, error) {
	f.update = input
	return nil, &product.ContentDraftVersionConflictError{Current: 5}
}

// A stale draft write answers 409 with the version the client must load.
func TestStaleContentDraftWriteReturnsCurrentVersion(t *testing.T) {
	config := &contentDraftFake{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", config)
	response := configurationRequest(handler, http.MethodPatch, "/v1/content-drafts/c123456789012345678901234",
		`{"baseVersion":3,"title":"New"}`)
	var body struct {
		Code           string `json:"code"`
		CurrentVersion int    `json:"currentVersion"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusConflict || body.Code != "content_draft_version_conflict" || body.CurrentVersion != 5 ||
		config.update.BaseVersion != 3 || config.update.Title == nil || *config.update.Title != "New" {
		t.Fatalf("status=%d body=%+v update=%+v", response.Code, body, config.update)
	}
	if invalid := configurationRequest(handler, http.MethodGet, "/v1/content-drafts/not-an-id!", ""); invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid draft ID status=%d", invalid.Code)
	}
	if unknown := configurationRequest(handler, http.MethodPatch, "/v1/content-drafts/c123456789012345678901234",
		`{"baseVersion":3,"organizationId":"other"}`); unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d", unknown.Code)
	}
}

type draftScheduleFake struct {
	fakeConfiguration
	input product.ScheduleContentDraftInput
}

func (f *draftScheduleFake) ScheduleContentDraft(_ context.Context, _ product.Actor, _ string, input product.ScheduleContentDraftInput) (*product.ScheduleContentDraftResult, error) {
	f.input = input
	return &product.ScheduleContentDraftResult{
		Cancelled: []string{"old-post"}, Created: true,
		Scheduled: []*ent.ScheduledPost{{ID: "new-post", OrganizationID: "org-1", ScheduledFor: input.ScheduledFor}},
	}, nil
}

// Scheduling stops the replaced workflow and starts one per new post.
func TestScheduleContentDraftStartsWorkflows(t *testing.T) {
	config, scheduler := &draftScheduleFake{}, &fakeScheduler{}
	handler := NewWithConfiguration(&fakeStore{}, scheduler, &fakeVerifier{}, "secret", config)
	at := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	response := configurationRequest(handler, http.MethodPost, "/v1/content-drafts/c123456789012345678901234/schedule",
		fmt.Sprintf(`{"scheduledFor":%q,"targets":[{"caption":"Hi","channelConnectionId":"c123456789012345678901235"}],"version":2}`, at.Format(time.RFC3339)))
	if response.Code != http.StatusCreated || config.input.Version != 2 || len(config.input.Targets) != 1 {
		t.Fatalf("status=%d body=%s input=%+v", response.Code, response.Body.String(), config.input)
	}
	if scheduler.cancelled != "old-post" || scheduler.started.PostID != "new-post" || !scheduler.started.ScheduledFor.Equal(at) {
		t.Fatalf("cancelled=%q started=%+v", scheduler.cancelled, scheduler.started)
	}
}

// A direct scheduled post names exactly one source.
func TestCreateScheduledPostRequiresExactlyOneSource(t *testing.T) {
	handler := New(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret")
	at := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	for _, source := range []string{``, `,"variantId":"v1","contentDraftId":"d1"`} {
		body := fmt.Sprintf(`{"caption":"hi","channelConnectionId":"c1","idempotencyKey":"k1","scheduledFor":%q%s}`, at, source)
		request := httptest.NewRequest(http.MethodPost, "/v1/scheduled-posts", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer secret")
		request.Header.Set("X-Organization-ID", "org-1")
		request.Header.Set("X-User-ID", "user-1")
		request.Header.Set("X-Session-ID", "session-1")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("source %q status=%d", source, response.Code)
		}
	}
}
