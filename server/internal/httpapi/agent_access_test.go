package httpapi

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/agentclients"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// fakeAgentClients maps a client ID to its secret; "" is a public client.
type fakeAgentClients map[string]string

func (f fakeAgentClients) RegisterAgentClient(_ context.Context, request agentclients.Registration) (*agentclients.RegisteredClient, error) {
	if len(request.RedirectURIs) == 0 {
		return nil, &agentclients.RegistrationError{Code: "invalid_client_metadata", Description: "redirect_uris is required"}
	}
	zero := 0
	return &agentclients.RegisteredClient{ClientID: "pcd_new", ClientSecret: "pcs_new", ClientSecretExpiresAt: &zero, ClientIDIssuedAt: 1700000000,
		ClientName: *request.ClientName, RedirectURIs: request.RedirectURIs, TokenEndpointAuthMethod: "client_secret_post",
		GrantTypes: []string{"authorization_code"}, ResponseTypes: []string{"code"}, Scope: "mcp:read mcp:write"}, nil
}

func (f fakeAgentClients) AuthenticateAgentClient(_ context.Context, clientID, secret string) (bool, error) {
	want, ok := f[clientID]
	return ok && want == secret, nil
}

// fakeAgentCodes accepts shc_valid and records what it was given.
type fakeAgentCodes struct{ exchanged []string }

func (f *fakeAgentCodes) ExchangeAgentCode(_ context.Context, clientID, code, codeVerifier, redirectURI string) (*product.AgentToken, error) {
	if code != "shc_valid" {
		return nil, product.ErrInvalidGrant
	}
	f.exchanged = append(f.exchanged, clientID+" "+codeVerifier+" "+redirectURI)
	expires := time.Now().Add(time.Hour)
	return &product.AgentToken{AccessToken: "ss_key", Scopes: []string{"artifact:read", "release:create"}, ExpiresAt: &expires}, nil
}

func postAgentOAuth(t *testing.T, handler http.Handler, path, contentType, body string, header ...string) (int, string) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", contentType)
	for i := 0; i+1 < len(header); i += 2 {
		request.Header.Set(header[i], header[i+1])
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	data, _ := io.ReadAll(recorder.Body)
	if recorder.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("%s: no CORS header", path)
	}
	return recorder.Code, strings.TrimSpace(string(data))
}

func TestAgentTokenEndpoint(t *testing.T) {
	codes := &fakeAgentCodes{}
	handler := NewAgentOAuth(fakeAgentClients{"pcd_secret": "pcs_right", "pcd/odd": "pcs right", "pcd_public": ""}, codes)
	form := func(values ...string) string {
		form := url.Values{}
		for i := 0; i+1 < len(values); i += 2 {
			form.Set(values[i], values[i+1])
		}
		return form.Encode()
	}
	const formType = "application/x-www-form-urlencoded"
	basic := "Basic " + base64.StdEncoding.EncodeToString([]byte("pcd_secret:pcs_right"))

	// client_secret_basic, client_secret_post, and a public PKCE client.
	status, body := postAgentOAuth(t, handler, "/oauth/token", formType,
		form("grant_type", "authorization_code", "code", "shc_valid", "code_verifier", "v1", "redirect_uri", "https://claude.ai/cb"), "Authorization", basic)
	if status != 200 || !strings.HasPrefix(body, `{"access_token":"ss_key","expires_in":`) || !strings.HasSuffix(body, `"scope":"artifact:read release:create","token_type":"bearer"}`) {
		t.Fatalf("basic: %d %s", status, body)
	}
	if status, body := postAgentOAuth(t, handler, "/oauth/token", formType,
		form("grant_type", "authorization_code", "code", "shc_valid", "client_id", "pcd_secret", "client_secret", "pcs_right")); status != 200 {
		t.Fatalf("post: %d %s", status, body)
	}
	if status, body := postAgentOAuth(t, handler, "/oauth/token", "application/json",
		`{"grant_type":"authorization_code","code":"shc_valid","client_id":"pcd_public","code_verifier":"v2"}`); status != 200 {
		t.Fatalf("public: %d %s", status, body)
	}
	// URL-safe, unpadded base64 of form-encoded credentials.
	odd := "Basic " + base64.RawURLEncoding.EncodeToString([]byte("pcd%2Fodd:pcs%20right"))
	if status, body := postAgentOAuth(t, handler, "/oauth/token", formType, form("grant_type", "authorization_code", "code", "shc_valid"), "Authorization", odd); status != 200 {
		t.Fatalf("encoded basic: %d %s", status, body)
	}
	want := []string{"pcd_secret v1 https://claude.ai/cb", "pcd_secret  ", "pcd_public v2 ", "pcd/odd  "}
	if strings.Join(codes.exchanged, "|") != strings.Join(want, "|") {
		t.Fatalf("exchanged=%q", codes.exchanged)
	}

	for label, c := range map[string]struct {
		body, authorization string
		status              int
		want                string
	}{
		"wrong secret":       {form("grant_type", "authorization_code", "code", "shc_valid", "client_id", "pcd_secret", "client_secret", "pcs_wrong"), "", 401, `{"error":"invalid_client"}`},
		"wrong basic secret": {form("grant_type", "authorization_code", "code", "shc_valid"), "Basic " + base64.StdEncoding.EncodeToString([]byte("pcd_secret:pcs_wrong")), 401, `{"error":"invalid_client"}`},
		"no secret":          {form("grant_type", "authorization_code", "code", "shc_valid", "client_id", "pcd_secret"), "", 401, `{"error":"invalid_client"}`},
		"no client":          {form("grant_type", "authorization_code", "code", "shc_valid"), "", 401, `{"error":"invalid_client"}`},
		"unknown client":     {form("grant_type", "authorization_code", "code", "shc_valid", "client_id", "pcd_unknown"), "", 401, `{"error":"invalid_client"}`},
		"bad code":           {form("grant_type", "authorization_code", "code", "abc", "client_id", "pcd_public"), "", 400, `{"error":"invalid_grant"}`},
		"other grant":        {form("grant_type", "refresh_token", "code", "shc_valid", "client_id", "pcd_public"), "", 400, `{"error":"unsupported_grant_type"}`},
		"no code":            {form("grant_type", "authorization_code", "client_id", "pcd_public"), "", 400, `{"error":"invalid_request"}`},
	} {
		if status, body := postAgentOAuth(t, handler, "/oauth/token", formType, c.body, "Authorization", c.authorization); status != c.status || body != c.want {
			t.Errorf("%s: %d %s", label, status, body)
		}
	}
	if len(codes.exchanged) != len(want) {
		t.Fatalf("a refused request reached the exchange: %q", codes.exchanged)
	}
}

func TestAgentRegistrationEndpoint(t *testing.T) {
	handler := NewAgentOAuth(fakeAgentClients{}, &fakeAgentCodes{})
	// RFC 7591 clients send metadata the server ignores.
	status, body := postAgentOAuth(t, handler, "/oauth/register", "application/json",
		`{"redirect_uris":["https://claude.ai/cb"],"client_name":"Claude","scope":"mcp","software_id":"x","logo_uri":"https://claude.ai/logo.png"}`)
	if status != 201 || body != `{"client_id":"pcd_new","client_secret":"pcs_new","client_secret_expires_at":0,"client_id_issued_at":1700000000,`+
		`"client_name":"Claude","redirect_uris":["https://claude.ai/cb"],"token_endpoint_auth_method":"client_secret_post",`+
		`"grant_types":["authorization_code"],"response_types":["code"],"scope":"mcp:read mcp:write"}` {
		t.Fatalf("register: %d %s", status, body)
	}
	if status, body := postAgentOAuth(t, handler, "/oauth/register", "application/json", `{"client_name":"Claude"}`); status != 400 ||
		body != `{"error":"invalid_client_metadata","error_description":"redirect_uris is required"}` {
		t.Fatalf("refused: %d %s", status, body)
	}
	if status, _ := postAgentOAuth(t, handler, "/oauth/register", "application/json", `{"redirect_uris":"https://claude.ai/cb"`); status != 400 {
		t.Fatalf("malformed: %d", status)
	}

	request := httptest.NewRequest(http.MethodOptions, "/oauth/register", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != 204 || recorder.Header().Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" {
		t.Fatalf("preflight: %d %v", recorder.Code, recorder.Header())
	}
}
