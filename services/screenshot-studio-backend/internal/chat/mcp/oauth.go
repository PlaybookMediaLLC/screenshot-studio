package mcp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// OAuth 2.0 Protected Resource support (RFC 9728) for the MCP endpoints,
// ported from oauth-types.ts and oauth-middleware.ts (Mastra commit 27c37ca).

// OAuthConfig is MCPServerOAuthConfig.
type OAuthConfig struct {
	Resource              string
	AuthorizationServers  []string
	ScopesSupported       []string
	ResourceName          string
	ResourceDocumentation string
	ValidateToken         func(ctx context.Context, token, resource string) TokenValidationResult
}

// TokenValidationResult is the result of token validation.
type TokenValidationResult struct {
	Valid            bool           `json:"valid"`
	Error            string         `json:"error,omitempty"`
	ErrorDescription string         `json:"errorDescription,omitempty"`
	Scopes           []string       `json:"scopes,omitempty"`
	Subject          string         `json:"subject,omitempty"`
	ExpiresAt        int64          `json:"expiresAt,omitempty"`
	Claims           map[string]any `json:"claims,omitempty"`
}

// ProtectedResourceMetadata is RFC 9728 metadata.
type ProtectedResourceMetadata struct {
	Resource               string   `json:"resource"`
	AuthorizationServers   []string `json:"authorization_servers"`
	ScopesSupported        []string `json:"scopes_supported,omitempty"`
	BearerMethodsSupported []string `json:"bearer_methods_supported,omitempty"`
	ResourceName           string   `json:"resource_name,omitempty"`
	ResourceDocumentation  string   `json:"resource_documentation,omitempty"`
}

func escapeHeaderValue(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), `"`, `\"`)
}

// Param is one WWW-Authenticate parameter (kept in order).
type Param struct{ Key, Value string }

// GenerateWWWAuthenticateHeader builds the Bearer challenge.
func GenerateWWWAuthenticateHeader(resourceMetadataURL string, additional ...Param) string {
	var params []string
	if resourceMetadataURL != "" {
		params = append(params, fmt.Sprintf(`resource_metadata="%s"`, escapeHeaderValue(resourceMetadataURL)))
	}
	for _, p := range additional {
		params = append(params, fmt.Sprintf(`%s="%s"`, p.Key, escapeHeaderValue(p.Value)))
	}
	if len(params) == 0 {
		return "Bearer"
	}
	return "Bearer " + strings.Join(params, ", ")
}

// GenerateProtectedResourceMetadata is generateProtectedResourceMetadata.
func GenerateProtectedResourceMetadata(config OAuthConfig) ProtectedResourceMetadata {
	scopes := config.ScopesSupported
	if scopes == nil {
		scopes = []string{"mcp:read", "mcp:write"}
	}
	return ProtectedResourceMetadata{
		Resource:               config.Resource,
		AuthorizationServers:   config.AuthorizationServers,
		ScopesSupported:        scopes,
		BearerMethodsSupported: []string{"header"},
		ResourceName:           config.ResourceName,
		ResourceDocumentation:  config.ResourceDocumentation,
	}
}

// ExtractBasicCredentials parses RFC 6749 §2.3.1 client_secret_basic:
// "Basic base64(urlencode(id):urlencode(secret))". ok is false when absent
// or malformed.
func ExtractBasicCredentials(authHeader string) (clientID, clientSecret string, ok bool) {
	const prefix = "basic "
	if len(authHeader) <= len(prefix) || strings.ToLower(authHeader[:len(prefix)]) != prefix {
		return "", "", false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(authHeader[len(prefix):]))
	if err != nil {
		return "", "", false
	}
	separator := strings.Index(string(decoded), ":")
	if separator <= 0 {
		return "", "", false
	}
	id, err1 := url.PathUnescape(string(decoded[:separator]))
	secret, err2 := url.PathUnescape(string(decoded[separator+1:]))
	if err1 != nil || err2 != nil {
		return "", "", false
	}
	return id, secret, true
}

// ExtractBearerToken returns the bearer token or "".
func ExtractBearerToken(authHeader string) string {
	const prefix = "bearer "
	if len(authHeader) <= len(prefix) || strings.ToLower(authHeader[:len(prefix)]) != prefix {
		return ""
	}
	return strings.TrimSpace(authHeader[len(prefix):])
}

// OAuthMiddlewareResult is what the middleware decided.
type OAuthMiddlewareResult struct {
	Proceed         bool
	Handled         bool
	TokenValidation *TokenValidationResult
}

// OAuthMiddleware is the function createOAuthMiddleware returns.
type OAuthMiddleware func(w http.ResponseWriter, r *http.Request, u *url.URL) OAuthMiddlewareResult

func writeJSONHeaders(w http.ResponseWriter, status int, headers map[string]string, body any) {
	for k, v := range headers {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	if body != nil {
		data, _ := json.Marshal(body)
		_, _ = w.Write(data)
	}
}

// CreateOAuthMiddleware is createOAuthMiddleware.
func CreateOAuthMiddleware(oauth OAuthConfig, mcpPath string) OAuthMiddleware {
	if mcpPath == "" {
		mcpPath = "/mcp"
	}
	metadata := GenerateProtectedResourceMetadata(oauth)
	const wellKnownPath = "/.well-known/oauth-protected-resource"
	// RFC 9728 path-inserted form (/.well-known/oauth-protected-resource/mcp-oauth):
	// the root well-known must stay 404 so clients don't demand OAuth for other paths
	resourcePath := "/"
	if u, err := url.Parse(oauth.Resource); err == nil && u.Path != "" {
		resourcePath = u.Path
	}
	suffix := resourcePath
	if suffix == "/" {
		suffix = ""
	}
	resourceMetadataURL := wellKnownPath + suffix
	if base, err := url.Parse(oauth.Resource); err == nil {
		if ref, err := base.Parse(wellKnownPath + suffix); err == nil {
			resourceMetadataURL = ref.String()
		}
	}

	return func(w http.ResponseWriter, r *http.Request, u *url.URL) OAuthMiddlewareResult {
		// Handle Protected Resource Metadata endpoint (RFC 9728)
		if u.Path == wellKnownPath && r.Method == http.MethodGet {
			writeJSONHeaders(w, http.StatusOK, map[string]string{
				"Content-Type":                "application/json",
				"Cache-Control":               "max-age=3600",
				"Access-Control-Allow-Origin": "*",
			}, metadata)
			return OAuthMiddlewareResult{Handled: true}
		}
		// Handle CORS preflight for metadata endpoint
		if u.Path == wellKnownPath && r.Method == http.MethodOptions {
			writeJSONHeaders(w, http.StatusNoContent, map[string]string{
				"Access-Control-Allow-Origin":  "*",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
				"Access-Control-Max-Age":       "86400",
			}, nil)
			return OAuthMiddlewareResult{Handled: true}
		}
		// Only protect the MCP endpoint
		if !strings.HasPrefix(u.Path, mcpPath) {
			return OAuthMiddlewareResult{Proceed: true}
		}

		token := ExtractBearerToken(r.Header.Get("Authorization"))
		if token == "" {
			writeJSONHeaders(w, http.StatusUnauthorized, map[string]string{
				"Content-Type":     "application/json",
				"WWW-Authenticate": GenerateWWWAuthenticateHeader(resourceMetadataURL),
			}, map[string]string{"error": "unauthorized", "error_description": "Bearer token required"})
			return OAuthMiddlewareResult{Handled: true}
		}

		if oauth.ValidateToken == nil {
			// If no validateToken function provided, accept the token
			return OAuthMiddlewareResult{Proceed: true, TokenValidation: &TokenValidationResult{Valid: true}}
		}
		result := oauth.ValidateToken(r.Context(), token, oauth.Resource)
		if !result.Valid {
			code := result.Error
			if code == "" {
				code = "invalid_token"
			}
			params := []Param{{"error", code}}
			if result.ErrorDescription != "" {
				params = append(params, Param{"error_description", result.ErrorDescription})
			}
			description := result.ErrorDescription
			if description == "" {
				description = "Token validation failed"
			}
			writeJSONHeaders(w, http.StatusUnauthorized, map[string]string{
				"Content-Type":     "application/json",
				"WWW-Authenticate": GenerateWWWAuthenticateHeader(resourceMetadataURL, params...),
			}, map[string]string{"error": code, "error_description": description})
			return OAuthMiddlewareResult{Handled: true, TokenValidation: &result}
		}
		return OAuthMiddlewareResult{Proceed: true, TokenValidation: &result}
	}
}

// CreateStaticTokenValidator accepts a fixed list of tokens.
func CreateStaticTokenValidator(validTokens []string) func(ctx context.Context, token, resource string) TokenValidationResult {
	return func(_ context.Context, token, _ string) TokenValidationResult {
		if slices.Contains(validTokens, token) {
			return TokenValidationResult{Valid: true, Scopes: []string{"mcp:read", "mcp:write"}}
		}
		return TokenValidationResult{Error: "invalid_token", ErrorDescription: "Token not recognized"}
	}
}

// CreateIntrospectionValidator validates tokens with RFC 7662 introspection.
func CreateIntrospectionValidator(endpoint, clientID, clientSecret string) func(ctx context.Context, token, resource string) TokenValidationResult {
	return func(ctx context.Context, token, resource string) TokenValidationResult {
		form := url.Values{"token": {token}, "token_type_hint": {"access_token"}}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
		if err != nil {
			return TokenValidationResult{Error: "server_error", ErrorDescription: err.Error()}
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if clientID != "" {
			if strings.Contains(clientID, ":") {
				return TokenValidationResult{Error: "invalid_request", ErrorDescription: "clientId cannot contain a colon character per RFC 7617"}
			}
			req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(clientID+":"+clientSecret)))
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return TokenValidationResult{Error: "server_error", ErrorDescription: err.Error()}
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return TokenValidationResult{Error: "server_error", ErrorDescription: fmt.Sprintf("Introspection failed: %d", res.StatusCode)}
		}
		var data map[string]any
		if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
			return TokenValidationResult{Error: "server_error", ErrorDescription: err.Error()}
		}
		if active, _ := data["active"].(bool); !active {
			return TokenValidationResult{Error: "invalid_token", ErrorDescription: "Token is not active"}
		}
		if aud, ok := data["aud"]; ok && aud != nil {
			var audiences []string
			switch v := aud.(type) {
			case string:
				audiences = []string{v}
			case []any:
				for _, a := range v {
					audiences = append(audiences, fmt.Sprint(a))
				}
			}
			if !slices.Contains(audiences, resource) {
				return TokenValidationResult{Error: "invalid_token", ErrorDescription: "Token audience does not match this resource"}
			}
		}
		result := TokenValidationResult{Valid: true, Scopes: []string{}, Claims: data}
		if scope, ok := data["scope"].(string); ok {
			result.Scopes = strings.Fields(scope)
		}
		result.Subject, _ = data["sub"].(string)
		if exp, ok := data["exp"].(float64); ok {
			result.ExpiresAt = int64(exp)
		}
		return result
	}
}
