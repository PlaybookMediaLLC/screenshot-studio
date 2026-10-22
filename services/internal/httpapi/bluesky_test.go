package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

const blueState = "disposable_bluesky_attempt_state_0123456789"

type blueVerifier struct {
	*fakeVerifier
	begin         socialapi.BeginBlueskyInput
	exchangeError error
	facts         *socialidentity.Connection
}

func (v *blueVerifier) BeginBluesky(_ context.Context, in socialapi.BeginBlueskyInput) (string, error) {
	v.beginCalls++
	v.begin = in
	return blueState, nil
}
func (v *blueVerifier) ExchangeBluesky(_ context.Context, state, handle, password string) (socialapi.OAuthExchange, error) {
	v.exchangeCalls++
	if state != blueState || handle != "me.bsky.social" || password != "abcd-efgh-ijkl-mnop" {
		return socialapi.OAuthExchange{}, errors.New("unexpected credential input")
	}
	return socialapi.OAuthExchange{ID: "blue-destination"}, v.exchangeError
}
func (v *blueVerifier) VerifyBluesky(_ context.Context, input socialapi.VerifyDestinationInput) (*socialidentity.Connection, error) {
	v.input = input
	return v.facts, nil
}

type blueStore struct {
	*fakeStore
	finishedActor publishing.Actor
	expectedID    string
}

func (s *blueStore) PrepareOAuth(ctx context.Context, actor publishing.Actor, session, provider string, opts publishing.OAuthStartOptions) (string, error) {
	_, err := s.fakeStore.PrepareOAuth(ctx, actor, session, provider, opts)
	return s.expectedID, err
}
func (s *blueStore) FinishOAuth(ctx context.Context, actor publishing.Actor, session, state, provider, id string) (*ent.ChannelConnection, error) {
	s.finishedActor = actor
	result, err := s.fakeStore.FinishOAuth(ctx, actor, session, state, provider, id)
	set := "originalset1234567"
	result.SocialSetID = &set
	return result, err
}

func blueFacts() *socialidentity.Connection {
	now := time.Now()
	did := "did:plc:abcdefghijklmnopqrstuvwx"
	return &socialidentity.Connection{ID: "blue-destination", Provider: "bluesky", NativeID: did, Name: "Disposable", Handle: "me.bsky.social", Active: true, VerifiedAt: &now,
		Verification: &socialidentity.Verification{AccountKey: "bluesky:" + did, AccountKind: "profile", GrantedScopes: []string{"com.atproto.appPass"},
			Capabilities: socialidentity.Capabilities{Version: 1, Bluesky: &socialidentity.BlueskyCapabilities{MaxTextGraphemes: 300, MaxTextBytes: 3000, MaxImages: 4, ImageMaxBytes: 2000000, MaxVideos: 1, VideoMaxBytes: 300000000}}}}
}

func TestBlueskySubmissionAndRecoveryRetainOriginalScope(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_BLUESKY_ENABLED", "true")
	store := &blueStore{fakeStore: &fakeStore{}}
	verifier := &blueVerifier{fakeVerifier: &fakeVerifier{}, facts: blueFacts()}
	server := New(store, &fakeScheduler{}, verifier, "secret")
	call := func(path, session, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/v1/social-connections/bluesky/"+path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer secret")
		r.Header.Set("X-Organization-ID", "switched-workspace")
		r.Header.Set("X-User-ID", "user-1")
		r.Header.Set("X-Session-ID", session)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		return w
	}
	if w := call("begin", "session-1", `{"operation":"CREATE_SET","creationVisibility":"PRIVATE"}`); w.Code != 201 || !strings.Contains(w.Body.String(), blueState) {
		t.Fatalf("start: %d", w.Code)
	}
	body := `{"state":"` + blueState + `","credentials":{"handle":"@ME.BSKY.SOCIAL","appPassword":"abcd-efgh-ijkl-mnop"}}`
	if w := call("connect", "wrong-session", body); w.Code != 403 || verifier.exchangeCalls != 0 {
		t.Fatal("wrong session reached provider")
	}
	if w := call("connect", "session-1", body); w.Code != 200 || strings.Contains(w.Body.String(), "abcd-efgh") {
		t.Fatalf("connect: %d %s", w.Code, w.Body)
	}
	if verifier.exchangeCalls != 1 || store.finishedActor.Organization != "org-1" || store.oauthReceipt.Account == nil || verifier.input.ExpectedGoOrganizationID != "go-org-1" {
		t.Fatal("verified original tenant context lost")
	}
	server = New(store, &fakeScheduler{}, nil, "secret")
	if w := call("connect", "session-1", `{"state":"`+blueState+`"}`); w.Code != 200 || verifier.exchangeCalls != 1 {
		t.Fatal("completed recovery required provider or resent password")
	}
}

func TestBlueskyUnknownOutcomeDoesNotRepeatCredentials(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_BLUESKY_ENABLED", "true")
	store := &blueStore{fakeStore: &fakeStore{oauthState: blueState, oauthSession: "session", oauthProvider: "bluesky", oauthStatus: "PENDING"}}
	verifier := &blueVerifier{fakeVerifier: &fakeVerifier{}, exchangeError: errors.New("remote error including private value")}
	server := New(store, &fakeScheduler{}, verifier, "secret")
	for _, body := range []string{`{"state":"` + blueState + `","credentials":{"handle":"me.bsky.social","appPassword":"abcd-efgh-ijkl-mnop"}}`, `{"state":"` + blueState + `"}`} {
		r := httptest.NewRequest(http.MethodPost, "/v1/social-connections/bluesky/connect", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer secret")
		r.Header.Set("X-Organization-ID", "org-1")
		r.Header.Set("X-User-ID", "user-1")
		r.Header.Set("X-Session-ID", "session")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != 409 || strings.Contains(w.Body.String(), "private value") || verifier.exchangeCalls != 1 {
			t.Fatal("unknown exchange retried or leaked provider error")
		}
	}
}
