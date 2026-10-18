package content

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/oauth"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/oauth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// bindBody is the global body parsing for the OAuth endpoints: Express
// parses urlencoded bodies next to JSON, and OAuth clients post their token
// requests as forms.
func bindBody(c *httpx.Ctx, v any) error {
	if !strings.HasPrefix(strings.ToLower(c.Header("Content-Type")), "application/x-www-form-urlencoded") {
		return c.Bind(v)
	}
	data, err := c.RawBody()
	if err != nil {
		return err
	}
	values, err := url.ParseQuery(string(data))
	if err != nil {
		return httpx.BadRequest(err.Error())
	}
	fields := map[string]any{}
	for k, vs := range values {
		if len(vs) == 1 {
			fields[k] = vs[0]
		} else {
			fields[k] = vs
		}
	}
	encoded, _ := json.Marshal(fields)
	if err := json.Unmarshal(encoded, v); err != nil {
		return httpx.BadRequest(err.Error())
	}
	return httpx.Validate(v)
}

// extractBasicCredentials is chat/oauth-types extractBasicCredentials, RFC
// 6749 §2.3.1 client_secret_basic: "Basic base64(urlencode(id):urlencode(secret))".
func extractBasicCredentials(authHeader string) (clientID, clientSecret string, ok bool) {
	const prefix = "basic "
	if len(authHeader) <= len(prefix) || strings.ToLower(authHeader[:len(prefix)]) != prefix {
		return "", "", false
	}
	encoded := strings.TrimSpace(authHeader[len(prefix):])
	// Buffer.from(..., 'base64') accepts padded, unpadded and url-safe input
	var decoded []byte
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		var err error
		if decoded, err = enc.DecodeString(encoded); err == nil {
			break
		}
	}
	separator := strings.IndexByte(string(decoded), ':')
	if separator <= 0 {
		return "", "", false
	}
	id, err := url.PathUnescape(string(decoded[:separator]))
	if err != nil {
		return "", "", false
	}
	secret, err := url.PathUnescape(string(decoded[separator+1:]))
	if err != nil {
		return "", "", false
	}
	return id, secret, true
}

// pkce is the `app.dynamic ? {...} : undefined` options of the authorization
// code.
func pkce(app *ent.OAuthApp, challenge, method, redirectURI string) oauth.PKCEOptions {
	if !app.Dynamic {
		return oauth.PKCEOptions{}
	}
	return oauth.PKCEOptions{CodeChallenge: challenge, CodeChallengeMethod: method, RedirectURI: redirectURI}
}

// redirectWith is `new URL(target)` with the given search params set.
func redirectWith(target string, params ...string) (any, error) {
	u, err := jsURL(target)
	if err != nil {
		return nil, err
	}
	for i := 0; i+1 < len(params); i += 2 {
		if params[i+1] != "" {
			setSearchParam(u, params[i], params[i+1])
		}
	}
	return map[string]string{"redirect": u.String()}, nil
}

type oauthController struct {
	oauth *oauth.Service
}

// RegisterOAuthController registers the public OAuthController (/oauth).
func RegisterOAuthController(r *httpx.Router, oauthService *oauth.Service) {
	h := &oauthController{oauth: oauthService}
	g := r.Group("/oauth")
	// Dynamic Client Registration (RFC 7591), used by MCP clients like Claude
	g.Post("/register", h.register, httpx.Status(http.StatusCreated))
	g.Get("/authorize", h.authorize)
	// RFC 6749 §5.1: successful token responses are 200; strict clients (Canva) reject a 201
	g.Post("/token", h.token, httpx.Status(http.StatusOK))
	g.Get("/userinfo", h.userinfo)
	g.Post("/userinfo", h.userinfo)
}

func (h *oauthController) register(c *httpx.Ctx) (any, error) {
	var body dto.RegisterClientDto
	if err := bindBody(c, &body); err != nil {
		return nil, err
	}
	return nullable(h.oauth.RegisterDynamicClient(c.R.Context(), body))
}

type authorizeApp struct {
	Name        string     `json:"name"`
	Description *string    `json:"description"`
	Picture     *ent.Media `json:"picture"`
	ClientID    string     `json:"clientId"`
	RedirectURL string     `json:"redirectUrl"`
}

type authorizeResponse struct {
	App   authorizeApp `json:"app"`
	State *string      `json:"state,omitempty"`
}

func (h *oauthController) authorize(c *httpx.Ctx) (any, error) {
	var query dto.AuthorizeOAuthQueryDto
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	app, err := h.oauth.ValidateAuthorizationRequest(c.R.Context(), query.ClientID, oauth.PKCEOptions{
		RedirectURI:         query.RedirectURI,
		CodeChallenge:       query.CodeChallenge,
		CodeChallengeMethod: query.CodeChallengeMethod,
	})
	if err != nil {
		return nil, err
	}

	var state *string
	if c.R.URL.Query().Has("state") {
		state = &query.State
	}
	return authorizeResponse{
		App: authorizeApp{
			Name:        app.Name,
			Description: app.Description,
			Picture:     app.Edges.Picture,
			ClientID:    app.ClientID,
			RedirectURL: app.RedirectURL,
		},
		State: state,
	}, nil
}

func (h *oauthController) token(c *httpx.Ctx) (any, error) {
	var body dto.TokenExchangeDto
	if err := bindBody(c, &body); err != nil {
		return nil, err
	}
	if body.GrantType != "authorization_code" {
		return nil, httpx.HTTPException(map[string]any{"error": "unsupported_grant_type"}, http.StatusBadRequest)
	}

	// client_secret_basic puts the credentials in the Authorization header,
	// client_secret_post and public clients put them in the body
	basicID, basicSecret, _ := extractBasicCredentials(c.Header("Authorization"))
	clientID := basicID
	if clientID == "" {
		clientID = body.ClientID
	}
	if clientID == "" {
		return nil, httpx.HTTPException(map[string]any{"error": "invalid_client"}, http.StatusUnauthorized)
	}
	clientSecret := basicSecret
	if clientSecret == "" {
		clientSecret = body.ClientSecret
	}
	return h.oauth.ExchangeCodeForToken(c.R.Context(), body.Code, clientID, clientSecret, body.CodeVerifier, body.RedirectURI)
}

func (h *oauthController) userinfo(c *httpx.Ctx) (any, error) {
	return nullable(h.oauth.GetUserInfo(c.R.Context(), c.Header("Authorization")))
}

// RegisterOAuthAuthorizedController registers OAuthAuthorizedController
// (POST /oauth/authorize) behind the auth middleware.
func RegisterOAuthAuthorizedController(r *httpx.Router, authMiddleware httpx.Middleware, oauthService *oauth.Service) {
	g := r.Group("/oauth", authMiddleware)
	g.Post("/authorize", func(c *httpx.Ctx) (any, error) {
		ctx := c.R.Context()
		var body dto.ApproveOAuthDto
		if err := bindBody(c, &body); err != nil {
			return nil, err
		}
		app, err := oauthService.ValidateAuthorizationRequest(ctx, body.ClientID, oauth.PKCEOptions{
			RedirectURI:         body.RedirectURI,
			CodeChallenge:       body.CodeChallenge,
			CodeChallengeMethod: body.CodeChallengeMethod,
		})
		if err != nil {
			return nil, err
		}

		// Dynamic clients redirect to their validated redirect_uri,
		// static apps keep using the one stored on the app
		redirectTarget := app.RedirectURL
		if app.Dynamic {
			redirectTarget = body.RedirectURI
		}

		if body.Action == "deny" {
			return redirectWith(redirectTarget, "error", "access_denied", "state", body.State)
		}

		code, err := oauthService.CreateAuthorizationCode(ctx, app.ID, c.User.ID, c.Org.ID,
			pkce(app, body.CodeChallenge, body.CodeChallengeMethod, body.RedirectURI))
		if err != nil {
			return nil, err
		}
		return redirectWith(redirectTarget, "code", code, "state", body.State)
	})
}

// RegisterOAuthAppController registers OAuthAppController (/user/oauth-app)
// behind the auth middleware.
func RegisterOAuthAppController(r *httpx.Router, authMiddleware httpx.Middleware, perms *auth.PermissionsService, oauthService *oauth.Service) {
	admin := perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionAdmin))
	g := r.Group("/user/oauth-app", authMiddleware)
	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return nullable(oauthService.GetApp(c.R.Context(), c.Org.ID))
	}, admin)
	g.Post("/", func(c *httpx.Ctx) (any, error) {
		var body dto.CreateOAuthAppDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return nullable(oauthService.CreateApp(c.R.Context(), c.Org.ID, body))
	}, admin)
	g.Put("/", func(c *httpx.Ctx) (any, error) {
		var body dto.UpdateOAuthAppDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return nullable(oauthService.UpdateApp(c.R.Context(), c.Org.ID, body))
	}, admin)
	g.Delete("/", func(c *httpx.Ctx) (any, error) {
		return oauthService.DeleteApp(c.R.Context(), c.Org.ID)
	}, admin)
	g.Post("/rotate-secret", func(c *httpx.Ctx) (any, error) {
		return oauthService.RotateSecret(c.R.Context(), c.Org.ID)
	}, admin)
}

// RegisterApprovedAppsController registers ApprovedAppsController
// (/user/approved-apps) behind the auth middleware.
func RegisterApprovedAppsController(r *httpx.Router, authMiddleware httpx.Middleware, oauthService *oauth.Service) {
	g := r.Group("/user/approved-apps", authMiddleware)
	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return oauthService.GetApprovedApps(c.R.Context(), c.User.ID)
	})
	g.Delete("/:id", func(c *httpx.Ctx) (any, error) {
		return oauthService.RevokeApp(c.R.Context(), c.User.ID, c.Param("id"))
	})
}
