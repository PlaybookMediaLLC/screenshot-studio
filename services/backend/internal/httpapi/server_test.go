package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
)

type fakeStore struct {
	connection    publishing.CreateConnectionInput
	scheduled     publishing.CreateScheduledPostInput
	oauthState    string
	oauthSession  string
	oauthProvider string
	authError     error
}

type fakeVerifier struct {
	input postiz.VerifyDestinationInput
}

func (f *fakeVerifier) VerifyDestination(_ context.Context, input postiz.VerifyDestinationInput) error {
	f.input = input
	return nil
}
func (f *fakeVerifier) BeginOAuth(context.Context, postiz.BeginOAuthInput) (string, error) {
	return "https://api.x.com/oauth/authorize?oauth_token=test-state", nil
}

type fakeScheduler struct {
	cancelled string
	started   temporalpublishing.ScheduleInput
}

func (f *fakeScheduler) Ping(context.Context) error { return nil }
func (f *fakeScheduler) Start(_ context.Context, input temporalpublishing.ScheduleInput) error {
	f.started = input
	return nil
}
func (f *fakeScheduler) Cancel(_ context.Context, postID string) error {
	f.cancelled = postID
	return nil
}

func (f *fakeStore) Ping(context.Context) error { return nil }
func (f *fakeStore) AuthorizePublishing(context.Context, string, string, string) error {
	return f.authError
}
func (f *fakeStore) Binding(context.Context, string) (*ent.PostizTenantBinding, error) {
	return &ent.PostizTenantBinding{GoOrganizationID: "go-org-1", SecretReference: "POSTIZ_API_KEY"}, nil
}
func (f *fakeStore) StartOAuth(_ context.Context, _ publishing.Actor, session, state, provider, _ string) error {
	f.oauthState = state
	f.oauthSession = session
	f.oauthProvider = provider
	return nil
}
func (f *fakeStore) OAuthStart(_ context.Context, _ publishing.Actor, session, state, provider string, _ *string) (*ent.SocialOAuthStart, error) {
	if state != f.oauthState || session != f.oauthSession || provider != f.oauthProvider {
		return nil, publishing.ErrNotFound
	}
	return &ent.SocialOAuthStart{SecretReference: "POSTIZ_API_KEY"}, nil
}
func (f *fakeStore) RememberInstagramIntegration(context.Context, publishing.Actor, string, string, string) error {
	return nil
}
func (f *fakeStore) FinishOAuth(context.Context, publishing.Actor, string, string, string, string) (*ent.ChannelConnection, error) {
	return &ent.ChannelConnection{ID: "connection-1", ProviderSettings: map[string]any{}}, nil
}

func TestSocialOAuthBoundToSessionAndCompletesThroughEnt(t *testing.T) {
	store := &fakeStore{}
	verifier := &fakeVerifier{}
	handler := New(store, &fakeScheduler{}, verifier, "secret")
	call := func(path, session, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer secret")
		request.Header.Set("X-Organization-ID", "org-1")
		request.Header.Set("X-User-ID", "user-1")
		request.Header.Set("X-Session-ID", session)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	begin := call("/v1/social-oauth/begin", "session-1", `{"provider":"x"}`)
	if begin.Code != http.StatusCreated || store.oauthState != "test-state" {
		t.Fatalf("begin status=%d body=%s state=%s", begin.Code, begin.Body, store.oauthState)
	}
	wrongSession := call("/v1/social-oauth/verify", "session-2", `{"provider":"x","state":"test-state"}`)
	if wrongSession.Code != http.StatusForbidden {
		t.Fatalf("another session verified OAuth: %d", wrongSession.Code)
	}
	verified := call("/v1/social-oauth/verify", "session-1", `{"provider":"x","state":"test-state"}`)
	if verified.Code != http.StatusOK {
		t.Fatalf("verify status=%d body=%s", verified.Code, verified.Body)
	}
	completed := call("/v1/social-oauth/complete", "session-1", `{"provider":"x","state":"test-state","integrationId":"destination-1"}`)
	if completed.Code != http.StatusOK || verifier.input.DestinationID != "destination-1" {
		t.Fatalf("complete status=%d body=%s destination=%s", completed.Code, completed.Body, verifier.input.DestinationID)
	}
}

func TestAuthorizationURLRejectsWrongHost(t *testing.T) {
	if _, _, err := validatedAuthorizationURL("https://evil.example/oauth?oauth_token=test", "x"); err == nil {
		t.Fatal("accepted authorization URL from another host")
	}
}
func (f *fakeStore) CreateConnection(_ context.Context, _ publishing.Actor, input publishing.CreateConnectionInput) (*ent.ChannelConnection, error) {
	f.connection = input
	return &ent.ChannelConnection{ID: "connection-1", Platform: input.Platform, ProviderSettings: input.ProviderSettings}, nil
}
func (f *fakeStore) ListConnections(context.Context, string) ([]*ent.ChannelConnection, error) {
	return nil, nil
}
func (f *fakeStore) CreateScheduledPost(_ context.Context, actor publishing.Actor, input publishing.CreateScheduledPostInput) (publishing.CreateScheduledPostResult, error) {
	f.scheduled = input
	return publishing.CreateScheduledPostResult{Created: true, Post: &ent.ScheduledPost{ID: "post-1", OrganizationID: actor.Organization, Caption: input.Caption, ScheduledFor: input.ScheduledFor, Status: "SCHEDULED"}}, nil
}
func (f *fakeStore) ListScheduledPosts(context.Context, string, int) ([]*ent.ScheduledPost, error) {
	return nil, nil
}
func (f *fakeStore) CancelScheduledPost(context.Context, publishing.Actor, string) (*ent.ScheduledPost, error) {
	return &ent.ScheduledPost{ID: "post-1"}, nil
}

func TestServiceAuthentication(t *testing.T) {
	handler := New(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret")
	request := httptest.NewRequest(http.MethodGet, "/v1/channel-connections", nil)
	request.Header.Set("X-Organization-ID", "org-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestServiceAuthenticationFailsClosedWithoutConfiguredToken(t *testing.T) {
	handler := New(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "")
	request := httptest.NewRequest(http.MethodGet, "/v1/channel-connections", nil)
	request.Header.Set("X-Organization-ID", "org-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestPublishingRequestRequiresAnAuthorizedSession(t *testing.T) {
	store := &fakeStore{authError: publishing.ErrForbidden}
	handler := New(store, &fakeScheduler{}, &fakeVerifier{}, "secret")
	request := httptest.NewRequest(http.MethodGet, "/v1/scheduled-posts", nil)
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("request without session status=%d", response.Code)
	}
	request.Header.Set("X-Session-ID", "session-1")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("request without publishing permission status=%d", response.Code)
	}
}

func TestCreateScheduledPost(t *testing.T) {
	store := &fakeStore{}
	scheduler := &fakeScheduler{}
	handler := New(store, scheduler, &fakeVerifier{}, "secret")
	scheduledFor := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	body := fmt.Sprintf(`{"caption":"hello","channelConnectionId":"connection-1","idempotencyKey":"request-1","scheduledFor":%q,"variantId":"variant-1"}`, scheduledFor.Format(time.RFC3339))
	request := httptest.NewRequest(http.MethodPost, "/v1/scheduled-posts", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	request.Header.Set("X-Session-ID", "session-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	if store.scheduled.Caption != "hello" || !store.scheduled.ScheduledFor.Equal(scheduledFor) {
		t.Fatalf("unexpected scheduled input: %#v", store.scheduled)
	}
	if scheduler.started.PostID != "post-1" || scheduler.started.OrganizationID != "org-1" {
		t.Fatalf("workflow was not started for the scheduled post: %#v", scheduler.started)
	}
}

func TestCreateConnectionAppliesPostizDefaults(t *testing.T) {
	store := &fakeStore{}
	verifier := &fakeVerifier{}
	handler := New(store, &fakeScheduler{}, verifier, "secret")
	request := httptest.NewRequest(http.MethodPost, "/v1/channel-connections", strings.NewReader(`{"externalAccountId":"account-1"}`))
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	request.Header.Set("X-Session-ID", "session-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	if store.connection.Platform != "x" || store.connection.SecretReference != "POSTIZ_API_KEY" {
		t.Fatalf("unexpected connection defaults: %#v", store.connection)
	}
	if verifier.input.DestinationID != "account-1" || verifier.input.ExpectedGoOrganizationID != "go-org-1" {
		t.Fatalf("destination was not verified against the tenant binding: %#v", verifier.input)
	}
}

func TestCreateScheduledPostRejectsPastTime(t *testing.T) {
	handler := New(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret")
	body := `{"caption":"hello","channelConnectionId":"connection-1","idempotencyKey":"request-1","scheduledFor":"2020-01-01T00:00:00Z","variantId":"variant-1"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/scheduled-posts", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-User-ID", "user-1")
	request.Header.Set("X-Session-ID", "session-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}
