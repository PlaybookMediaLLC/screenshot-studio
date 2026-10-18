// Package mcp is the MCP server (Streamable HTTP and
// SSE) with API key and OAuth (RFC 9728) auth, the MCP Apps widgets, and the
// relay to self-hosted instances.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/upload"
)

// OrganizationService is the part of organizations.Service the server uses.
type OrganizationService interface {
	// GetOrgByAPIKey returns nil when no organization has this key.
	GetOrgByAPIKey(ctx context.Context, apiKey string) (*ent.Organization, error)
}

// OAuthService is the part of oauth.Service the server uses.
type OAuthService interface {
	// GetOrgByOAuthToken returns the authorization (Edges.Organization
	// loaded) of an access token, nil when unknown or revoked.
	GetOrgByOAuthToken(ctx context.Context, token string) (*ent.OAuthAuthorization, error)
	// GetSelfHostedByAccessToken returns nil when the relay is disabled or
	// the psh_ token is unknown.
	GetSelfHostedByAccessToken(ctx context.Context, token string) (*chat.SelfHostedInstance, error)
}

// Paths are the request paths the MCP handler serves (prefixes end in "/").
var Paths = []string{
	"/.well-known/openai-apps-challenge",
	"/.well-known/oauth-protected-resource/",
	"/.well-known/oauth-authorization-server/",
	"/.well-known/openid-configuration/",
	"/mcp-oauth-chatgpt",
	"/mcp-oauth",
	"/mcp-oauth-claude",
	"/mcp-oauth-dynamic",
	"/mcp",
	"/mcp/",
	"/sse/",
	"/message/",
}

// The Claude connector directory does not accept AI media generation tools,
// so the directory-facing endpoint hides them. Direct connections (/mcp,
// /mcp/:id, /sse/:id) and the ChatGPT app keep the full toolset.
var claudeHiddenTools = []string{
	"generateImageTool",
	"generateVideoTool",
	"videoStatusTool",
	"generateVideoOptions",
	"videoFunctionTool",
	// clipping renders new videos (AI picked cuts, burned-in captions)
	"clippingTool",
	"clippingStatusTool",
	"clippingWidgetTicketTool",
}

func withoutClaudeHidden(tools []*chat.Tool) []*chat.Tool {
	var out []*chat.Tool
	for _, t := range tools {
		if !slices.Contains(claudeHiddenTools, t.Name) {
			out = append(out, t)
		}
	}
	return out
}

const resourceMIMEType = "text/html;profile=mcp-app"

type appResource struct {
	uri, name, description, html string
	meta                         map[string]any
}

// serverDef is one MCPServer configuration.
type serverDef struct {
	tools     []*chat.Tool
	agent     *chat.Agent // registers ask_postiz
	resources []appResource
}

type authorizationServer struct {
	issuer       string
	registration bool
}

type oauthResource struct {
	middleware OAuthMiddleware
	server     *serverDef
	selfHosted *serverDef
}

// Server is startMcp's state.
type Server struct {
	orgs  OrganizationService
	oauth OAuthService

	server, oauthServer, claudeOAuthServer *serverDef

	backendURL           string
	enableOIDC           bool
	scopes               []string
	authorizationServers map[string]authorizationServer
	oauthResources       map[string]*oauthResource

	sseMu       sync.Mutex
	sseSessions map[string]*sdk.SSEServerTransport
}

func envBackend() string { return os.Getenv("NEXT_PUBLIC_BACKEND_URL") }

func resolveURL(path, base string) string {
	b, err := url.Parse(base)
	if err != nil {
		return path
	}
	ref, err := b.Parse(path)
	if err != nil {
		return path
	}
	return ref.String()
}

func origin(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "null"
	}
	return u.Scheme + "://" + u.Host
}

// New builds the MCP servers. tools is the whole toolList, agent the postiz
// agent; relay is nil when MCP_SELF_HOSTED_RELAY is off.
func New(agent *chat.Agent, tools []*chat.Tool, orgs OrganizationService, oauth OAuthService, relay *RelayService) *Server {
	openAIClientID := strings.TrimSpace(os.Getenv("OPENAI_OAUTH_CLIENT_ID"))
	s := &Server{orgs: orgs, oauth: oauth, enableOIDC: openAIClientID != "", sseSessions: map[string]*sdk.SSEServerTransport{}}
	if s.enableOIDC {
		s.scopes = append(s.scopes, "openid", "email")
	}
	s.scopes = append(s.scopes, "mcp:read", "mcp:write")

	agentTools := agent.ListTools()
	// tools that only make sense inside an MCP host (ui:// widgets)
	allTools := append(slices.Clone(agentTools), chat.LoadTools(tools, true)...)

	s.backendURL = os.Getenv("NEXT_PUBLIC_OVERRIDE_BACKEND_URL")
	if s.backendURL == "" {
		s.backendURL = envBackend()
	}
	// a bucket url that doesn't parse only costs the widget its thumbnails
	storageOrigin := ""
	if storage, err := upload.CreateStorage(); err == nil {
		if cloud, ok := storage.(upload.CloudProvider); ok {
			if o := origin(cloud.PublicURL("")); o != "null" {
				storageOrigin = o
			}
		}
	}

	// MCP Apps widgets (ui:// resources). They run in the host's sandboxed
	// iframe, which can only reach the domains listed in the csp
	resources := []appResource{{
		uri:         chat.UploadWidgetURI,
		name:        "Upload Media",
		description: "Upload an image or video from the device to the media library",
		html:        UploadWidgetHTML(s.backendURL),
		meta: map[string]any{
			"csp": map[string]any{"connectDomains": []string{origin(s.backendURL)}},
			// the "Copy link" button of the uploaded media
			"permissions":   map[string]any{"clipboardWrite": map[string]any{}},
			"prefersBorder": true,
		},
	}}
	if upload.ClippingEnabled() {
		csp := map[string]any{"connectDomains": []string{origin(s.backendURL)}}
		// the thumbnails of the clips live wherever the storage serves files
		if storageOrigin != "" {
			csp["resourceDomains"] = []string{storageOrigin}
		}
		resources = append(resources, appResource{
			uri:         chat.ClippingWidgetURI,
			name:        "Video Clipping",
			description: "Progress of a video clipping and the clips it made",
			html:        ClippingWidgetHTML(s.backendURL),
			meta: map[string]any{
				"csp": csp,
				// the "Copy link" button of a clip
				"permissions":   map[string]any{"clipboardWrite": map[string]any{}},
				"prefersBorder": true,
			},
		})
	}
	// a widget of a hidden tool is hidden with it
	var claudeResources []appResource
	for _, r := range resources {
		if r.uri != chat.ClippingWidgetURI {
			claudeResources = append(claudeResources, r)
		}
	}

	s.server = &serverDef{tools: allTools, agent: agent, resources: resources}
	// The directory-facing servers don't register the agent - it would be
	// exposed as an annotation-less catch-all ask_postiz tool, which the
	// ChatGPT and Claude directory reviews reject
	s.oauthServer = &serverDef{tools: allTools, resources: resources}
	s.claudeOAuthServer = &serverDef{tools: withoutClaudeHidden(allTools), resources: claudeResources}

	// Self-hosted connections, built from the agent tools so the ui://
	// widgets (which upload to this server) are left out
	var selfHosted, claudeSelfHosted *serverDef
	if os.Getenv("MCP_SELF_HOSTED_RELAY") == "true" && relay != nil {
		relayed := relay.Tools(agentTools)
		selfHosted = &serverDef{tools: relayed}
		claudeSelfHosted = &serverDef{tools: withoutClaudeHidden(relayed)}
	}

	// Two RFC 8414 path-based issuers backed by the same endpoints and code.
	// /mcp-oauth-chatgpt is what the ChatGPT app submission points at: it
	// does not advertise a registration_endpoint, so the OpenAI builder
	// defaults to the pre-defined client credentials instead of DCR.
	// /mcp-oauth-dynamic keeps DCR for Claude, Cursor and every other
	// self-registering client
	s.authorizationServers = map[string]authorizationServer{
		"/mcp-oauth-chatgpt": {issuer: resolveURL("/mcp-oauth-chatgpt", envBackend()), registration: false},
		"/mcp-oauth-dynamic": {issuer: resolveURL("/mcp-oauth-dynamic", envBackend()), registration: true},
	}

	// Every OAuth-protected MCP path is its own RFC 9728 protected resource
	resource := func(mcpPath, authorizationServer string) OAuthMiddleware {
		return CreateOAuthMiddleware(OAuthConfig{
			Resource:             resolveURL(mcpPath, envBackend()),
			AuthorizationServers: []string{s.authorizationServers[authorizationServer].issuer},
			ScopesSupported:      s.scopes,
			ValidateToken: func(ctx context.Context, token, _ string) TokenValidationResult {
				var found bool
				if strings.HasPrefix(token, "psh_") {
					instance, _ := s.oauth.GetSelfHostedByAccessToken(ctx, token)
					found = instance != nil
				} else {
					org, _ := s.resolveAuth(ctx, token)
					found = org != nil
				}
				if !found {
					return TokenValidationResult{Error: "invalid_token", ErrorDescription: "Invalid API Key or OAuth token"}
				}
				return TokenValidationResult{Valid: true, Subject: token}
			},
		}, mcpPath)
	}
	s.oauthResources = map[string]*oauthResource{
		// ChatGPT app submission (pre-defined client credentials, no DCR)
		"/mcp-oauth-chatgpt": {resource("/mcp-oauth-chatgpt", "/mcp-oauth-chatgpt"), s.oauthServer, selfHosted},
		// Former ChatGPT path, kept for connectors that were created against it
		"/mcp-oauth": {resource("/mcp-oauth", "/mcp-oauth-dynamic"), s.oauthServer, selfHosted},
		// Claude connector directory submission
		"/mcp-oauth-claude": {resource("/mcp-oauth-claude", "/mcp-oauth-dynamic"), s.claudeOAuthServer, claudeSelfHosted},
		// Clients that register themselves through DCR (/oauth/register) -
		// not directory-reviewed, so they get the full toolset
		"/mcp-oauth-dynamic": {resource("/mcp-oauth-dynamic", "/mcp-oauth-dynamic"), s.oauthServer, selfHosted},
	}
	return s
}

func (s *Server) resolveAuth(ctx context.Context, token string) (*ent.Organization, error) {
	if strings.HasPrefix(token, "pos_") {
		authorization, err := s.oauth.GetOrgByOAuthToken(ctx, token)
		if err != nil || authorization == nil {
			return nil, err
		}
		return authorization.Edges.Organization, nil
	}
	return s.orgs.GetOrgByAPIKey(ctx, token)
}

type metadata struct {
	Issuer                            string   `json:"issuer"`
	AuthorizationEndpoint             string   `json:"authorization_endpoint"`
	TokenEndpoint                     string   `json:"token_endpoint"`
	RegistrationEndpoint              string   `json:"registration_endpoint,omitempty"`
	UserinfoEndpoint                  string   `json:"userinfo_endpoint,omitempty"`
	ResponseTypesSupported            []string `json:"response_types_supported"`
	GrantTypesSupported               []string `json:"grant_types_supported"`
	TokenEndpointAuthMethodsSupported []string `json:"token_endpoint_auth_methods_supported"`
	CodeChallengeMethodsSupported     []string `json:"code_challenge_methods_supported"`
	ScopesSupported                   []string `json:"scopes_supported"`
	SubjectTypesSupported             []string `json:"subject_types_supported,omitempty"`
	ClaimsSupported                   []string `json:"claims_supported,omitempty"`
}

// authorizationServerMetadata: RFC 8414 metadata served at
// /.well-known/oauth-authorization-server/<path> belongs to the path-based
// issuer <backend>/<path>.
func (s *Server) authorizationServerMetadata(server authorizationServer) metadata {
	m := metadata{
		Issuer:                            server.issuer,
		AuthorizationEndpoint:             os.Getenv("FRONTEND_URL") + "/oauth/authorize",
		TokenEndpoint:                     s.backendURL + "/oauth/token",
		ResponseTypesSupported:            []string{"code"},
		GrantTypesSupported:               []string{"authorization_code"},
		TokenEndpointAuthMethodsSupported: []string{"client_secret_basic", "client_secret_post", "none"},
		CodeChallengeMethodsSupported:     []string{"S256"},
		ScopesSupported:                   s.scopes,
	}
	if server.registration {
		m.RegistrationEndpoint = s.backendURL + "/oauth/register"
	}
	if s.enableOIDC {
		m.UserinfoEndpoint = s.backendURL + "/oauth/userinfo"
	}
	return m
}

func corsAll(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "*")
	h.Set("Access-Control-Allow-Headers", "*")
	h.Set("Access-Control-Expose-Headers", "*")
}

// sendText is Express res.status(n).send(string).
func sendText(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func sendStatusOK(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("OK"))
}

// fixAcceptHeader: clients that only accept JSON still get served.
func fixAcceptHeader(r *http.Request) {
	r.Header.Set("Accept", "application/json, text/event-stream")
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request, def *serverDef, requestID string, auth *ent.Organization, relay *chat.SelfHostedInstance) {
	fixAcceptHeader(r)
	server := s.build(def, requestID, auth, relay)
	sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return server }, &sdk.StreamableHTTPOptions{
		Stateless:                  true,
		JSONResponse:               true,
		DisableLocalhostProtection: true,
	}).ServeHTTP(w, r)
}

// Handler serves the MCP routes (app.use in startMcp) and hands every other
// request to next.
func (s *Server) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case path == "/.well-known/openai-apps-challenge" || strings.HasPrefix(path, "/.well-known/openai-apps-challenge/"):
			if challenge := os.Getenv("OPENAI_APP_CHALLANGE"); challenge != "" {
				w.Header().Set("Content-Type", "text/plain")
				_, _ = w.Write([]byte(challenge))
				return
			}

		case strings.HasPrefix(path, "/.well-known/oauth-protected-resource/"):
			// Only the paths in oauthResources are OAuth-protected. Answering
			// discovery on any other path (including the root, which clients
			// fall back to) makes them demand OAuth for /mcp/:id too
			if resource := s.oauthResources[strings.TrimPrefix(path, "/.well-known/oauth-protected-resource")]; resource != nil {
				u, _ := url.Parse(resolveURL("/.well-known/oauth-protected-resource", envBackend()))
				if resource.middleware(w, r, u).Handled {
					return
				}
			}

		case strings.HasPrefix(path, "/.well-known/oauth-authorization-server/"), strings.HasPrefix(path, "/.well-known/openid-configuration/"):
			oidc := strings.HasPrefix(path, "/.well-known/openid-configuration/")
			rest := strings.TrimPrefix(strings.TrimPrefix(path, "/.well-known/oauth-authorization-server"), "/.well-known/openid-configuration")
			server, ok := s.authorizationServers[rest]
			if ok && (!oidc || s.enableOIDC) {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				if r.Method == http.MethodOptions {
					w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
					w.WriteHeader(http.StatusNoContent)
					return
				}
				m := s.authorizationServerMetadata(server)
				if oidc {
					m.SubjectTypesSupported = []string{"public"}
					m.ClaimsSupported = []string{"sub", "email", "email_verified"}
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "max-age=3600")
				_ = json.NewEncoder(w).Encode(m)
				return
			}

		case s.oauthResources[strings.TrimSuffix(path, "/")] != nil:
			s.serveOAuth(w, r, strings.TrimSuffix(path, "/"))
			return

		case path == "/mcp" || path == "/mcp/":
			s.serveAPIKey(w, r)
			return

		case strings.HasPrefix(path, "/mcp/"):
			id := strings.SplitN(strings.TrimPrefix(path, "/mcp/"), "/", 2)[0]
			s.serveMCPWithKey(w, r, id)
			return

		case strings.HasPrefix(path, "/sse/"), strings.HasPrefix(path, "/message/"):
			s.serveSSE(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) serveOAuth(w http.ResponseWriter, r *http.Request, mount string) {
	resource := s.oauthResources[mount]
	u, _ := url.Parse(resolveURL(mount, envBackend()))
	result := resource.middleware(w, r, u)
	if !result.Proceed {
		return
	}
	token := result.TokenValidation.Subject
	// a self-hosted connection has no organization here
	var relay *chat.SelfHostedInstance
	var auth *ent.Organization
	if strings.HasPrefix(token, "psh_") {
		relay, _ = s.oauth.GetSelfHostedByAccessToken(r.Context(), token)
	} else {
		auth, _ = s.resolveAuth(r.Context(), token)
	}
	if auth == nil && (relay == nil || resource.selfHosted == nil) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_token","error_description":"Could not resolve organization"}`))
		return
	}
	def := resource.server
	if relay != nil {
		def = resource.selfHosted
	}
	s.serveHTTP(w, r, def, token, auth, relay)
}

func (s *Server) serveAPIKey(w http.ResponseWriter, r *http.Request) {
	corsAll(w)
	if r.Method == http.MethodOptions {
		sendStatusOK(w)
		return
	}
	token := strings.Replace(r.Header.Get("Authorization"), "Bearer ", "", 1)
	if token == "" {
		sendText(w, http.StatusUnauthorized, "Missing Authorization header")
		return
	}
	auth, _ := s.resolveAuth(r.Context(), token)
	if auth == nil {
		sendText(w, http.StatusUnauthorized, "Invalid API Key or OAuth token")
		return
	}
	s.serveHTTP(w, r, s.server, token, auth, nil)
}

func (s *Server) serveMCPWithKey(w http.ResponseWriter, r *http.Request, id string) {
	corsAll(w)
	if r.Method == http.MethodOptions {
		sendStatusOK(w)
		return
	}
	auth, _ := s.orgs.GetOrgByAPIKey(r.Context(), id)
	if auth == nil {
		sendText(w, http.StatusBadRequest, "Invalid API Key")
		return
	}
	s.serveHTTP(w, r, s.server, id, auth, nil)
}

// serveSSE is the 2024-11-05 HTTP+SSE transport: GET /sse/:id opens the
// stream and announces /message/:id?sessionId=..., POSTs to it carry the
// client messages.
func (s *Server) serveSSE(w http.ResponseWriter, r *http.Request) {
	corsAll(w)
	if r.Method == http.MethodOptions {
		sendStatusOK(w)
		return
	}
	isSSE := strings.HasPrefix(r.URL.Path, "/sse/")
	rest := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/sse/"), "/message/")
	id := strings.SplitN(rest, "/", 2)[0]
	auth, _ := s.orgs.GetOrgByAPIKey(r.Context(), id)
	if auth == nil {
		sendText(w, http.StatusBadRequest, "Invalid API Key")
		return
	}

	if !isSSE {
		if r.Method != http.MethodPost {
			sendText(w, http.StatusNotFound, "Not found")
			return
		}
		s.sseMu.Lock()
		transport := s.sseSessions[r.URL.Query().Get("sessionId")]
		s.sseMu.Unlock()
		if transport == nil {
			sendText(w, http.StatusServiceUnavailable, "SSE connection not established")
			return
		}
		transport.ServeHTTP(w, r)
		return
	}
	if r.Method != http.MethodGet {
		sendText(w, http.StatusNotFound, "Not found")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	sessionID := newSessionID()
	transport := &sdk.SSEServerTransport{Endpoint: fmt.Sprintf("/message/%s?sessionId=%s", url.PathEscape(id), sessionID), Response: w}
	s.sseMu.Lock()
	s.sseSessions[sessionID] = transport
	s.sseMu.Unlock()
	defer func() {
		s.sseMu.Lock()
		delete(s.sseSessions, sessionID)
		s.sseMu.Unlock()
	}()
	session, err := s.build(s.server, id, auth, nil).Connect(r.Context(), transport, nil)
	if err != nil {
		return
	}
	// the session ends with the GET request
	go func() {
		<-r.Context().Done()
		_ = session.Close()
	}()
	_ = session.Wait()
}
