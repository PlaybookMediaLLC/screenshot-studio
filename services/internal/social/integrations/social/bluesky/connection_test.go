package bluesky

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

const connectionDID = "did:plc:abcdefghijklmnopqrstuvwx"
const connectionOrigin = "https://pds.example.social"
const connectionServerDID = "did:web:pds.example.social"
const connectionHandle = "me.bsky.social"
const connectionPassword = "abcd-efgh-ijkl-mnop"

type connectionRoundTrip func(*http.Request) (*http.Response, error)

func (f connectionRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type connectionFixture struct {
	provider *Provider
	calls    map[string]int
	document didDocument
	session  session
	profile  profile
	override func(http.ResponseWriter, *http.Request) bool
}

func fixtureJWT(t *testing.T, did, audience, scope string, expires time.Time) string {
	t.Helper()
	payload, err := json.Marshal(tokenClaims{Subject: did, Audience: audience, Scope: scope, Expires: expires.Unix()})
	if err != nil {
		t.Fatal(err)
	}
	data := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`)) + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte("disposable-provider-fixture"))
	_, _ = mac.Write([]byte(data))
	return data + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func newConnectionFixture(t *testing.T) *connectionFixture {
	t.Helper()
	f := &connectionFixture{calls: map[string]int{}}
	if err := json.Unmarshal([]byte(`{"id":"`+connectionDID+`","alsoKnownAs":["at://`+connectionHandle+`"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"`+connectionOrigin+`"}]}`), &f.document); err != nil {
		t.Fatal(err)
	}
	active := true
	f.session = session{Did: connectionDID, Handle: connectionHandle, Active: &active,
		AccessJwt:  fixtureJWT(t, connectionDID, connectionServerDID, "com.atproto.appPass", time.Now().Add(2*time.Hour)),
		RefreshJwt: fixtureJWT(t, connectionDID, connectionServerDID, "com.atproto.refresh", time.Now().Add(90*24*time.Hour))}
	f.profile = profile{Did: connectionDID, Handle: connectionHandle, DisplayName: "Disposable account", Avatar: "https://cdn.example.social/avatar.png"}
	f.provider = newProvider(&http.Client{Transport: connectionRoundTrip(func(r *http.Request) (*http.Response, error) {
		f.calls[r.URL.Path]++
		w := httptest.NewRecorder()
		w.Header().Set("Content-Type", "application/json")
		if f.override != nil && f.override(w, r) {
			return w.Result(), nil
		}
		if r.URL.Scheme != "https" {
			t.Error("credential flow used HTTP")
		}
		switch r.URL.Path {
		case "/xrpc/com.atproto.identity.resolveHandle":
			if r.URL.Host != "public.api.bsky.app" || r.URL.Query().Get("handle") != connectionHandle || r.Header.Get("Authorization") != "" {
				t.Error("unsafe handle discovery")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"did": connectionDID})
		case "/" + connectionDID:
			if r.URL.Host != "plc.directory" || r.Header.Get("Authorization") != "" {
				t.Error("unsafe DID discovery")
			}
			_ = json.NewEncoder(w).Encode(f.document)
		case "/xrpc/com.atproto.server.describeServer":
			if r.URL.Host != "pds.example.social" || r.Header.Get("Authorization") != "" {
				t.Error("unsafe server discovery")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"did": connectionServerDID, "blobUploadLimit": 5000000})
		case "/xrpc/com.atproto.server.createSession":
			var input struct {
				Identifier string `json:"identifier"`
				Password   string `json:"password"`
			}
			if json.NewDecoder(r.Body).Decode(&input) != nil || input.Identifier != connectionDID || input.Password != connectionPassword || r.Method != http.MethodPost || r.URL.Host != "pds.example.social" || r.URL.RawQuery != "" {
				t.Error("password was not sent only to the verified PDS for the resolved DID")
			}
			s := f.session
			s.DidDoc, _ = json.Marshal(f.document)
			_ = json.NewEncoder(w).Encode(s)
		case "/xrpc/com.atproto.server.refreshSession":
			if r.URL.Host != "pds.example.social" || r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				t.Error("refresh left its saved server")
			}
			s := f.session
			s.DidDoc, _ = json.Marshal(f.document)
			_ = json.NewEncoder(w).Encode(s)
		case "/xrpc/app.bsky.actor.getProfile":
			if r.URL.Host != "pds.example.social" || r.URL.Query().Get("actor") != connectionDID || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
				t.Error("profile lookup escaped the authenticated account")
			}
			_ = json.NewEncoder(w).Encode(f.profile)
		default:
			t.Errorf("unexpected credential endpoint %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
		return w.Result(), nil
	})})
	return f
}

func credentialCode(t *testing.T, handle, password string) string {
	t.Helper()
	data, err := json.Marshal(credentials{Service: "https://ignored-attacker.example.com", Identifier: handle, Password: password})
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(data)
}

func (f *connectionFixture) connect(t *testing.T) *integrations.AuthTokenDetails {
	t.Helper()
	auth, err := f.provider.Authenticate(context.Background(), integrations.AuthenticateParams{Code: credentialCode(t, " @ME.BSKY.SOCIAL ", connectionPassword)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func TestAuthenticateAppPassword(t *testing.T) {
	f := newConnectionFixture(t)
	auth := f.connect(t)
	if auth.ID != connectionDID || auth.Username != connectionHandle || auth.ExpiresIn < 7190 || auth.ExpiresIn > 7200 || auth.NonExpiring || auth.Verification == nil || auth.Verification.Validate(identifier, connectionDID) != nil {
		t.Fatal("native identity, app grant, capabilities or actual expiry were not retained")
	}
	if auth.CredentialDetails == nil {
		t.Fatal("canonical encrypted-storage input missing")
	}
	var stored credentials
	if json.Unmarshal([]byte(*auth.CredentialDetails), &stored) != nil || stored.Version != 1 || stored.Service != connectionOrigin || stored.ServerDID != connectionServerDID || stored.Identifier != connectionDID || stored.Password != connectionPassword {
		t.Fatal("caller-supplied server or mutable handle entered stored credentials")
	}
	public, err := json.Marshal(auth)
	if err != nil || strings.Contains(string(public), connectionPassword) || strings.Contains(string(public), "credentialDetails") {
		t.Fatal("storage-only app password was serialized")
	}
	if auth.Verification.Capabilities.Bluesky.VideoCanUpload != nil || *auth.Verification.Capabilities.Bluesky.BlobUploadLimit != 5000000 {
		t.Fatal("unknown video permission or advertised blob limit was invented")
	}
	generated, err := f.provider.GenerateAuthURL(context.Background(), nil)
	if err != nil || len(generated.State) < 32 || len(generated.CodeVerifier) < 64 || generated.URL != generated.State {
		t.Fatal("credential attempt has inadequate state")
	}
}

func TestCredentialsRejectedBeforeAnyNetworkCall(t *testing.T) {
	for _, tc := range []struct{ handle, password string }{
		{"me", connectionPassword}, {"me@example.com", connectionPassword}, {"https://me.bsky.social", connectionPassword}, {"me.bsky.social", "ordinary-password"},
	} {
		f := newConnectionFixture(t)
		if _, err := f.provider.Authenticate(context.Background(), integrations.AuthenticateParams{Code: credentialCode(t, tc.handle, tc.password)}, nil); err == nil || len(f.calls) != 0 {
			t.Fatal("invalid credentials reached discovery or the PDS")
		}
	}
}

func TestConnectionRequiresMatchingProfileDIDAndActiveSession(t *testing.T) {
	for _, name := range []string{"wrong profile", "missing profile identity", "inactive", "suspended", "missing account", "missing access", "missing refresh", "primary password grant", "wrong token subject", "wrong audience", "expired token"} {
		t.Run(name, func(t *testing.T) {
			f := newConnectionFixture(t)
			wantProfile := false
			switch name {
			case "wrong profile":
				f.profile.Did = "did:plc:other"
				wantProfile = true
			case "missing profile identity":
				f.profile.Did = ""
				wantProfile = true
			case "inactive":
				active := false
				f.session.Active = &active
			case "suspended":
				f.session.Status = "suspended"
			case "missing account":
				f.session.Did = ""
			case "missing access":
				f.session.AccessJwt = ""
			case "missing refresh":
				f.session.RefreshJwt = ""
			case "primary password grant":
				f.session.AccessJwt = fixtureJWT(t, connectionDID, connectionServerDID, "com.atproto.access", time.Now().Add(time.Hour))
			case "wrong token subject":
				f.session.AccessJwt = fixtureJWT(t, "did:plc:other", connectionServerDID, "com.atproto.appPass", time.Now().Add(time.Hour))
			case "wrong audience":
				f.session.AccessJwt = fixtureJWT(t, connectionDID, "did:web:other.social", "com.atproto.appPass", time.Now().Add(time.Hour))
			case "expired token":
				f.session.AccessJwt = fixtureJWT(t, connectionDID, connectionServerDID, "com.atproto.appPass", time.Now().Add(-time.Hour))
			}
			auth, err := f.provider.Authenticate(context.Background(), integrations.AuthenticateParams{Code: credentialCode(t, connectionHandle, connectionPassword)}, nil)
			if auth != nil || err == nil || (f.calls["/xrpc/app.bsky.actor.getProfile"] == 1) != wantProfile {
				t.Fatal("unverified account or grant completed connection")
			}
		})
	}
}

func TestDIDDiscoveryRejectsUnboundOrUnsafeServersBeforePassword(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	for _, name := range []string{"other DID", "other handle", "private PDS", "HTTP PDS", "PDS credentials", "duplicate PDS"} {
		t.Run(name, func(t *testing.T) {
			f := newConnectionFixture(t)
			switch name {
			case "other DID":
				f.document.ID = "did:plc:other"
			case "other handle":
				f.document.AlsoKnownAs = []string{"at://someone.bsky.social"}
			case "private PDS":
				f.document.Service[0].Endpoint = "https://127.0.0.1"
			case "HTTP PDS":
				f.document.Service[0].Endpoint = "http://pds.example.social"
			case "PDS credentials":
				f.document.Service[0].Endpoint = "https://user:canary@pds.example.social"
			case "duplicate PDS":
				f.document.Service = append(f.document.Service, f.document.Service[0])
			}
			_, err := f.provider.Authenticate(context.Background(), integrations.AuthenticateParams{Code: credentialCode(t, connectionHandle, connectionPassword)}, nil)
			if err == nil || f.calls["/xrpc/com.atproto.server.createSession"] != 0 || strings.Contains(err.Error(), "canary") {
				t.Fatal("unverified discovery reached a password request")
			}
		})
	}
}

func TestCredentialFailuresDoNotLeakSecretsOrRetry(t *testing.T) {
	for _, status := range []int{302, 400, 429, 500} {
		f := newConnectionFixture(t)
		f.override = func(w http.ResponseWriter, r *http.Request) bool {
			if r.URL.Path != "/xrpc/com.atproto.server.createSession" {
				return false
			}
			w.Header().Set("Location", "https://other.social/"+connectionPassword)
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"error":"`+connectionPassword+`","message":"`+connectionPassword+`"}`)
			return true
		}
		_, err := f.provider.Authenticate(context.Background(), integrations.AuthenticateParams{Code: credentialCode(t, connectionHandle, connectionPassword)}, nil)
		if err == nil || strings.Contains(err.Error(), connectionPassword) || f.calls["/xrpc/com.atproto.server.createSession"] != 1 || f.calls["/xrpc/app.bsky.actor.getProfile"] != 0 {
			t.Fatal("credential failure retried or exposed a secret")
		}
	}
}

func TestCredentialRenewalKeepsStoredAccountAndActualExpiry(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
	f := newConnectionFixture(t)
	auth := f.connect(t)
	sealed, err := credentialcipher.Seal(*auth.CredentialDetails, "custom-instance")
	if err != nil {
		t.Fatal(err)
	}
	in := &ent.Integration{InternalID: connectionDID, Token: auth.AccessToken, RefreshToken: &auth.RefreshToken, CustomInstanceDetails: &sealed, VerifiedCapabilities: &auth.Verification.Capabilities}
	f.session.AccessJwt = fixtureJWT(t, connectionDID, connectionServerDID, "com.atproto.appPassPrivileged", time.Now().Add(3*time.Hour))
	refreshed, err := f.provider.RefreshIntegration(context.Background(), in)
	if err != nil || refreshed.ID != connectionDID || refreshed.ExpiresIn < 10790 || refreshed.ExpiresIn > 10800 || refreshed.Verification.GrantedScopes[0] != "com.atproto.appPassPrivileged" || f.calls["/xrpc/com.atproto.server.createSession"] != 1 {
		t.Fatalf("renewal failed or logged in again: %v", err)
	}
	f.session.Did = "did:plc:other"
	if _, err := f.provider.RefreshIntegration(context.Background(), in); !errors.Is(err, errAccountMismatch) || temporalx.FailureType(err) != temporalx.TypeDisconnect {
		t.Fatal("renewal changed the original account")
	}
}
