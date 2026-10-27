package mcp

import (
	"fmt"
	"strings"
)

// OAuth 2.0 Protected Resource support (RFC 9728) for the MCP endpoints,
// first ported from Mastra's oauth-middleware.ts.

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

// ExtractBearerToken returns the bearer token or "".
func ExtractBearerToken(authHeader string) string {
	const prefix = "bearer "
	if len(authHeader) <= len(prefix) || strings.ToLower(authHeader[:len(prefix)]) != prefix {
		return ""
	}
	return strings.TrimSpace(authHeader[len(prefix):])
}
