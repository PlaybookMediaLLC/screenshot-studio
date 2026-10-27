package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func xFacts() *socialidentity.Connection {
	now := time.Now()
	caps := socialidentity.XStandardPostLimits("read-write", nil)
	return &socialidentity.Connection{ID: "destination-1", Provider: "x", NativeID: "123456789", Active: true, VerifiedAt: &now,
		Verification: &socialidentity.Verification{AccountKey: "x:123456789", AccountKind: "profile", GrantedScopes: []string{"read-write"}, Capabilities: socialidentity.Capabilities{Version: 1, X: &caps}}}
}

func (f *fakeVerifier) VerifyX(_ context.Context, input socialapi.VerifyDestinationInput) (*socialidentity.Connection, error) {
	f.input = input
	return xFacts(), nil
}

type invalidXVerifier struct {
	*fakeVerifier
	facts *socialidentity.Connection
	err   error
}

func (v *invalidXVerifier) VerifyX(_ context.Context, input socialapi.VerifyDestinationInput) (*socialidentity.Connection, error) {
	v.input = input
	return v.facts, v.err
}

func TestXExchangeRequiresTenantBoundProofBeforeSavingReceipt(t *testing.T) {
	for _, invalid := range []string{"", "missing", "wrong-native-id", "read-only", "inactive", "provider-error"} {
		t.Run(invalid, func(t *testing.T) {
			store := &fakeStore{oauthState: "test-state", oauthSession: "session-1", oauthProvider: "x", oauthStatus: "PENDING"}
			verifier := &invalidXVerifier{fakeVerifier: &fakeVerifier{}, facts: xFacts()}
			switch invalid {
			case "missing":
				verifier.facts = nil
			case "wrong-native-id":
				verifier.facts.NativeID = "987654321"
			case "read-only":
				verifier.facts.Verification.Capabilities.X.OAuth1AccessLevel = "read"
			case "inactive":
				verifier.facts.Active = false
			case "provider-error":
				verifier.err = errors.New("private-provider-error")
			}
			server := New(store, &fakeScheduler{}, verifier, "secret")
			call := func() *httptest.ResponseRecorder {
				r := httptest.NewRequest(http.MethodPost, "/v1/social-oauth/exchange", strings.NewReader(`{"provider":"x","state":"test-state","code":"test-code"}`))
				r.Header.Set("Authorization", "Bearer secret")
				r.Header.Set("X-Organization-ID", "switched-workspace")
				r.Header.Set("X-User-ID", "user-1")
				r.Header.Set("X-Session-ID", "session-1")
				w := httptest.NewRecorder()
				server.ServeHTTP(w, r)
				return w
			}
			w := call()
			if invalid == "" {
				if w.Code != 200 || store.oauthReceipt == nil || store.oauthReceipt.Account == nil || verifier.input.ExpectedGoOrganizationID != "go-org-1" || verifier.input.SecretReference != "SOCIAL_API_KEY" {
					t.Fatalf("verified receipt missing: %d %s", w.Code, w.Body)
				}
				if replay := call(); replay.Code != 200 || verifier.exchangeCalls != 1 {
					t.Fatal("exchange repeated")
				}
			} else {
				if w.Code != 409 || store.oauthReceipt != nil || strings.Contains(w.Body.String(), "private-provider-error") {
					t.Fatalf("invalid proof accepted: %d %s", w.Code, w.Body)
				}
				if replay := call(); replay.Code != 409 || verifier.exchangeCalls != 1 {
					t.Fatal("uncertain exchange repeated")
				}
			}
		})
	}
}
