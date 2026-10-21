// Package channels ports the channel controllers of apps/backend/src/api/routes:
// integrations, no.auth.integrations, third-party, webhooks, autopost, sets
// and signature.
package channels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	integrationsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/integrations"
	plugsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/plugs"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/moltbook"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/telegram"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

// PostsService is the part of posts.Service the channel controllers use.
type PostsService interface {
	DeletePost(ctx context.Context, orgID, group string) (map[string]bool, error)
}

// refreshWait is timer(10000) after a refresh for providers with refreshWait;
// tests shorten it.
var refreshWait = 10 * time.Second

const stateTTL = time.Hour

type integrationsController struct {
	manager      *integrations.Manager
	integrations *integration.Service
	refresh      *integration.RefreshIntegrationService
	posts        PostsService
	store        redis.Store
}

// RegisterIntegrationsController registers IntegrationsController under
// /integrations. Register RegisterNoAuthIntegrationsController first: the
// router mounts NoAuthIntegrationsController before the authenticated controllers.
func RegisterIntegrationsController(r *httpx.Router, authn httpx.Middleware, perms *auth.PermissionsService,
	manager *integrations.Manager, integrationService *integration.Service, posts PostsService, store redis.Store) {
	h := &integrationsController{manager: manager, integrations: integrationService,
		refresh: integrationService.RefreshIntegrationService(), posts: posts, store: store}
	channel := perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionChannel))

	g := r.Group("/integrations", authn)
	g.Post("/provider/:id/connect", h.saveProviderPage, channel)
	g.Get("/:identifier/internal-plugs", h.getInternalPlugs)
	g.Get("/customers", h.getCustomers)
	g.Put("/customers/:id", h.updateCustomerName)
	g.Put("/:id/group", h.updateIntegrationGroup)
	g.Put("/:id/customer-name", h.updateOnCustomerName)
	g.Put("/:id/custom-name", h.updateCustomName)
	g.Get("/list", h.getIntegrationList)
	g.Post("/:id/settings", h.updateProviderSettings)
	g.Post("/:id/nickname", h.setNickname)
	g.Get("/:id", h.getSingleIntegration)
	g.Get("/social/:integration", h.getIntegrationURL, channel)
	g.Post("/:id/time", h.setTime)
	g.Post("/mentions", h.mentions)
	g.Post("/function", h.functionIntegration)
	g.Post("/disable", h.disableChannel)
	g.Post("/enable", h.enableChannel)
	g.Delete("/", h.deleteChannel)
	g.Get("/plug/list", h.getPlugList)
	g.Get("/:id/plugs", h.getPlugsByIntegrationID)
	g.Post("/:id/plugs", h.postPlugsByIntegrationID)
	g.Put("/plugs/:id/activate", h.changePlugActivation)
	g.Get("/telegram/updates", h.getUpdates)
	g.Post("/moltbook/register", h.moltbookRegister)
	g.Get("/moltbook/status", h.moltbookStatus)
}

func (h *integrationsController) saveProviderPage(c *httpx.Ctx) (any, error) {
	body, err := rawBody(c)
	if err != nil {
		return nil, err
	}
	return h.integrations.SaveProviderPage(c.R.Context(), c.Org.ID, c.Param("id"), body)
}

func (h *integrationsController) getInternalPlugs(c *httpx.Ctx) (any, error) {
	return h.manager.GetInternalPlugs(c.Param("identifier")), nil
}

func (h *integrationsController) getCustomers(c *httpx.Ctx) (any, error) {
	return h.integrations.Customers(c.R.Context(), c.Org.ID)
}

func (h *integrationsController) updateCustomerName(c *httpx.Ctx) (any, error) {
	var body integrationsdto.CustomerNameDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.integrations.UpdateCustomerName(c.R.Context(), c.Org.ID, c.Param("id"), body.Name)
}

func (h *integrationsController) updateIntegrationGroup(c *httpx.Ctx) (any, error) {
	var body struct {
		Group string `json:"group"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return h.integrations.UpdateIntegrationGroup(c.R.Context(), c.Org.ID, c.Param("id"), body.Group)
}

func (h *integrationsController) updateOnCustomerName(c *httpx.Ctx) (any, error) {
	var body struct {
		Name string `json:"name"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return h.integrations.UpdateOnCustomerName(c.R.Context(), c.Org.ID, c.Param("id"), body.Name)
}

func (h *integrationsController) updateCustomName(c *httpx.Ctx) (any, error) {
	var body integrationsdto.IntegrationNameDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.integrations.UpdateCustomName(c.R.Context(), c.Org.ID, c.Param("id"), body.Name)
}

type listedIntegration struct {
	Name                 string          `json:"name"`
	OriginalName         string          `json:"originalName"`
	ID                   string          `json:"id"`
	InternalID           string          `json:"internalId"`
	Disabled             bool            `json:"disabled"`
	Editor               string          `json:"editor"`
	StripLinks           bool            `json:"stripLinks"`
	Picture              string          `json:"picture"`
	Identifier           string          `json:"identifier"`
	InBetweenSteps       bool            `json:"inBetweenSteps"`
	RefreshNeeded        bool            `json:"refreshNeeded"`
	IsCustomFields       bool            `json:"isCustomFields"`
	CustomFields         any             `json:"customFields,omitempty"`
	Display              *string         `json:"display"`
	Type                 string          `json:"type"`
	Time                 json.RawMessage `json:"time"`
	ChangeProfilePicture bool            `json:"changeProfilePicture"`
	ChangeNickName       bool            `json:"changeNickName"`
	Customer             *ent.Customer   `json:"customer"`
	AdditionalSettings   string          `json:"additionalSettings"`
}

func (h *integrationsController) getIntegrationList(c *httpx.Ctx) (any, error) {
	list, err := h.integrations.GetIntegrationsList(c.R.Context(), c.Org.ID)
	if err != nil {
		return nil, err
	}
	out := make([]listedIntegration, 0, len(list))
	for _, p := range list {
		provider := h.manager.GetSocialIntegration(p.ProviderIdentifier)
		if provider == nil {
			return nil, fmt.Errorf("unknown provider %s", p.ProviderIdentifier)
		}
		if !json.Valid([]byte(p.PostingTimes)) {
			return nil, fmt.Errorf("invalid postingTimes for integration %s", p.ID)
		}
		item := listedIntegration{
			Name:               orString(p.CustomName, p.Name),
			OriginalName:       p.Name,
			ID:                 p.ID,
			InternalID:         p.InternalID,
			Disabled:           p.Disabled,
			Editor:             provider.Info().Editor,
			Picture:            orString(p.Picture, "/no-picture.jpg"),
			Identifier:         p.ProviderIdentifier,
			InBetweenSteps:     p.InBetweenSteps,
			RefreshNeeded:      p.RefreshNeeded,
			Display:            p.Profile,
			Type:               p.Type,
			Time:               json.RawMessage(p.PostingTimes),
			Customer:           p.Edges.Customer,
			AdditionalSettings: orString(p.AdditionalSettings, "[]"),
		}
		if s, ok := provider.(integrations.LinkStripper); ok {
			item.StripLinks = s.StripLinks()
		}
		if cf, ok := provider.(integrations.CustomFielder); ok {
			item.IsCustomFields = true
			fields := cf.CustomFields()
			if fields == nil {
				fields = []integrations.CustomField{}
			}
			item.CustomFields = fields
		}
		_, item.ChangeProfilePicture = provider.(integrations.ProfilePictureChanger)
		_, item.ChangeNickName = provider.(integrations.NicknameChanger)
		out = append(out, item)
	}
	return map[string]any{"integrations": out}, nil
}

func (h *integrationsController) updateProviderSettings(c *httpx.Ctx) (any, error) {
	var body struct {
		AdditionalSettings any `json:"additionalSettings"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	settings, ok := body.AdditionalSettings.(string)
	if !ok {
		return nil, errors.New("Invalid body")
	}
	_, err := h.integrations.UpdateProviderSettings(c.R.Context(), c.Org.ID, c.Param("id"), settings)
	return nil, err
}

func (h *integrationsController) setNickname(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var body struct {
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	id := c.Param("id")
	in, err := h.integrations.GetIntegrationByID(ctx, c.Org.ID, id)
	if err != nil {
		return nil, err
	}
	if in == nil {
		return nil, errors.New("Invalid integration")
	}

	provider := h.manager.GetSocialIntegration(in.ProviderIdentifier)
	pictureChanger, canPicture := provider.(integrations.ProfilePictureChanger)
	nicknameChanger, canNickname := provider.(integrations.NicknameChanger)
	if !canPicture && !canNickname {
		return nil, errors.New("Invalid integration")
	}

	url := ""
	if canPicture {
		if url, err = pictureChanger.ChangeProfilePicture(ctx, in.InternalID, in.Token, body.Picture); err != nil {
			return nil, err
		}
	}
	name := ""
	if canNickname {
		if name, err = nicknameChanger.ChangeNickname(ctx, in.InternalID, in.Token, body.Name); err != nil {
			return nil, err
		}
	}
	return h.integrations.UpdateNameAndURL(ctx, id, name, url)
}

func (h *integrationsController) getSingleIntegration(c *httpx.Ctx) (any, error) {
	return h.integrations.GetIntegrationForOrder(c.R.Context(), c.Param("id"), c.Query("order"), c.User.ID, c.Org.ID)
}

func (h *integrationsController) getIntegrationURL(c *httpx.Ctx) (any, error) {
	if err := credentialcipher.ValidateKey(); err != nil {
		return nil, err
	}
	ctx := c.R.Context()
	name := c.Param("integration")
	refresh, externalURL := c.Query("refresh"), c.Query("externalUrl")
	if !slices.Contains(h.manager.GetAllowedSocialsIntegrations(), name) {
		return nil, errors.New("Integration not allowed")
	}

	// A provider migrated via MIGRATE_PROVIDERS reconnects through its target
	// provider's OAuth: the callback lands on the target and the channel is
	// migrated in place (see migrateIntegration).
	target := name
	if refresh != "" {
		if migrateTo := h.manager.GetMigrationTarget(name); migrateTo != "" {
			target = migrateTo
		}
	}
	provider := h.manager.GetSocialIntegration(target)
	external, isExternal := provider.(integrations.ExternalURLer)
	if isExternal && externalURL == "" {
		return nil, errors.New("Missing external url")
	}

	url, err := func() (string, error) {
		var client *integrations.ClientInformation
		if isExternal {
			info, err := external.ExternalURL(ctx, externalURL)
			if err != nil {
				return "", err
			}
			client = &integrations.ClientInformation{}
			if info != nil {
				*client = *info
			}
			client.InstanceURL = externalURL
		}

		generated, err := provider.GenerateAuthURL(ctx, client)
		if err != nil {
			return "", err
		}
		state := generated.State

		if refresh != "" {
			if err := h.store.Set(ctx, "refresh:"+state, refresh, stateTTL); err != nil {
				return "", err
			}
		}
		if c.Query("onboarding") == "true" {
			if err := h.store.Set(ctx, "onboarding:"+state, "true", stateTTL); err != nil {
				return "", err
			}
		}
		if redirectURL := c.Query("redirectUrl"); redirectURL != "" {
			if err := h.store.Set(ctx, "redirect:"+state, redirectURL, stateTTL); err != nil {
				return "", err
			}
		}
		if err := h.store.Set(ctx, "organization:"+state, c.Org.ID, stateTTL); err != nil {
			return "", err
		}
		if err := h.store.Set(ctx, "login:"+state, generated.CodeVerifier, stateTTL); err != nil {
			return "", err
		}
		// JSON.stringify(undefined) is stored by ioredis as ""
		external := ""
		if client != nil {
			data, err := json.Marshal(client)
			if err != nil {
				return "", err
			}
			external, err = credentialcipher.Seal(string(data), "oauth-external:"+state)
			if err != nil {
				return "", err
			}
		}
		if err := h.store.Set(ctx, "external:"+state, external, stateTTL); err != nil {
			return "", err
		}
		return generated.URL, nil
	}()
	if err != nil {
		return map[string]bool{"err": true}, nil
	}
	return map[string]string{"url": url}, nil
}

func (h *integrationsController) setTime(c *httpx.Ctx) (any, error) {
	var body integrationsdto.IntegrationTimeDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.integrations.SetTimes(c.R.Context(), c.Org.ID, c.Param("id"), body)
}

// mentionItem reads the fields of a provider mention entry we filter on; the
// entry itself is passed through untouched.
type mentionItem struct {
	ID         any `json:"id"`
	Label      any `json:"label"`
	Image      any `json:"image"`
	DoNotCache any `json:"doNotCache"`
}

type storedMention struct {
	ID    string `json:"id"`
	Image string `json:"image"`
	Label string `json:"label"`
}

func (h *integrationsController) mentions(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var body integrationsdto.IntegrationFunctionDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	in, err := h.integrations.GetIntegrationByID(ctx, c.Org.ID, body.ID)
	if err != nil {
		return nil, err
	}
	if in == nil {
		return nil, errors.New("Invalid integration")
	}

	// newList = (await this.functionIntegration(org, body)) || []
	newList := json.RawMessage("[]")
	result, err := h.function(ctx, c.Org, body)
	if err != nil {
		slog.Error("mentions lookup failed", "error", err)
	} else if truthy(result) {
		if newList, err = json.Marshal(result); err != nil {
			return nil, err
		}
	}

	var items []json.RawMessage
	if err := json.Unmarshal(newList, &items); err != nil {
		var obj map[string]any
		if json.Unmarshal(newList, &obj) == nil && truthy(obj["none"]) {
			return newList, nil
		}
		// [...newList] of a non-array throws in the original app too
		return nil, errors.New("newList is not iterable")
	}

	var data struct {
		Query string `json:"query"`
	}
	_ = json.Unmarshal(body.Data, &data)
	list, err := h.integrations.GetMentions(ctx, in.ProviderIdentifier, data.Query)
	if err != nil {
		return nil, err
	}

	probes := make([]mentionItem, len(items))
	for i, raw := range items {
		_ = json.Unmarshal(raw, &probes[i])
	}

	if len(items) > 0 {
		insert := []integration.Mention{}
		for _, p := range probes {
			m := integration.Mention{Name: jsString(p.Label), Username: jsString(p.ID), Image: jsString(p.Image)}
			if m.Name != "" && !truthy(p.DoNotCache) {
				insert = append(insert, m)
			}
		}
		if len(insert) > 0 {
			if err := h.integrations.InsertMentions(ctx, in.ProviderIdentifier, insert); err != nil {
				return nil, err
			}
		}
	}

	// uniqBy(..., p => p.id).filter(f => f.label && f.id)
	out := []any{}
	seen := map[string]bool{}
	add := func(id, label any, value any) {
		key, _ := json.Marshal(id)
		if seen[string(key)] {
			return
		}
		seen[string(key)] = true
		if truthy(label) && truthy(id) {
			out = append(out, value)
		}
	}
	for _, p := range list {
		add(p.Username, p.Name, storedMention{ID: p.Username, Image: p.Image, Label: p.Name})
	}
	for i, raw := range items {
		add(probes[i].ID, probes[i].Label, raw)
	}
	return out, nil
}

func (h *integrationsController) functionIntegration(c *httpx.Ctx) (any, error) {
	var body integrationsdto.IntegrationFunctionDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.function(c.R.Context(), c.Org, body)
}

// function calls a provider method by name. A Disconnect marks the channel as
// needing a refresh; a RefreshToken refreshes it and calls again.
func (h *integrationsController) function(ctx context.Context, org *ent.Organization, body integrationsdto.IntegrationFunctionDto) (any, error) {
	in, err := h.integrations.GetIntegrationByID(ctx, org.ID, body.ID)
	if err != nil {
		return nil, err
	}
	if in == nil {
		return nil, errors.New("Invalid integration")
	}
	provider := h.manager.GetSocialIntegration(in.ProviderIdentifier)
	if provider == nil {
		return nil, errors.New("Invalid provider")
	}
	fn := providerFunction(provider, body.Name)
	if fn == nil {
		return nil, errors.New("Function not found")
	}

	load, err := fn(ctx, in.Token, body.Data, in.InternalID, in)
	if err == nil {
		return load, nil
	}
	switch temporalx.FailureType(err) {
	case temporalx.TypeDisconnect:
		// The platform will keep rejecting this channel until the user
		// re-connects it: mark it as needing a refresh instead of retrying.
		if err := h.integrations.DisconnectChannel(ctx, org.ID, in, ""); err != nil {
			return nil, err
		}
		return false, nil
	case temporalx.TypeRefreshToken:
		data, err := h.refresh.Refresh(ctx, in, "")
		if err != nil {
			return nil, err
		}
		if data == nil {
			return nil, nil
		}
		if data.AccessToken == "" {
			return false, nil
		}
		if provider.Info().RefreshWait {
			if err := sleep(ctx, refreshWait); err != nil {
				return nil, err
			}
		}
		return h.function(ctx, org, body)
	}
	return false, nil
}

// providerFunction is integrationProvider[name]: the provider's callable
// functions plus SocialAbstract's own mention().
func providerFunction(provider integrations.Provider, name string) integrations.Function {
	if fn := provider.Functions()[name]; fn != nil {
		return fn
	}
	if name != "mention" {
		return nil
	}
	return func(ctx context.Context, token string, data json.RawMessage, id string, in *ent.Integration) (any, error) {
		var d struct {
			Query string `json:"query"`
		}
		_ = json.Unmarshal(data, &d)
		list, none, err := provider.Mention(ctx, token, d.Query, id, in)
		if err != nil {
			return nil, err
		}
		if none {
			return map[string]bool{"none": true}, nil
		}
		if list == nil {
			list = []integrations.MentionResult{}
		}
		return list, nil
	}
}

func (h *integrationsController) disableChannel(c *httpx.Ctx) (any, error) {
	id, err := bodyID(c)
	if err != nil {
		return nil, err
	}
	return nil, h.integrations.DisableChannel(c.R.Context(), c.Org.ID, id)
}

func (h *integrationsController) enableChannel(c *httpx.Ctx) (any, error) {
	id, err := bodyID(c)
	if err != nil {
		return nil, err
	}
	totalChannels := subscriptions.Pricing["FREE"].Channel
	if sub := c.Org.Edges.Subscription; sub != nil && sub.TotalChannels != 0 {
		totalChannels = sub.TotalChannels
	}
	return nil, h.integrations.EnableChannel(c.R.Context(), c.Org.ID, totalChannels, id)
}

func (h *integrationsController) deleteChannel(c *httpx.Ctx) (any, error) {
	id, err := bodyID(c)
	if err != nil {
		return nil, err
	}
	return deleteChannel(c.R.Context(), h.integrations, h.posts, c.Org.ID, id)
}

// deleteChannel deletes the channel's posts in the background, then the channel.
func deleteChannel(ctx context.Context, service *integration.Service, posts PostsService, orgID, id string) (any, error) {
	groups, err := service.GetPostsForChannel(ctx, orgID, id)
	if err != nil {
		return nil, err
	}
	background := context.WithoutCancel(ctx)
	for _, p := range groups {
		go func(group string) { _, _ = posts.DeletePost(background, orgID, group) }(p.Group)
	}
	return service.DeleteChannel(ctx, orgID, id)
}

func (h *integrationsController) getPlugList(*httpx.Ctx) (any, error) {
	return map[string]any{"plugs": h.manager.GetAllPlugs()}, nil
}

func (h *integrationsController) getPlugsByIntegrationID(c *httpx.Ctx) (any, error) {
	return h.integrations.GetPlugsByIntegrationID(c.R.Context(), c.Org.ID, c.Param("id"))
}

func (h *integrationsController) postPlugsByIntegrationID(c *httpx.Ctx) (any, error) {
	var body plugsdto.PlugDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.integrations.CreateOrUpdatePlug(c.R.Context(), c.Org.ID, c.Param("id"), body)
}

func (h *integrationsController) changePlugActivation(c *httpx.Ctx) (any, error) {
	var body struct {
		Status bool `json:"status"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return h.integrations.ChangePlugActivation(c.R.Context(), c.Org.ID, c.Param("id"), body.Status)
}

func (h *integrationsController) getUpdates(c *httpx.Ctx) (any, error) {
	return telegram.New().GetBotID(c.R.Context(), telegram.BotIDQuery{ID: c.Query("id"), Word: c.Query("word")})
}

type moltbookRegistration struct {
	APIKey           string `json:"apiKey,omitempty"`
	ClaimURL         string `json:"claimUrl,omitempty"`
	VerificationCode string `json:"verificationCode,omitempty"`
}

func (h *integrationsController) moltbookRegister(c *httpx.Ctx) (any, error) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	result, err := moltbook.New().RegisterAgent(c.R.Context(), body.Name, body.Description)
	if err != nil {
		message := err.Error()
		if message == "" {
			message = "Registration failed"
		}
		return map[string]string{"error": message}, nil
	}
	return moltbookRegistration{APIKey: result.APIKey, ClaimURL: result.ClaimURL, VerificationCode: result.VerificationCode}, nil
}

func (h *integrationsController) moltbookStatus(c *httpx.Ctx) (any, error) {
	result, err := moltbook.New().CheckAgentStatus(c.R.Context(), c.Query("apiKey"))
	if err != nil {
		return map[string]bool{"claimed": false}, nil
	}
	return map[string]bool{"claimed": result["status"] == "claimed"}, nil
}

// rawBody is an untyped @Body(): the JSON body, {} when empty.
func rawBody(c *httpx.Ctx) (json.RawMessage, error) {
	var body json.RawMessage
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return body, nil
}

// bodyID is @Body('id').
func bodyID(c *httpx.Ctx) (string, error) {
	var body struct {
		ID string `json:"id"`
	}
	err := c.Decode(&body)
	return body.ID, err
}

func orString(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}

func sleep(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

// truthy is JavaScript truthiness of a value decoded from JSON (or a Go
// value a provider function returned).
func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case int:
		return t != 0
	case string:
		return t != ""
	case json.RawMessage:
		var decoded any
		if json.Unmarshal(t, &decoded) != nil {
			return false
		}
		return truthy(decoded)
	}
	return true
}

// jsString is `value || ”` for a decoded JSON value, as stored in a string column.
func jsString(v any) string {
	if !truthy(v) {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	data, _ := json.Marshal(v)
	return string(data)
}
