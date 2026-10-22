package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCustomMastodonStartBindsNormalizedInstance(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_CUSTOM_MASTODON_ENABLED", "true")
	for _, tc := range []struct {
		name, body, authorization string
		status, calls             int
	}{
		{"valid", `{"provider":"mastodon-custom","instanceServer":"EXAMPLE.social/","operation":"CREATE_SET","creationVisibility":"PRIVATE"}`, "https://example.social/oauth/authorize?state=bound-instance", 201, 1},
		{"missing instance", `{"provider":"mastodon-custom","operation":"CREATE_SET","creationVisibility":"PRIVATE"}`, "", 400, 0},
		{"private instance", `{"provider":"mastodon-custom","instanceServer":"https://127.0.0.1","operation":"CREATE_SET","creationVisibility":"PRIVATE"}`, "", 400, 0},
		{"instance with other provider", `{"provider":"x","instanceServer":"example.social","operation":"CREATE_SET","creationVisibility":"PRIVATE"}`, "", 400, 0},
		{"redirected origin", `{"provider":"mastodon-custom","instanceServer":"example.social","operation":"CREATE_SET","creationVisibility":"PRIVATE"}`, "https://other.social/oauth/authorize?state=bound-instance", 502, 1},
		{"redirected path", `{"provider":"mastodon-custom","instanceServer":"example.social","operation":"CREATE_SET","creationVisibility":"PRIVATE"}`, "https://example.social/elsewhere?state=bound-instance", 502, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store, verifier := &fakeStore{}, &fakeVerifier{beginURL: tc.authorization}
			request := httptest.NewRequest(http.MethodPost, "/v1/social-oauth/begin", strings.NewReader(tc.body))
			request.Header.Set("Authorization", "Bearer secret")
			request.Header.Set("X-Organization-ID", "original-workspace")
			request.Header.Set("X-User-ID", "original-user")
			request.Header.Set("X-Session-ID", "original-session")
			response := httptest.NewRecorder()
			New(store, &fakeScheduler{}, verifier, "secret").ServeHTTP(response, request)
			if response.Code != tc.status || verifier.beginCalls != tc.calls {
				t.Fatalf("status %d calls %d: %s", response.Code, verifier.beginCalls, response.Body)
			}
			if tc.status == 201 {
				if verifier.beginInput.InstanceOrigin != "https://example.social" || store.oauthState != "bound-instance" || store.oauthProvider != "mastodon-custom" || store.oauthSession != "original-session" || store.oauthOptions.CreationVisibility != "PRIVATE" {
					t.Fatal("authorization lost its instance or original context")
				}
			} else if store.oauthState != "" {
				t.Fatal("invalid authorization URL persisted an attempt")
			}
		})
	}
}

func TestCustomMastodonStartRequiresRollout(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_CUSTOM_MASTODON_ENABLED", "false")
	store, verifier := &fakeStore{}, &fakeVerifier{}
	r := httptest.NewRequest(http.MethodPost, "/v1/social-oauth/begin", strings.NewReader(`{"provider":"mastodon-custom","instanceServer":"example.social"}`))
	r.Header.Set("Authorization", "Bearer secret")
	r.Header.Set("X-Organization-ID", "workspace")
	r.Header.Set("X-User-ID", "user")
	r.Header.Set("X-Session-ID", "session")
	w := httptest.NewRecorder()
	New(store, &fakeScheduler{}, verifier, "secret").ServeHTTP(w, r)
	if w.Code != 503 || verifier.beginCalls != 0 {
		t.Fatal("disabled adapter reached the provider")
	}
}
