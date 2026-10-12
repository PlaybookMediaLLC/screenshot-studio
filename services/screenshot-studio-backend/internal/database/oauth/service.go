package oauth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/oauth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
)

func openAIOAuthClientID() string { return strings.TrimSpace(os.Getenv("OPENAI_OAUTH_CLIENT_ID")) }

func enableOIDCEmailClaims() bool { return openAIOAuthClientID() != "" }

// SelfHostedRelayEnabled is Postiz Cloud only, a self-hosted install has
// nothing to relay to.
func SelfHostedRelayEnabled() bool { return os.Getenv("MCP_SELF_HOSTED_RELAY") == "true" }

// Verified-domain match: exact host or a subdomain of it (spoof-safe, the
// leading dot means evilclaude.ai and claude.ai.evil.com are both rejected)
func isVerifiedHost(host string, verifiedDomains []string) bool {
	for _, domain := range verifiedDomains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

// Schemes a browser would execute instead of navigating away from the
// consent screen, so they can never be a redirect_uri
var browserSchemes = []string{"javascript:", "data:", "blob:", "file:", "vbscript:", "about:"}

// SelfHostedInstance is chat/mcp.relay.service's SelfHostedInstance plus the
// email typed on the consent screen.
type SelfHostedInstance struct {
	MCPURL string `json:"mcpUrl"`
	APIKey string `json:"apiKey"`
	Email  string `json:"email,omitempty"`
}

// SelfHostedConnection is getSelfHostedByAccessToken's result.
type SelfHostedConnection struct {
	ID     string `json:"id"`
	MCPURL string `json:"mcpUrl"`
	APIKey string `json:"apiKey"`
}

// PKCEOptions are the code challenge and redirect_uri of an authorization
// request ("" = not sent).
type PKCEOptions struct {
	CodeChallenge       string
	CodeChallengeMethod string
	RedirectURI         string
}

// AppWithSecret is createApp's {...app, clientSecret}: the only time the
// plain secret is returned.
type AppWithSecret struct {
	*ent.OAuthApp
	ClientSecret string
}

func (a AppWithSecret) MarshalJSON() ([]byte, error) {
	base, err := json.Marshal(a.OAuthApp)
	if err != nil {
		return nil, err
	}
	secret, _ := json.Marshal(a.ClientSecret)
	var buf bytes.Buffer
	buf.Write(base[:len(base)-1])
	buf.WriteString(`,"clientSecret":`)
	buf.Write(secret)
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

type SuccessResponse struct {
	Success bool `json:"success"`
}

type ClientSecretResponse struct {
	ClientSecret string `json:"clientSecret"`
}

type RegisterClientResponse struct {
	ClientID                string   `json:"client_id"`
	ClientSecret            string   `json:"client_secret,omitempty"`
	ClientSecretExpiresAt   *int     `json:"client_secret_expires_at,omitempty"`
	ClientIDIssuedAt        int64    `json:"client_id_issued_at"`
	ClientName              string   `json:"client_name"`
	RedirectURIs            []string `json:"redirect_uris"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	Scope                   string   `json:"scope"`
}

// UserInfo is the OIDC userinfo response.
type UserInfo struct {
	Sub           string  `json:"sub"`
	Email         *string `json:"email,omitempty"`
	EmailVerified *bool   `json:"email_verified,omitempty"`
}

// ExtractBearerToken is chat/oauth-types extractBearerToken ("" = none).
func ExtractBearerToken(authHeader string) string {
	const prefix = "bearer "
	if len(authHeader) <= len(prefix) || strings.ToLower(authHeader[:len(prefix)]) != prefix {
		return ""
	}
	return strings.TrimSpace(authHeader[len(prefix):])
}

var specialSchemes = map[string]bool{"http": true, "https": true, "ws": true, "wss": true, "ftp": true}

// parseURL approximates WHATWG `new URL(value)`: absolute URLs only, and
// special schemes need a host. Protocol is "scheme:", hostname lowercased.
func parseURL(value string) (protocol, hostname string, u *url.URL, ok bool) {
	u, err := url.Parse(value)
	if err != nil || u.Scheme == "" || (specialSchemes[u.Scheme] && u.Host == "") {
		return "", "", nil, false
	}
	return u.Scheme + ":", strings.ToLower(u.Hostname()), u, true
}

func badRequest(body any) error { return httpx.HTTPException(body, http.StatusBadRequest) }

func invalidRedirect(description string) error {
	return badRequest(map[string]any{"error": "invalid_redirect_uri", "error_description": description})
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// GetApp returns nil when the org has no app (the controller answers false).
// The client secret is never serialized.
func (s *Service) GetApp(ctx context.Context, orgID string) (*ent.OAuthApp, error) {
	return s.repo.GetAppByOrgID(ctx, orgID)
}

func (s *Service) CreateApp(ctx context.Context, orgID string, body dto.CreateOAuthAppDto) (*AppWithSecret, error) {
	existing, err := s.repo.GetAppByOrgID(ctx, orgID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, httpx.HTTPException("You can only have one OAuth application per organization", http.StatusBadRequest)
	}

	clientID := "pca_" + ids.Secure(32)
	clientSecret := "pcs_" + ids.Secure(48)
	encryptedSecret, err := helpers.FixedEncryption(clientSecret)
	if err != nil {
		return nil, err
	}
	app, err := s.repo.CreateApp(ctx, orgID, CreateAppData{
		Name: body.Name, Description: body.Description, PictureID: body.PictureID,
		RedirectURL: body.RedirectURL, ClientID: clientID, ClientSecret: encryptedSecret,
	})
	if err != nil {
		return nil, err
	}
	return &AppWithSecret{OAuthApp: app, ClientSecret: clientSecret}, nil
}

// UpdateApp returns nil when the org has no app.
func (s *Service) UpdateApp(ctx context.Context, orgID string, body dto.UpdateOAuthAppDto) (*ent.OAuthApp, error) {
	var data UpdateAppData
	if body.Name != "" {
		data.Name = &body.Name
	}
	data.Description = body.Description
	data.PictureID = body.PictureID
	if body.RedirectURL != "" {
		data.RedirectURL = &body.RedirectURL
	}
	return s.repo.UpdateApp(ctx, orgID, data)
}

func (s *Service) DeleteApp(ctx context.Context, orgID string) (SuccessResponse, error) {
	app, err := s.repo.GetAppByOrgID(ctx, orgID)
	if err != nil {
		return SuccessResponse{}, err
	}
	if app == nil {
		return SuccessResponse{}, httpx.HTTPException("No OAuth app found", http.StatusNotFound)
	}
	if _, err := s.repo.RevokeAllForApp(ctx, app.ID); err != nil {
		return SuccessResponse{}, err
	}
	if _, err := s.repo.DeleteApp(ctx, orgID); err != nil {
		return SuccessResponse{}, err
	}
	return SuccessResponse{Success: true}, nil
}

func (s *Service) RotateSecret(ctx context.Context, orgID string) (ClientSecretResponse, error) {
	app, err := s.repo.GetAppByOrgID(ctx, orgID)
	if err != nil {
		return ClientSecretResponse{}, err
	}
	if app == nil {
		return ClientSecretResponse{}, httpx.HTTPException("No OAuth app found", http.StatusNotFound)
	}
	newSecret := "pcs_" + ids.Secure(48)
	encrypted, err := helpers.FixedEncryption(newSecret)
	if err != nil {
		return ClientSecretResponse{}, err
	}
	if _, err := s.repo.UpdateClientSecret(ctx, orgID, encrypted); err != nil {
		return ClientSecretResponse{}, err
	}
	return ClientSecretResponse{ClientSecret: newSecret}, nil
}

// Domains allowed to receive DCR redirect_uris, from the
// DCR_VERIFIED_DOMAINS env (comma separated). An empty list
// means open registration (self-hosted default)
func verifiedDomainList() []string {
	var out []string
	for _, domain := range strings.Split(os.Getenv("DCR_VERIFIED_DOMAINS"), ",") {
		if d := strings.ToLower(strings.TrimSpace(domain)); d != "" {
			out = append(out, d)
		}
	}
	return out
}

func (s *Service) RegisterDynamicClient(ctx context.Context, body dto.RegisterClientDto) (*RegisterClientResponse, error) {
	redirectURIs := make([]string, 0, len(body.RedirectURIs))
	for _, uri := range body.RedirectURIs {
		redirectURIs = append(redirectURIs, strings.TrimSpace(uri))
	}
	verifiedDomains := verifiedDomainList()
	for _, uri := range redirectURIs {
		protocol, hostname, _, ok := parseURL(uri)
		if !ok {
			return nil, invalidRedirect("Invalid redirect_uri: " + uri)
		}

		// The consent screen navigates to the redirect_uri, so schemes the
		// browser would execute in our origin can never be a callback
		if slices.Contains(browserSchemes, protocol) {
			return nil, invalidRedirect(fmt.Sprintf(`redirect_uri scheme "%s" is not allowed`, protocol))
		}

		isLoopback := protocol == "http:" && slices.Contains([]string{"localhost", "127.0.0.1", "::1"}, hostname)
		// Private-use schemes (RFC 8252 §7.1), e.g.
		// cursor://anysphere.cursor-mcp/oauth/callback
		isPrivateScheme := protocol != "http:" && protocol != "https:"
		if protocol == "http:" && !isLoopback {
			return nil, invalidRedirect("redirect_uris must use https or a private-use scheme (http is allowed for loopback only)")
		}

		// Loopback and private-use callbacks never leave the user's machine
		// (native clients like Cursor, Grok and Claude Code), so only web
		// callbacks are held to the verified domain list
		if isLoopback || isPrivateScheme || len(verifiedDomains) == 0 {
			continue
		}
		if !isVerifiedHost(hostname, verifiedDomains) {
			return nil, invalidRedirect(fmt.Sprintf(`redirect_uri host "%s" is not a verified domain`, hostname))
		}
	}

	if len(body.GrantTypes) > 0 && !slices.Contains(body.GrantTypes, "authorization_code") {
		return nil, badRequest(map[string]any{"error": "invalid_client_metadata", "error_description": "Only the authorization_code grant type is supported"})
	}

	// Registration happens before consent, so abandoned flows leave orphan
	// clients behind; opportunistically prune the ones nobody ever authorized
	go func(ctx context.Context) {
		_, _ = s.repo.DeleteStaleDynamicApps(ctx, time.Now().Add(-30*24*time.Hour))
	}(context.WithoutCancel(ctx))

	isPublicClient := body.TokenEndpointAuthMethod == "none"
	// The token endpoint accepts the secret from either place; the stored
	// method only mirrors back what the client asked for
	tokenEndpointAuthMethod := "client_secret_post"
	if isPublicClient {
		tokenEndpointAuthMethod = "none"
	} else if body.TokenEndpointAuthMethod == "client_secret_basic" {
		tokenEndpointAuthMethod = "client_secret_basic"
	}
	clientID := "pcd_" + ids.Secure(32)
	clientSecret := ""
	var encryptedSecret *string
	if !isPublicClient {
		clientSecret = "pcs_" + ids.Secure(48)
		encrypted, err := helpers.FixedEncryption(clientSecret)
		if err != nil {
			return nil, err
		}
		encryptedSecret = &encrypted
	}

	name := ""
	if body.ClientName != nil {
		name = strings.TrimSpace(*body.ClientName)
		if r := []rune(name); len(r) > 100 {
			name = string(r[:100])
		}
	}
	if name == "" {
		name = "MCP Client"
	}
	redirectJSON, err := json.Marshal(redirectURIs)
	if err != nil {
		return nil, err
	}
	app, err := s.repo.CreateDynamicApp(ctx, CreateDynamicAppData{
		Name: name, RedirectURL: redirectURIs[0], RedirectURIs: string(redirectJSON), ClientID: clientID,
		ClientSecret: encryptedSecret, TokenEndpointAuthMethod: tokenEndpointAuthMethod,
	})
	if err != nil {
		return nil, err
	}

	out := &RegisterClientResponse{
		ClientID: clientID, ClientIDIssuedAt: app.CreatedAt.Unix(), ClientName: app.Name,
		RedirectURIs: redirectURIs, TokenEndpointAuthMethod: tokenEndpointAuthMethod,
		GrantTypes: []string{"authorization_code"}, ResponseTypes: []string{"code"}, Scope: "mcp:read mcp:write",
	}
	if clientSecret != "" {
		zero := 0
		out.ClientSecret, out.ClientSecretExpiresAt = clientSecret, &zero
	}
	return out, nil
}

// Email claims (openid/email scope + userinfo) go to the static ChatGPT app
// and to dynamically registered clients whose web callbacks all live on a
// verified domain (DCR_VERIFIED_DOMAINS). Everything else, including every
// dynamic client on a self-hosted install with no verified domains, only
// gets the mcp scopes
func allowsEmailClaims(app *ent.OAuthApp) bool {
	if app == nil || !enableOIDCEmailClaims() {
		return false
	}
	if app.ClientID == openAIOAuthClientID() {
		return true
	}
	if !app.Dynamic {
		return false
	}
	verifiedDomains := verifiedDomainList()
	if len(verifiedDomains) == 0 {
		return false
	}

	raw := "[]"
	if app.RedirectUris != nil && *app.RedirectUris != "" {
		raw = *app.RedirectUris
	}
	var uris []string
	_ = json.Unmarshal([]byte(raw), &uris)
	var webHosts []string
	for _, uri := range uris {
		protocol, hostname, _, ok := parseURL(uri)
		if !ok {
			return false
		}
		if protocol == "https:" {
			webHosts = append(webHosts, hostname)
		}
	}
	if len(webHosts) == 0 {
		return false
	}
	for _, host := range webHosts {
		if !isVerifiedHost(host, verifiedDomains) {
			return false
		}
	}
	return true
}

func grantedScope(app *ent.OAuthApp) string {
	var scopes []string
	if allowsEmailClaims(app) {
		scopes = append(scopes, "openid", "email")
	}
	return strings.Join(append(scopes, "mcp:read", "mcp:write"), " ")
}

// AllowsSelfHosted: only MCP connections can be relayed to an instance:
// dynamically registered clients (registration is only advertised to MCP
// clients), the ChatGPT app, or a client asking for one of the /mcp-oauth
// resources (RFC 8707). Apps that use Postiz OAuth for the public API never
// get the option, a relayed token doesn't work there
func (s *Service) AllowsSelfHosted(app *ent.OAuthApp, resource string) bool {
	if !SelfHostedRelayEnabled() {
		return false
	}
	if app.Dynamic || app.ClientID == openAIOAuthClientID() {
		return true
	}
	if resource == "" {
		return false
	}
	_, _, u, ok := parseURL(resource)
	if !ok {
		return false
	}
	path := u.EscapedPath()
	if path == "" && specialSchemes[u.Scheme] {
		path = "/"
	}
	return strings.HasPrefix(path, "/mcp-oauth")
}

// SelfHostedRequiresEmail: the ChatGPT app reads the email from userinfo; a
// self-hosted connection has no cloud user to take it from, so the consent
// screen asks for one
func (s *Service) SelfHostedRequiresEmail(app *ent.OAuthApp) bool {
	return enableOIDCEmailClaims() && app.ClientID == openAIOAuthClientID()
}

// ValidateSelfHostedRequest runs on top of ValidateAuthorizationRequest, for
// a self-hosted connection.
func (s *Service) ValidateSelfHostedRequest(app *ent.OAuthApp, resource, email string) error {
	if !s.AllowsSelfHosted(app, resource) {
		return httpx.HTTPException("This application can not connect to a self-hosted instance", http.StatusBadRequest)
	}
	if email == "" && s.SelfHostedRequiresEmail(app) {
		return httpx.HTTPException("Enter your email address", http.StatusBadRequest)
	}
	return nil
}

func (s *Service) ValidateAuthorizationRequest(ctx context.Context, clientID string, options PKCEOptions) (*ent.OAuthApp, error) {
	app, err := s.repo.GetAppByClientID(ctx, clientID)
	if err != nil {
		return nil, err
	}
	if app == nil {
		return nil, httpx.HTTPException("Invalid client_id", http.StatusBadRequest)
	}

	// Dynamically registered clients must use their registered redirect_uris
	// and PKCE; statically registered apps keep the existing lenient flow
	if app.Dynamic {
		var registered []string
		if app.RedirectUris != nil && *app.RedirectUris != "" {
			if err := json.Unmarshal([]byte(*app.RedirectUris), &registered); err != nil {
				return nil, err
			}
		}
		if options.RedirectURI == "" || !slices.Contains(registered, options.RedirectURI) {
			return nil, httpx.HTTPException("Invalid redirect_uri", http.StatusBadRequest)
		}
		if app.TokenEndpointAuthMethod != nil && *app.TokenEndpointAuthMethod == "none" && options.CodeChallenge == "" {
			return nil, httpx.HTTPException("code_challenge is required for this client", http.StatusBadRequest)
		}
		if options.CodeChallenge != "" && options.CodeChallengeMethod != "" && options.CodeChallengeMethod != "S256" {
			return nil, httpx.HTTPException("Only the S256 code_challenge_method is supported", http.StatusBadRequest)
		}
	}
	return app, nil
}

func (s *Service) CreateAuthorizationCode(ctx context.Context, oauthAppID, userID, organizationID string, pkce PKCEOptions) (string, error) {
	code := ids.Secure(32)
	encryptedCode, err := helpers.FixedEncryption(code)
	if err != nil {
		return "", err
	}
	err = s.repo.CreateAuthorization(ctx, CreateAuthorizationData{
		OauthAppID: oauthAppID, UserID: userID, OrganizationID: organizationID,
		AuthorizationCode: encryptedCode, CodeExpiresAt: time.Now().Add(10 * time.Minute),
		CodeChallenge: pkce.CodeChallenge, CodeChallengeMethod: pkce.CodeChallengeMethod, RedirectURI: pkce.RedirectURI,
	})
	if err != nil {
		return "", err
	}
	return code, nil
}

func (s *Service) CreateSelfHostedAuthorizationCode(ctx context.Context, oauthAppID string, instance SelfHostedInstance, pkce PKCEOptions) (string, error) {
	go func(ctx context.Context) {
		_, _ = s.repo.DeleteAbandonedSelfHostedAuthorizations(ctx, time.Now().Add(-24*time.Hour))
	}(context.WithoutCancel(ctx))

	// The prefix sends the code to the self-hosted table at the token
	// endpoint (regular codes use the same alphabet, without an underscore)
	code := "psc_" + ids.Secure(32)
	apiKey, err := helpers.FixedEncryption(instance.APIKey)
	if err != nil {
		return "", err
	}
	encryptedCode, err := helpers.FixedEncryption(code)
	if err != nil {
		return "", err
	}
	_, err = s.repo.CreateSelfHostedAuthorization(ctx, CreateSelfHostedAuthorizationData{
		OauthAppID: oauthAppID, MCPURL: instance.MCPURL, APIKey: apiKey, Email: instance.Email,
		AuthorizationCode: encryptedCode, CodeExpiresAt: time.Now().Add(10 * time.Minute),
		CodeChallenge: pkce.CodeChallenge, CodeChallengeMethod: pkce.CodeChallengeMethod, RedirectURI: pkce.RedirectURI,
	})
	if err != nil {
		return "", err
	}
	return code, nil
}

// ExchangeCodeForToken is the token endpoint's authorization_code grant. The
// response is {id, cus, access_token, token_type, scope}, or without id/cus
// for a self-hosted code.
func (s *Service) ExchangeCodeForToken(ctx context.Context, code, clientID, clientSecret, codeVerifier, redirectURI string) (map[string]any, error) {
	invalidClient := httpx.HTTPException(map[string]any{"error": "invalid_client"}, http.StatusUnauthorized)
	app, err := s.repo.GetAppByClientID(ctx, clientID)
	if err != nil {
		return nil, err
	}
	if app == nil {
		return nil, invalidClient
	}

	// Public clients (dynamic registration with token_endpoint_auth_method=none)
	// authenticate with PKCE instead of a client secret
	isPublicClient := app.Dynamic && app.TokenEndpointAuthMethod != nil && *app.TokenEndpointAuthMethod == "none"
	if !isPublicClient {
		if clientSecret == "" || app.ClientSecret == nil || *app.ClientSecret == "" {
			return nil, invalidClient
		}
		encrypted, err := helpers.FixedEncryption(clientSecret)
		if err != nil {
			return nil, err
		}
		if subtle.ConstantTimeCompare([]byte(*app.ClientSecret), []byte(encrypted)) != 1 {
			return nil, invalidClient
		}
	}

	if strings.HasPrefix(code, "psc_") {
		return s.exchangeSelfHostedCodeForToken(ctx, app, code, codeVerifier, redirectURI)
	}

	encryptedCode, err := helpers.FixedEncryption(code)
	if err != nil {
		return nil, err
	}
	auth, err := s.repo.FindByCode(ctx, encryptedCode)
	if err != nil {
		return nil, err
	}
	if auth == nil || auth.OauthAppID != app.ID {
		return nil, badRequest(map[string]any{"error": "invalid_grant"})
	}
	if err := verifyCodeGrant(auth.CodeExpiresAt, auth.CodeChallenge, auth.RedirectURI, codeVerifier, redirectURI); err != nil {
		return nil, err
	}

	token := "pos_" + ids.Secure(40)
	encryptedToken, err := helpers.FixedEncryption(token)
	if err != nil {
		return nil, err
	}
	exchanged, err := s.repo.ExchangeCodeForToken(ctx, auth.ID, encryptedToken)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":           exchanged.OrganizationID,
		"cus":          exchanged.PaymentID,
		"access_token": token,
		"token_type":   "bearer",
		"scope":        grantedScope(app),
	}, nil
}

func grantError(description string) error {
	return badRequest(map[string]any{"error": "invalid_grant", "error_description": description})
}

// verifyCodeGrant: expiry, PKCE and redirect_uri checks of an authorization
// code, shared by cloud and self-hosted authorizations
func verifyCodeGrant(codeExpiresAt *time.Time, codeChallenge, storedRedirectURI *string, codeVerifier, redirectURI string) error {
	if codeExpiresAt == nil || time.Now().After(*codeExpiresAt) {
		return grantError("Code has expired")
	}
	if codeChallenge != nil && *codeChallenge != "" {
		if codeVerifier == "" {
			return grantError("code_verifier is required")
		}
		sum := sha256.Sum256([]byte(codeVerifier))
		if base64.RawURLEncoding.EncodeToString(sum[:]) != *codeChallenge {
			return grantError("Invalid code_verifier")
		}
	}
	if storedRedirectURI != nil && *storedRedirectURI != "" && redirectURI != *storedRedirectURI {
		return grantError("redirect_uri does not match the authorization request")
	}
	return nil
}

// A self-hosted connection has no organization (or payment) to return,
// only the token
func (s *Service) exchangeSelfHostedCodeForToken(ctx context.Context, app *ent.OAuthApp, code, codeVerifier, redirectURI string) (map[string]any, error) {
	encryptedCode, err := helpers.FixedEncryption(code)
	if err != nil {
		return nil, err
	}
	auth, err := s.repo.FindSelfHostedByCode(ctx, encryptedCode)
	if err != nil {
		return nil, err
	}
	if auth == nil || auth.OauthAppID != app.ID {
		return nil, badRequest(map[string]any{"error": "invalid_grant"})
	}
	if err := verifyCodeGrant(auth.CodeExpiresAt, auth.CodeChallenge, auth.RedirectURI, codeVerifier, redirectURI); err != nil {
		return nil, err
	}

	token := "psh_" + ids.Secure(40)
	encryptedToken, err := helpers.FixedEncryption(token)
	if err != nil {
		return nil, err
	}
	if err := s.repo.ExchangeSelfHostedCodeForToken(ctx, auth.ID, encryptedToken); err != nil {
		return nil, err
	}
	return map[string]any{"access_token": token, "token_type": "bearer", "scope": grantedScope(app)}, nil
}

// GetSelfHostedByAccessToken returns nil when the relay is off or the token
// is unknown or revoked.
func (s *Service) GetSelfHostedByAccessToken(ctx context.Context, token string) (*SelfHostedConnection, error) {
	if !SelfHostedRelayEnabled() {
		return nil, nil
	}
	encrypted, err := helpers.FixedEncryption(token)
	if err != nil {
		return nil, err
	}
	authorization, err := s.repo.FindSelfHostedByAccessToken(ctx, encrypted)
	if err != nil || authorization == nil {
		return nil, err
	}
	apiKey, err := helpers.FixedDecryption(authorization.APIKey)
	if err != nil {
		return nil, err
	}
	return &SelfHostedConnection{ID: authorization.ID, MCPURL: authorization.McpURL, APIKey: apiKey}, nil
}

func (s *Service) DeleteSelfHostedAuthorization(ctx context.Context, id string) (int, error) {
	return s.repo.DeleteSelfHostedAuthorization(ctx, id)
}

// GetOrgByOAuthToken returns nil for an unknown or revoked token.
func (s *Service) GetOrgByOAuthToken(ctx context.Context, token string) (*ent.OAuthAuthorization, error) {
	encrypted, err := helpers.FixedEncryption(token)
	if err != nil {
		return nil, err
	}
	return s.repo.FindByAccessToken(ctx, encrypted)
}

var errInsufficientScope = httpx.HTTPException(map[string]any{
	"error":             "insufficient_scope",
	"error_description": "This OAuth client is not authorized to access email claims",
}, http.StatusForbidden)

var errInvalidToken = httpx.HTTPException(map[string]any{
	"error": "invalid_token", "error_description": "Token is invalid or revoked",
}, http.StatusUnauthorized)

func (s *Service) GetUserInfo(ctx context.Context, authorization string) (*UserInfo, error) {
	if !enableOIDCEmailClaims() {
		return nil, httpx.HTTPException(map[string]any{
			"error": "not_found", "error_description": "OIDC email claims are not enabled",
		}, http.StatusNotFound)
	}

	token := ExtractBearerToken(authorization)
	if token == "" {
		return nil, httpx.HTTPException(map[string]any{
			"error": "invalid_token", "error_description": "Bearer token required",
		}, http.StatusUnauthorized)
	}

	if strings.HasPrefix(token, "psh_") {
		return s.getSelfHostedUserInfo(ctx, token)
	}

	record, err := s.GetOrgByOAuthToken(ctx, token)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errInvalidToken
	}
	if !allowsEmailClaims(record.Edges.OauthApp) {
		return nil, errInsufficientScope
	}
	user := record.Edges.User
	if user == nil {
		return nil, errInvalidToken
	}
	return &UserInfo{Sub: user.ID, Email: &user.Email, EmailVerified: &user.Activated}, nil
}

// A self-hosted connection has no cloud user: the subject is the connection
// and the email is the one typed on the consent screen, which nobody verified
func (s *Service) getSelfHostedUserInfo(ctx context.Context, token string) (*UserInfo, error) {
	var selfHosted *ent.OAuthSelfHostedAuthorization
	if SelfHostedRelayEnabled() {
		encrypted, err := helpers.FixedEncryption(token)
		if err != nil {
			return nil, err
		}
		if selfHosted, err = s.repo.FindSelfHostedUserInfo(ctx, encrypted); err != nil {
			return nil, err
		}
	}
	if selfHosted == nil {
		return nil, errInvalidToken
	}
	if !allowsEmailClaims(selfHosted.Edges.OauthApp) {
		return nil, errInsufficientScope
	}
	info := &UserInfo{Sub: selfHosted.ID}
	if selfHosted.Email != nil && *selfHosted.Email != "" {
		verified := false
		info.Email, info.EmailVerified = selfHosted.Email, &verified
	}
	return info, nil
}

func (s *Service) GetApprovedApps(ctx context.Context, userID string) ([]*ent.OAuthAuthorization, error) {
	return s.repo.GetApprovedApps(ctx, userID)
}

func (s *Service) RevokeApp(ctx context.Context, userID, authID string) (SuccessResponse, error) {
	if _, err := s.repo.RevokeAuthorization(ctx, userID, authID); err != nil {
		return SuccessResponse{}, err
	}
	return SuccessResponse{Success: true}, nil
}
