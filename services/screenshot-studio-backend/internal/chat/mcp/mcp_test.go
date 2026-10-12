package mcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat"
)

type fakeOrgs struct{}

func (fakeOrgs) GetOrgByAPIKey(_ context.Context, key string) (*ent.Organization, error) {
	if key == "key" {
		return &ent.Organization{ID: "org1"}, nil
	}
	return nil, nil
}

type fakeOAuth struct{}

func (fakeOAuth) GetOrgByOAuthToken(_ context.Context, token string) (*ent.OAuthAuthorization, error) {
	if token == "pos_good" {
		a := &ent.OAuthAuthorization{}
		a.Edges.Organization = &ent.Organization{ID: "org2"}
		return a, nil
	}
	return nil, nil
}

func (fakeOAuth) GetSelfHostedByAccessToken(context.Context, string) (*chat.SelfHostedInstance, error) {
	return nil, nil
}

type fakeIntegrations struct{ chat.IntegrationService }

func (fakeIntegrations) Customers(_ context.Context, orgID string) ([]*ent.Customer, error) {
	return []*ent.Customer{{ID: "c-" + orgID, Name: "Acme"}}, nil
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Setenv("NEXT_PUBLIC_BACKEND_URL", "https://api.postiz.test")
	t.Setenv("FRONTEND_URL", "https://app.postiz.test")
	tools := chat.NewTools(chat.Services{Integrations: fakeIntegrations{}})
	agent := chat.NewAgent(tools, nil)
	s := New(agent, tools, fakeOrgs{}, fakeOAuth{}, nil)
	ts := httptest.NewServer(s.Handler(http.NotFoundHandler()))
	t.Cleanup(ts.Close)
	return ts
}

func connect(t *testing.T, endpoint string) *sdk.ClientSession {
	client := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &sdk.StreamableClientTransport{Endpoint: endpoint, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}

func TestStreamableHTTPWithAPIKey(t *testing.T) {
	ts := newTestServer(t)
	session := connect(t, ts.URL+"/mcp/key")
	if name := session.InitializeResult().ServerInfo.Name; name != "Postiz MCP" {
		t.Errorf("server name %q", name)
	}

	list, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tool := range list.Tools {
		names = append(names, tool.Name)
	}
	joined := strings.Join(names, ",")
	for _, want := range []string{"integrationList", "integrationSchedulePostTool", "uploadWidgetTool", "ask_postiz"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %s in %s", want, joined)
		}
	}
	if strings.Contains(joined, "clippingTool") {
		t.Error("clipping tools need clipping to be configured")
	}

	res, err := session.CallTool(context.Background(), &sdk.CallToolParams{Name: "groupList", Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	text := res.Content[0].(*sdk.TextContent).Text
	if res.IsError || text != `{"output":[{"id":"c-org1","name":"Acme"}]}` {
		t.Errorf("groupList: %v %s", res.IsError, text)
	}

	res, err = session.CallTool(context.Background(), &sdk.CallToolParams{Name: "postsListTool", Arguments: map[string]any{"startDate": 1}})
	if err != nil {
		t.Fatal(err)
	}
	text = res.Content[0].(*sdk.TextContent).Text
	if !res.IsError || !strings.HasPrefix(text, "Tool validation failed. Please fix the following errors and try again:\n- startDate: Expected string, received number\n- endDate: Required") {
		t.Errorf("validation: %s", text)
	}

	resources, err := session.ListResources(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(resources.Resources) != 1 || resources.Resources[0].MIMEType != "text/html;profile=mcp-app" {
		t.Fatalf("resources: %+v", resources.Resources)
	}
	read, err := session.ReadResource(context.Background(), &sdk.ReadResourceParams{URI: chat.UploadWidgetURI})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(read.Contents[0].Text, `var BACKEND = "https://api.postiz.test";`) || !strings.Contains(read.Contents[0].Text, "videos up to 1024 MB") {
		t.Error("upload widget html not rendered")
	}
}

func TestAPIKeyAndOAuthErrors(t *testing.T) {
	ts := newTestServer(t)
	get := func(method, path, auth string) (int, string, http.Header) {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(`{}`))
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(body), res.Header
	}
	if code, body, _ := get("POST", "/mcp", ""); code != 401 || body != "Missing Authorization header" {
		t.Errorf("/mcp without token: %d %s", code, body)
	}
	if code, body, _ := get("POST", "/mcp", "Bearer nope"); code != 401 || body != "Invalid API Key or OAuth token" {
		t.Errorf("/mcp bad token: %d %s", code, body)
	}
	if code, body, _ := get("POST", "/mcp/nope", ""); code != 400 || body != "Invalid API Key" {
		t.Errorf("/mcp/:id bad key: %d %s", code, body)
	}
	code, body, headers := get("POST", "/mcp-oauth-claude", "")
	if code != 401 || body != `{"error":"unauthorized","error_description":"Bearer token required"}` ||
		headers.Get("WWW-Authenticate") != `Bearer resource_metadata="https://api.postiz.test/.well-known/oauth-protected-resource/mcp-oauth-claude"` {
		t.Errorf("oauth without token: %d %s %v", code, body, headers)
	}
	code, _, headers = get("POST", "/mcp-oauth-claude", "Bearer pos_bad")
	if code != 401 || !strings.Contains(headers.Get("WWW-Authenticate"), `error="invalid_token", error_description="Invalid API Key or OAuth token"`) {
		t.Errorf("oauth bad token: %d %v", code, headers)
	}
	code, body, _ = get("GET", "/.well-known/oauth-protected-resource/mcp-oauth-claude", "")
	if code != 200 || body != `{"resource":"https://api.postiz.test/mcp-oauth-claude","authorization_servers":["https://api.postiz.test/mcp-oauth-dynamic"],"scopes_supported":["mcp:read","mcp:write"],"bearer_methods_supported":["header"]}` {
		t.Errorf("protected resource metadata: %d %s", code, body)
	}
	code, body, _ = get("GET", "/.well-known/oauth-authorization-server/mcp-oauth-chatgpt", "")
	if code != 200 || strings.Contains(body, "registration_endpoint") || !strings.Contains(body, `"authorization_endpoint":"https://app.postiz.test/oauth/authorize"`) {
		t.Errorf("chatgpt issuer metadata: %d %s", code, body)
	}
	if code, _, _ := get("GET", "/.well-known/oauth-protected-resource/mcp", ""); code != 404 {
		t.Errorf("/mcp must not be OAuth protected: %d", code)
	}
}

func TestOAuthConnectionHidesClaudeTools(t *testing.T) {
	ts := newTestServer(t)
	client := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil)
	httpClient := &http.Client{Transport: bearer{"pos_good"}}
	session, err := client.Connect(context.Background(), &sdk.StreamableClientTransport{Endpoint: ts.URL + "/mcp-oauth-claude", HTTPClient: httpClient, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	list, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range list.Tools {
		if tool.Name == "generateImageTool" || tool.Name == "ask_postiz" {
			t.Errorf("%s must be hidden on the Claude endpoint", tool.Name)
		}
	}
	res, err := session.CallTool(context.Background(), &sdk.CallToolParams{Name: "groupList", Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if text := res.Content[0].(*sdk.TextContent).Text; !strings.Contains(text, "c-org2") {
		t.Errorf("oauth organization not used: %s", text)
	}
}

type bearer struct{ token string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(r)
}

func TestSSETransport(t *testing.T) {
	ts := newTestServer(t)
	client := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &sdk.SSEClientTransport{Endpoint: ts.URL + "/sse/key"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	res, err := session.CallTool(context.Background(), &sdk.CallToolParams{Name: "groupList", Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if text := res.Content[0].(*sdk.TextContent).Text; !strings.Contains(text, "c-org1") {
		t.Errorf("sse groupList: %s", text)
	}
}

type deleted struct{ ids []string }

func (d *deleted) DeleteSelfHostedAuthorization(_ context.Context, id string) error {
	d.ids = append(d.ids, id)
	return nil
}

func TestRelayConnectAndCall(t *testing.T) {
	t.Setenv("NEXT_PUBLIC_BACKEND_URL", "https://api.postiz.test")
	tools := chat.NewTools(chat.Services{Integrations: fakeIntegrations{}})
	instance := httptest.NewTLSServer(New(chat.NewAgent(tools, nil), tools, fakeOrgs{}, fakeOAuth{}, nil).Handler(http.NotFoundHandler()))
	defer instance.Close()
	oldClient, oldSafe := instanceClient, isSafePublicHTTPSURL
	instanceClient = instance.Client
	isSafePublicHTTPSURL = func(context.Context, string) bool { return true }
	defer func() { instanceClient, isSafePublicHTTPSURL = oldClient, oldSafe }()

	gone := &deleted{}
	relay := NewRelayService(gone, tools)
	// the MCP URL from Settings > Agents carries the key; /api/mcp is tried first
	got, err := relay.Connect(context.Background(), instance.URL+"/mcp/key", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.MCPURL != instance.URL+"/mcp" || got.APIKey != "key" {
		t.Errorf("connect: %+v", got)
	}
	if _, err := relay.Connect(context.Background(), instance.URL, "wrong"); err == nil || !strings.Contains(err.Error(), "Your Postiz instance rejected this API key") {
		t.Errorf("bad key: %v", err)
	}

	relayed := relay.Tools(chat.LoadTools(tools, false))
	var groupList *chat.Tool
	for _, tool := range relayed {
		if tool.Name == "groupList" {
			groupList = tool
		}
	}
	ctx := chat.RunWithContext(context.Background(), "psh_x", nil, got)
	out, err := groupList.Call(ctx, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if data, _ := json.Marshal(out); string(data) != `{"output":[{"id":"c-org1","name":"Acme"}]}` {
		t.Errorf("relayed result: %s", data)
	}
	if _, err := groupList.Call(context.Background(), json.RawMessage(`{}`)); err == nil || err.Error() != "This connection is not linked to a self-hosted instance" {
		t.Errorf("without relay: %v", err)
	}
}
