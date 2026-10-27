package bluesky

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func TestConnectionBoundsResponsesAndPinsSessionServer(t *testing.T) {
	for _, endpoint := range []string{"/xrpc/com.atproto.identity.resolveHandle", "/" + connectionDID, "/xrpc/com.atproto.server.describeServer", "/xrpc/com.atproto.server.createSession", "/xrpc/app.bsky.actor.getProfile"} {
		t.Run(endpoint, func(t *testing.T) {
			f := newConnectionFixture(t)
			f.override = func(w http.ResponseWriter, r *http.Request) bool {
				if r.URL.Path != endpoint {
					return false
				}
				_, _ = io.WriteString(w, strings.Repeat(" ", connectionResponseLimit+1))
				return true
			}
			if auth, err := f.provider.Authenticate(context.Background(), integrations.AuthenticateParams{Code: credentialCode(t, connectionHandle, connectionPassword)}, nil); err == nil || auth != nil {
				t.Fatal("oversized provider response accepted")
			}
		})
	}
	f := newConnectionFixture(t)
	f.override = func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != "/xrpc/com.atproto.server.createSession" {
			return false
		}
		doc := f.document
		doc.Service[0].Endpoint = "https://another.example.social"
		s := f.session
		s.DidDoc, _ = json.Marshal(doc)
		_ = json.NewEncoder(w).Encode(s)
		return true
	}
	if _, err := f.provider.Authenticate(context.Background(), integrations.AuthenticateParams{Code: credentialCode(t, connectionHandle, connectionPassword)}, nil); err == nil || f.calls["/xrpc/app.bsky.actor.getProfile"] != 0 {
		t.Fatal("session response changed the authorized PDS")
	}
}

func TestDIDDocumentUsesFirstValidHandle(t *testing.T) {
	f := newConnectionFixture(t)
	f.document.AlsoKnownAs = []string{"https://example.com", "at://not-a-handle", "at://" + connectionHandle, "at://other.bsky.social"}
	if got, err := f.document.accountServer(connectionDID, connectionHandle); err != nil || got != connectionOrigin {
		t.Fatal("invalid alias hid the first valid handle")
	}
	f.document.AlsoKnownAs = []string{"at://other.bsky.social", "at://" + connectionHandle}
	if _, err := f.document.accountServer(connectionDID, connectionHandle); err == nil {
		t.Fatal("later handle replaced the first valid handle")
	}
}

func TestConnectionTransportNeverLeaksNetworkErrorsOrFollowsRedirects(t *testing.T) {
	for _, scenario := range []string{"network", "redirect", "rate limit", "server error", "timeout"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			inner := &http.Client{Transport: connectionRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if scenario == "network" {
					return nil, errors.New("network error with " + connectionPassword)
				}
				status := map[string]int{"redirect": 307, "rate limit": 429, "server error": 503, "timeout": 408}[scenario]
				return &http.Response{StatusCode: status, Header: http.Header{"Location": {"https://another.social/" + connectionPassword}}, Body: io.NopCloser(strings.NewReader(`{"message":"` + connectionPassword + `"}`)), Request: r}, nil
			})}
			client := connectionHTTP(inner, connectionOrigin)
			response, err := client.Post(connectionOrigin+"/xrpc/com.atproto.server.refreshSession", "application/json", strings.NewReader("{}"))
			if response != nil {
				_ = response.Body.Close()
			}
			if calls != 1 || err != nil && strings.Contains(err.Error(), connectionPassword) || scenario != "redirect" && !errors.Is(err, integrations.ErrRefreshUnavailable) {
				t.Fatal("temporary failure lost its classification, leaked credentials, or followed a redirect")
			}
			if scenario == "redirect" && (response == nil || response.StatusCode != 307 || response.Header.Get("Location") != "") {
				t.Fatal("redirect location was exposed")
			}
		})
	}
}

func TestStoredRefreshTokenMustBelongToTheOriginalServerAndAccount(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
	f := newConnectionFixture(t)
	auth := f.connect(t)
	sealed, err := credentialcipher.Seal(*auth.CredentialDetails, "custom-instance")
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{
		fixtureJWT(t, connectionDID, connectionServerDID, "com.atproto.refresh", time.Now().Add(-time.Hour)),
		fixtureJWT(t, "did:web:other.social", connectionServerDID, "com.atproto.refresh", time.Now().Add(time.Hour)),
		fixtureJWT(t, connectionDID, "did:web:other.social", "com.atproto.refresh", time.Now().Add(time.Hour)),
		auth.AccessToken,
		"malformed",
	} {
		in := &ent.Integration{InternalID: connectionDID, Token: auth.AccessToken, RefreshToken: &token, CustomInstanceDetails: &sealed, VerifiedCapabilities: &auth.Verification.Capabilities}
		if _, err := f.provider.RefreshIntegration(context.Background(), in); err == nil || f.calls["/xrpc/com.atproto.server.refreshSession"] != 0 {
			t.Fatal("invalid stored refresh token reached the PDS")
		}
	}
	parts := strings.Split(auth.AccessToken, ".")
	for _, header := range []string{`{"alg":"none"}`, `{}`, `{"alg":123}`} {
		value := base64.RawURLEncoding.EncodeToString([]byte(header)) + "." + parts[1] + "." + parts[2]
		if _, err := providerTokenMetadata(value, connectionDID, connectionServerDID, "app-password"); err == nil {
			t.Fatal("malformed provider token accepted")
		}
	}
}
