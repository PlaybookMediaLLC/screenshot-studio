// Package oauth holds Postiz's dtos/oauth.
package oauth

type AuthorizeOAuthQueryDto struct {
	ClientID      string `json:"client_id" query:"client_id" validate:"required"`
	ResponseType  string `json:"response_type" query:"response_type" validate:"required,oneof=code"`
	State         string `json:"state,omitempty" query:"state"`
	RedirectURI   string `json:"redirect_uri,omitempty" query:"redirect_uri"`
	CodeChallenge string `json:"code_challenge,omitempty" query:"code_challenge"`
	// Not validated with IsIn: static clients may send arbitrary values that
	// were always ignored; only dynamic clients get S256 enforced (in the service)
	CodeChallengeMethod string `json:"code_challenge_method,omitempty" query:"code_challenge_method"`
	Scope               string `json:"scope,omitempty" query:"scope"`
	// RFC 8707 resource indicator sent by MCP clients, only used to tell if
	// the connection can be relayed to a self-hosted instance
	Resource string `json:"resource,omitempty" query:"resource"`
}

type ApproveOAuthDto struct {
	ClientID      string `json:"client_id" validate:"required"`
	State         string `json:"state,omitempty"`
	Action        string `json:"action" validate:"required,oneof=approve deny"`
	RedirectURI   string `json:"redirect_uri,omitempty"`
	CodeChallenge string `json:"code_challenge,omitempty"`
	// Not validated with IsIn, same as AuthorizeOAuthQueryDto
	CodeChallengeMethod string `json:"code_challenge_method,omitempty"`
}

type AuthorizeSelfHostedDto struct {
	ClientID            string `json:"client_id" validate:"required"`
	State               string `json:"state,omitempty"`
	RedirectURI         string `json:"redirect_uri,omitempty"`
	CodeChallenge       string `json:"code_challenge,omitempty"`
	CodeChallengeMethod string `json:"code_challenge_method,omitempty"`
	Resource            string `json:"resource,omitempty"`
	// The instance as the person knows it: its address, its backend address or
	// the MCP URL from Settings > Agents (resolved in McpRelayService)
	InstanceURL string `json:"instance_url" validate:"required,max=2048"`
	// Optional because the MCP URL from Settings > Agents carries the key
	APIKey string `json:"api_key,omitempty" validate:"omitempty,max=512"`
	// Required (in the controller) for clients that read the email from
	// userinfo, like ChatGPT
	Email string `json:"email,omitempty" validate:"omitempty,email"`
}

type CreateOAuthAppDto struct {
	Name        string  `json:"name" validate:"required,max=100"`
	Description *string `json:"description,omitempty" validate:"omitempty,max=500"`
	PictureID   *string `json:"pictureId,omitempty"`
	RedirectURL string  `json:"redirectUrl" validate:"required,url"`
}

type UpdateOAuthAppDto struct {
	Name        string  `json:"name,omitempty" validate:"omitempty,max=100"`
	Description *string `json:"description,omitempty" validate:"omitempty,max=500"`
	PictureID   *string `json:"pictureId,omitempty"`
	RedirectURL string  `json:"redirectUrl,omitempty" validate:"omitempty,url"`
}

// RegisterClientDto: redirect_uris are https, http loopback or a private-use
// scheme (cursor://...), validated in OAuthService.RegisterDynamicClient.
type RegisterClientDto struct {
	RedirectURIs            []string `json:"redirect_uris" validate:"required,min=1"`
	ClientName              *string  `json:"client_name,omitempty"`
	ClientURI               string   `json:"client_uri,omitempty"`
	LogoURI                 string   `json:"logo_uri,omitempty"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method,omitempty"`
	GrantTypes              []string `json:"grant_types,omitempty"`
	ResponseTypes           []string `json:"response_types,omitempty"`
	Scope                   string   `json:"scope,omitempty"`
}

type TokenExchangeDto struct {
	GrantType string `json:"grant_type" validate:"required"`
	Code      string `json:"code" validate:"required"`
	// Optional here because client_secret_basic clients send the id and secret
	// in the Authorization header; the controller merges the two sources and
	// the service rejects a request that ends up without a client_id
	ClientID string `json:"client_id,omitempty"`
	// Optional to allow PKCE-only public clients (dynamic registration);
	// the service still enforces it for confidential clients
	ClientSecret string `json:"client_secret,omitempty"`
	CodeVerifier string `json:"code_verifier,omitempty"`
	RedirectURI  string `json:"redirect_uri,omitempty"`
}
