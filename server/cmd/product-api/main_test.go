package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/agentclients"
)

// The public port serves agents the MCP server and its OAuth endpoints, and
// nothing of the internal product API.
func TestPublicPortServesOnlyMCPAndOAuth(t *testing.T) {
	t.Setenv("PLATFORM_MCP_URL", "https://mcp.shots.test/mcp")
	t.Setenv("FRONTEND_URL", "https://shots.test")
	t.Setenv("JWT_SECRET", "")
	if _, err := publicHandler(nil, nil, agentclients.New(nil)); err == nil {
		t.Fatal("the public port started without JWT_SECRET")
	}
	t.Setenv("JWT_SECRET", "test-secret")
	// No request below reaches the database or the product domain.
	handler, err := publicHandler(nil, nil, agentclients.New(nil))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/.well-known/oauth-protected-resource/mcp", "", 200},
		{"GET", "/.well-known/oauth-authorization-server/mcp-oauth-dynamic", "", 200},
		{"POST", "/mcp", "{}", 401},
		{"POST", "/mcp-oauth-claude", "{}", 401},
		{"POST", "/oauth/register", "{}", 400},
		{"POST", "/oauth/token", "grant_type=authorization_code&code=shc_x", 401},
		{"GET", "/healthz", "", 404},
		{"GET", "/readyz", "", 404},
		{"GET", "/v1/workspaces", "", 404},
		{"POST", "/v1/agent-authorizations", "{}", 404},
		{"GET", "/oauth/authorize", "", 404},
		{"GET", "/oauth/userinfo", "", 404},
		{"GET", "/", "", 404},
	} {
		request := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		if strings.HasPrefix(c.body, "grant_type") {
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != c.status {
			t.Errorf("%s %s: %d %s", c.method, c.path, recorder.Code, recorder.Body)
		}
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/.well-known/oauth-authorization-server/mcp-oauth-dynamic", nil))
	if body := recorder.Body.String(); !strings.Contains(body, `"token_endpoint":"https://mcp.shots.test/oauth/token"`) ||
		!strings.Contains(body, `"registration_endpoint":"https://mcp.shots.test/oauth/register"`) || strings.Contains(body, "userinfo") {
		t.Fatalf("metadata=%s", body)
	}
}
