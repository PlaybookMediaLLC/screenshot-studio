package bluesky

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func TestPublishingRejectsChangedBlueskyAccount(t *testing.T) {
	f := newFakePDS(t)
	account := f.integration(t, "app-password")
	account.InternalID = "did:plc:original-owner"
	_, err := New().Post(context.Background(), account.InternalID, "", []integrations.PostDetails{{ID: "post", Message: "Keep this with its original owner"}}, account)
	if temporalx.FailureType(err) != temporalx.TypeDisconnect {
		t.Fatalf("changed account was not rejected: %v", err)
	}
	if len(f.records) != 0 || f.uploads != 0 {
		t.Fatal("account mismatch reached a publication or upload")
	}
}

func TestConnectionRequiresMatchingProfileDIDAndActiveSession(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	for _, tc := range []struct {
		name, session, profile string
		wantProfile            bool
	}{
		{"wrong profile", `{"accessJwt":"access","refreshJwt":"refresh","did":"did:plc:one"}`, `{"did":"did:plc:two","handle":"me.bsky.social"}`, true},
		{"missing profile identity", `{"accessJwt":"access","refreshJwt":"refresh","did":"did:plc:one"}`, `{"handle":"me.bsky.social"}`, true},
		{"inactive", `{"accessJwt":"access","refreshJwt":"refresh","did":"did:plc:one","active":false}`, `{}`, false},
		{"suspended", `{"accessJwt":"access","refreshJwt":"refresh","did":"did:plc:one","status":"suspended"}`, `{}`, false},
		{"missing account", `{"accessJwt":"access","refreshJwt":"refresh"}`, `{}`, false},
		{"missing access", `{"refreshJwt":"refresh","did":"did:plc:one"}`, `{}`, false},
		{"missing refresh", `{"accessJwt":"access","did":"did:plc:one"}`, `{}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profileCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/xrpc/com.atproto.server.createSession" {
					_, _ = io.WriteString(w, tc.session)
				} else if r.URL.Path == "/xrpc/app.bsky.actor.getProfile" {
					profileCalls++
					_, _ = io.WriteString(w, tc.profile)
				} else {
					t.Error("unexpected request")
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			encoded, err := json.Marshal(credentials{Service: server.URL, Identifier: "me.bsky.social", Password: "fixture-app-password"})
			if err != nil {
				t.Fatal(err)
			}
			auth, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: base64.StdEncoding.EncodeToString(encoded)}, nil)
			if auth != nil || err == nil || (profileCalls == 1) != tc.wantProfile {
				t.Fatal("unverified account completed authentication")
			}
		})
	}
}

func TestRefreshCannotReplayWriteAsAnotherBlueskyAccount(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	writes, refreshes := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/xrpc/com.atproto.repo.createRecord":
			writes++
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":"ExpiredToken"}`)
		case "/xrpc/com.atproto.server.refreshSession":
			refreshes++
			_, _ = io.WriteString(w, `{"accessJwt":"new","refreshJwt":"new-refresh","did":"did:plc:other"}`)
		default:
			t.Error("unexpected request")
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	a, err := newAgent(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	a.session = &session{Did: "did:plc:original", AccessJwt: "old", RefreshJwt: "refresh"}
	err = a.call(context.Background(), xrpcRequest{nsid: "com.atproto.repo.createRecord", body: []byte(`{}`)}, nil)
	if !errors.Is(err, errAccountMismatch) || temporalx.FailureType(err) != temporalx.TypeDisconnect || writes != 1 || refreshes != 1 || a.session != nil {
		t.Fatal("changed refresh identity was retained or retried a write")
	}
}

func TestInactiveSessionRequiresReconnect(t *testing.T) {
	active := false
	for _, s := range []session{{Did: "did:plc:me", AccessJwt: "access", RefreshJwt: "refresh", Active: &active}, {Status: "suspended"}} {
		if err := validateSession(s); !errors.Is(err, errAccountInactive) || temporalx.FailureType(err) != temporalx.TypeDisconnect {
			t.Fatal("inactive account did not use the reconnect outcome")
		}
	}
	if err := validateSession(session{}); errors.Is(err, errAccountInactive) || temporalx.FailureType(err) == temporalx.TypeDisconnect {
		t.Fatal("incomplete provider response was mistaken for account suspension")
	}
}
