package channels

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	integrationsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

type noAuthIntegrationsController struct {
	manager       *integrations.Manager
	integrations  *integration.Service
	refresh       *integration.RefreshIntegrationService
	organizations *organizations.Service
	store         redis.Store
}

// RegisterNoAuthIntegrationsController registers NoAuthIntegrationsController
// under /integrations (no auth middleware).
func RegisterNoAuthIntegrationsController(r *httpx.Router, manager *integrations.Manager,
	integrationService *integration.Service, organizationService *organizations.Service, store redis.Store) {
	h := &noAuthIntegrationsController{manager: manager, integrations: integrationService,
		refresh: integrationService.RefreshIntegrationService(), organizations: organizationService, store: store}

	g := r.Group("/integrations")
	g.Get("/", h.getIntegrations)
	// @CheckPolicies([Create, CHANNEL]) is not attached: the PoliciesGuard
	// skips every /integrations/social-connect path.
	g.Post("/social-connect/:integration", notEnoughScopesFilter(h.connectSocialMedia))
	g.Post("/public/provider/:id/connect", h.saveProviderPage)
	g.Post("/extension-refresh", h.extensionRefreshCookies)
}

// notEnoughScopesFilter is @UseFilters(new NotEnoughScopesFilter()).
func notEnoughScopesFilter(next httpx.Handler) httpx.Handler {
	return func(c *httpx.Ctx) (any, error) {
		body, err := next(c)
		var scopes *integrations.NotEnoughScopes
		if errors.As(err, &scopes) {
			return nil, httpx.NewError(http.StatusConflict, map[string]string{"msg": scopes.Message})
		}
		return body, err
	}
}

func (h *noAuthIntegrationsController) getIntegrations(*httpx.Ctx) (any, error) {
	return h.manager.GetAllIntegrations(), nil
}

// get is ioRedis.get: "" for a missing key.
func (h *noAuthIntegrationsController) get(ctx context.Context, key string) (string, error) {
	value, _, err := h.store.Get(ctx, key)
	return value, err
}

// take reads a key and deletes it when it was set.
func (h *noAuthIntegrationsController) take(ctx context.Context, key string) (string, error) {
	value, err := h.get(ctx, key)
	if err != nil || value == "" {
		return value, err
	}
	return value, h.store.Del(ctx, key)
}

func authError(message string) integrations.AuthTokenDetails {
	return integrations.AuthTokenDetails{Error: message, AdditionalSettings: []integrations.AdditionalSetting{}}
}

type connectExtras struct {
	Onboarding     bool   `json:"onboarding"`
	Pages          any    `json:"pages"`
	ReturnURL      string `json:"returnURL,omitempty"`
	ExtensionToken string `json:"extensionToken,omitempty"`
}

func (h *noAuthIntegrationsController) connectSocialMedia(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	name := c.Param("integration")
	var body integrationsdto.ConnectIntegrationDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	if !slices.Contains(h.manager.GetAllowedSocialsIntegrations(), name) {
		return nil, errors.New("Integration not allowed")
	}
	if err := credentialcipher.ValidateKey(); err != nil {
		return nil, err
	}

	provider := h.manager.GetSocialIntegration(name)
	_, hasCustomFields := provider.(integrations.CustomFielder)
	_, isExternal := provider.(integrations.ExternalURLer)
	info := provider.Info()

	codeVerifier := "none"
	if !hasCustomFields {
		var err error
		if codeVerifier, err = h.get(ctx, "login:"+body.State); err != nil {
			return nil, err
		}
	}
	if codeVerifier == "" {
		// The state expires after an hour and is deleted once used (page reload)
		return nil, httpx.HTTPException("This connection link expired or was already used, please connect the channel again", http.StatusBadRequest)
	}

	organization, err := h.get(ctx, "organization:"+body.State)
	if err != nil {
		return nil, err
	}
	if organization == "" {
		return nil, errors.New("Organization not found")
	}
	org, err := h.organizations.GetOrgByID(ctx, organization)
	if err != nil {
		return nil, err
	}
	if org == nil {
		return nil, errors.New("Organization not found")
	}

	if !hasCustomFields {
		if err := h.store.Del(ctx, "login:"+body.State); err != nil {
			return nil, err
		}
	}

	details := ""
	if isExternal {
		if details, err = h.take(ctx, "external:"+body.State); err != nil {
			return nil, err
		}
		if details, err = credentialcipher.Open(details, "oauth-external:"+body.State); err != nil {
			return nil, err
		}
	}
	refresh, err := h.take(ctx, "refresh:"+body.State)
	if err != nil {
		return nil, err
	}
	onboarding, err := h.take(ctx, "onboarding:"+body.State)
	if err != nil {
		return nil, err
	}

	auth := h.authenticate(ctx, name, provider, body, codeVerifier, details, refresh)
	if auth.Error != "" {
		return nil, &integrations.NotEnoughScopes{Message: auth.Error}
	}
	if auth.ID == "" {
		return nil, &integrations.NotEnoughScopes{Message: "Invalid API key"}
	}

	validName := auth.Name
	if validName == "" {
		if auth.Username != "" {
			validName = strings.Split(auth.Username, ".")[0]
		} else {
			validName = "Channel_" + jsSlice(auth.ID, 8)
		}
	}

	if os.Getenv("STRIPE_PUBLISHABLE_KEY") != "" && org.IsTrailing {
		previous, err := h.integrations.CheckPreviousConnections(ctx, org.ID, auth.ID)
		if err != nil {
			return nil, err
		}
		if previous {
			return nil, httpx.HTTPException("", http.StatusPreconditionFailed)
		}
	}

	migrationAuth := integrations.AuthTokenDetails{ID: auth.ID, Username: auth.Username}
	if refresh != "" && auth.ID != refresh {
		// A reconnect that returns a different id is either the wrong account or
		// a channel migrating to another provider (MIGRATE_PROVIDERS) - the two
		// apps return different app-scoped ids, so the channel is matched by
		// profile and moved in place. Throws for anything else. Runs after every
		// check that can reject the connect, so a rejection can never leave a
		// half-migrated channel behind.
		if _, err := h.integrations.MigrateIntegration(ctx, org.ID, refresh, name, migrationAuth); err != nil {
			return nil, err
		}
	} else if refresh == "" {
		// A fresh connect of a migration target for an account the org already
		// has on the source provider adopts that channel instead of creating a
		// duplicate. No-op for everything else.
		if _, err := h.integrations.MigrateIntegrationOnConnect(ctx, org.ID, name, migrationAuth); err != nil {
			return nil, err
		}
	}

	customInstanceDetails := ""
	switch {
	case details != "":
		customInstanceDetails, err = credentialcipher.Seal(details, "custom-instance")
	case hasCustomFields, info.IsChromeExtension:
		customInstanceDetails, err = credentialcipher.Seal(string(nodeBase64(body.Code)), "custom-instance")
	}
	if err != nil {
		return nil, err
	}

	timezone, _ := strconv.ParseFloat(strings.TrimSpace(body.Timezone), 64)
	params := integration.CreateOrUpdateIntegrationParams{
		AdditionalSettings:    auth.AdditionalSettings,
		OneTimeToken:          info.OneTimeToken,
		Org:                   org.ID,
		Name:                  strings.TrimSpace(validName),
		Picture:               auth.Picture,
		Type:                  "social",
		InternalID:            auth.ID,
		Provider:              name,
		Token:                 auth.AccessToken,
		RefreshToken:          auth.RefreshToken,
		Username:              &auth.Username,
		IsBetweenSteps:        refresh == "" && info.IsBetweenSteps,
		Refresh:               body.Refresh,
		Timezone:              int(timezone),
		CustomInstanceDetails: customInstanceDetails,
	}
	if auth.ExpiresIn != 0 {
		params.ExpiresIn = &auth.ExpiresIn
	}
	createUpdate, err := h.integrations.CreateOrUpdateIntegration(ctx, params)
	if err != nil {
		return nil, err
	}

	go func(ctx context.Context) {
		if _, err := h.refresh.StartRefreshWorkflow(ctx, org.ID, createUpdate.ID, provider); err != nil {
			slog.Error("startRefreshWorkflow failed", "error", err)
		}
	}(context.WithoutCancel(ctx))

	// Fetch pages if this is a two-step provider and not a refresh
	var pages any = []any{}
	if info.IsBetweenSteps && refresh == "" {
		// Check which method the provider uses (pages or companies)
		fetch := provider.Functions()["pages"]
		if fetch == nil {
			fetch = provider.Functions()["companies"]
		}
		if fetch != nil {
			if loaded, err := fetch(ctx, auth.AccessToken, nil, "", nil); err != nil {
				slog.Error("Failed to fetch pages:", "error", err)
			} else if loaded != nil {
				pages = loaded
			}
		}
	}

	webhookURL, err := h.get(ctx, "webhookUrl:"+body.State)
	if err != nil {
		return nil, err
	}
	if webhookURL != "" {
		h.notifyWebhook(ctx, webhookURL, org.APIKey)
		if err := h.store.Del(ctx, "webhookUrl:"+body.State); err != nil {
			return nil, err
		}
	}

	returnURL, err := h.take(ctx, "redirect:"+body.State)
	if err != nil {
		return nil, err
	}

	extensionToken := ""
	if info.IsChromeExtension {
		if extensionToken, err = helpers.SignJWT(map[string]any{
			"integrationId":  createUpdate.ID,
			"organizationId": org.ID,
			"internalId":     auth.ID,
			"provider":       name,
		}); err != nil {
			return nil, err
		}
	}

	// Never leak stored credentials (signed/encrypted secrets) back to the
	// caller. These columns hold the integration access token, refresh token
	// and encrypted custom instance details and must stay server-side (the
	// ent row never serializes the tokens).
	safe := *createUpdate
	safe.CustomInstanceDetails = nil
	data, err := json.Marshal(&safe)
	if err != nil {
		return nil, err
	}
	data = bytes.Replace(data, []byte(`,"customInstanceDetails":null`), nil, 1)
	extras, err := json.Marshal(connectExtras{Onboarding: onboarding == "true", Pages: pages, ReturnURL: returnURL, ExtensionToken: extensionToken})
	if err != nil {
		return nil, err
	}
	return json.RawMessage(append(append(data[:len(data)-1], ','), extras[1:]...)), nil
}

// authenticate resolves the provider's tokens, folding every failure into
// AuthTokenDetails.Error like the Promise in the original app does.
func (h *noAuthIntegrationsController) authenticate(ctx context.Context, name string, provider integrations.Provider,
	body integrationsdto.ConnectIntegrationDto, codeVerifier, details, refresh string) integrations.AuthTokenDetails {
	var client *integrations.ClientInformation
	if details != "" {
		if err := json.Unmarshal([]byte(details), &client); err != nil {
			slog.Error("Authentication failed for "+name+":", "error", err)
			return authError("Authentication failed")
		}
	}

	auth, err := provider.Authenticate(ctx, integrations.AuthenticateParams{Code: body.Code, CodeVerifier: codeVerifier, Refresh: body.Refresh}, client)
	if err != nil {
		var message integrations.AuthMessage
		if errors.As(err, &message) {
			return authError(string(message))
		}
		var scopes *integrations.NotEnoughScopes
		if errors.As(err, &scopes) {
			return authError(scopes.Message)
		}
		slog.Error("Authentication failed for "+name+":", "error", err)
		return authError("Authentication failed")
	}
	if auth == nil {
		return authError("Authentication failed")
	}

	if reconnector, ok := provider.(integrations.Reconnector); ok && refresh != "" {
		slog.Info("reconnect")
		newAuth, err := reconnector.ReConnect(ctx, auth.ID, refresh, auth.AccessToken)
		if err != nil {
			return authError(temporalx.FailureMessage(err))
		}
		// keep the fresh refresh token and expiration from the new
		// authentication, otherwise the stored refresh token is wiped and
		// the channel breaks again as soon as the access token expires
		merged := integrations.AuthTokenDetails{}
		if newAuth != nil {
			merged = *newAuth
		}
		merged.RefreshToken = auth.RefreshToken
		merged.ExpiresIn = auth.ExpiresIn
		return merged
	}
	return *auth
}

func (h *noAuthIntegrationsController) notifyWebhook(ctx context.Context, webhookURL string, apiKey *string) {
	params, err := helpers.SignJWT(map[string]any{"apiKey": apiKey})
	if err != nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{"params": params})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if res, err := ssrf.Client().Do(req); err == nil {
		_ = res.Body.Close()
	}
}

func (h *noAuthIntegrationsController) saveProviderPage(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	body, err := rawBody(c)
	if err != nil {
		return nil, err
	}
	var state struct {
		State any `json:"state"`
	}
	_ = json.Unmarshal(body, &state)
	if !truthy(state.State) {
		return nil, errors.New("Invalid state")
	}
	organization, err := h.get(ctx, "organization:"+jsString(state.State))
	if err != nil {
		return nil, err
	}
	if organization == "" {
		return nil, errors.New("Organization not found")
	}
	org, err := h.organizations.GetOrgByID(ctx, organization)
	if err != nil {
		return nil, err
	}
	if org == nil {
		return nil, errors.New("Organization not found")
	}
	return h.integrations.SaveProviderPage(ctx, org.ID, c.Param("id"), body)
}

func (h *noAuthIntegrationsController) extensionRefreshCookies(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var body struct {
		JWT     string `json:"jwt"`
		Cookies string `json:"cookies"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}

	payload, err := helpers.VerifyJWT(body.JWT)
	if err != nil {
		return nil, httpx.HTTPException("Invalid token", http.StatusUnauthorized)
	}
	integrationID, _ := payload["integrationId"].(string)
	organizationID, _ := payload["organizationId"].(string)
	internalID, _ := payload["internalId"].(string)
	providerName, _ := payload["provider"].(string)
	if integrationID == "" || organizationID == "" || internalID == "" || providerName == "" {
		return nil, httpx.HTTPException("Invalid token payload", http.StatusBadRequest)
	}

	in, err := h.integrations.GetIntegrationByID(ctx, organizationID, integrationID)
	if err != nil {
		return nil, err
	}
	if in == nil || in.InternalID != internalID {
		return nil, httpx.HTTPException("Integration not found", http.StatusNotFound)
	}

	provider := h.manager.GetSocialIntegration(providerName)
	if provider == nil || !provider.Info().IsChromeExtension {
		return nil, httpx.HTTPException("Not a Chrome extension integration", http.StatusBadRequest)
	}

	authResult, err := provider.Authenticate(ctx, integrations.AuthenticateParams{Code: body.Cookies}, nil)
	if err != nil {
		var message integrations.AuthMessage
		if errors.As(err, &message) {
			return nil, httpx.HTTPException(string(message), http.StatusBadRequest)
		}
		return nil, err
	}

	if authResult.ID != in.InternalID {
		if _, err := h.integrations.RefreshNeeded(ctx, organizationID, integrationID); err != nil {
			return nil, err
		}
		return map[string]any{"success": false, "reason": "account_mismatch"}, nil
	}

	var cookies map[string]any
	if err := json.Unmarshal(nodeBase64(body.Cookies), &cookies); err != nil {
		return nil, err
	}
	signed, err := helpers.SignJWT(cookies)
	if err != nil {
		return nil, err
	}
	params := integration.CreateOrUpdateIntegrationParams{
		Org:                   organizationID,
		Name:                  in.Name,
		Type:                  "social",
		InternalID:            in.InternalID,
		Provider:              in.ProviderIdentifier,
		Token:                 authResult.AccessToken,
		CustomInstanceDetails: signed,
	}
	if authResult.ExpiresIn != 0 {
		params.ExpiresIn = &authResult.ExpiresIn
	}
	if _, err := h.integrations.CreateOrUpdateIntegration(ctx, params); err != nil {
		return nil, err
	}
	return map[string]bool{"success": true}, nil
}

// nodeBase64 is Buffer.from(value, 'base64'): standard or URL-safe alphabet,
// padding optional, other characters ignored.
func nodeBase64(value string) []byte {
	clean := strings.Map(func(r rune) rune {
		switch {
		case r == '-':
			return '+'
		case r == '_':
			return '/'
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '+', r == '/':
			return r
		}
		return -1
	}, strings.SplitN(value, "=", 2)[0])
	// a dangling 6-bit group carries no full byte; Node drops it
	if len(clean)%4 == 1 {
		clean = clean[:len(clean)-1]
	}
	data, _ := base64.RawStdEncoding.DecodeString(clean)
	return data
}

// jsSlice is String(value).slice(0, n).
func jsSlice(value string, n int) string {
	runes := []rune(value)
	if len(runes) > n {
		runes = runes[:n]
	}
	return string(runes)
}
