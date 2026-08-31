package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type fakeStore struct {
	connection publishing.CreateConnectionInput
	scheduled  publishing.CreateScheduledPostInput
}

func (f *fakeStore) Ping(context.Context) error { return nil }
func (f *fakeStore) CreateConnection(_ context.Context, _ publishing.Actor, input publishing.CreateConnectionInput) (*ent.ChannelConnection, error) {
	f.connection = input
	return &ent.ChannelConnection{ID: "connection-1", Platform: input.Platform, ProviderSettings: input.ProviderSettings}, nil
}
func (f *fakeStore) ListConnections(context.Context, string) ([]*ent.ChannelConnection, error) {
	return nil, nil
}
func (f *fakeStore) CreateScheduledPost(_ context.Context, _ publishing.Actor, input publishing.CreateScheduledPostInput) (publishing.CreateScheduledPostResult, error) {
	f.scheduled = input
	return publishing.CreateScheduledPostResult{Created: true, Post: &ent.ScheduledPost{ID: "post-1", Caption: input.Caption, ScheduledFor: input.ScheduledFor}}, nil
}
func (f *fakeStore) ListScheduledPosts(context.Context, string, int) ([]*ent.ScheduledPost, error) {
	return nil, nil
}
func (f *fakeStore) CancelScheduledPost(context.Context, publishing.Actor, string) (*ent.ScheduledPost, error) {
	return &ent.ScheduledPost{ID: "post-1"}, nil
}

func TestServiceAuthentication(t *testing.T) {
	handler := New(&fakeStore{}, "secret")
	request := httptest.NewRequest(http.MethodGet, "/v1/channel-connections", nil)
	request.Header.Set("X-Organization-ID", "org-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestServiceAuthenticationFailsClosedWithoutConfiguredToken(t *testing.T) {
	handler := New(&fakeStore{}, "")
	request := httptest.NewRequest(http.MethodGet, "/v1/channel-connections", nil)
	request.Header.Set("X-Organization-ID", "org-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestCreateScheduledPost(t *testing.T) {
	store := &fakeStore{}
	handler := New(store, "secret")
	body := `{"caption":"hello","channelConnectionId":"connection-1","idempotencyKey":"request-1","scheduledFor":"2026-08-31T12:00:00Z","variantId":"variant-1"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/scheduled-posts", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	if store.scheduled.Caption != "hello" || !store.scheduled.ScheduledFor.Equal(time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected scheduled input: %#v", store.scheduled)
	}
}

func TestCreateConnectionAppliesPostizDefaults(t *testing.T) {
	store := &fakeStore{}
	handler := New(store, "secret")
	request := httptest.NewRequest(http.MethodPost, "/v1/channel-connections", strings.NewReader(`{"externalAccountId":"account-1"}`))
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	if store.connection.Platform != "x" || store.connection.SecretReference != "POSTIZ_API_KEY" {
		t.Fatalf("unexpected connection defaults: %#v", store.connection)
	}
}

func TestCreateScheduledPostRejectsPastTime(t *testing.T) {
	handler := New(&fakeStore{}, "secret")
	body := `{"caption":"hello","channelConnectionId":"connection-1","idempotencyKey":"request-1","scheduledFor":"2020-01-01T00:00:00Z","variantId":"variant-1"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/scheduled-posts", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}
