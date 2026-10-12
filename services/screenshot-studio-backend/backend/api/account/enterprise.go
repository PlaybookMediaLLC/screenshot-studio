package account

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

// verifyEnterpriseToken rejects the other JWT kinds signed with the same
// secret: login tokens (full User row), team invites and password resets.
func verifyEnterpriseToken(params string) (map[string]any, error) {
	payload, err := helpers.VerifyJWT(params)
	if err != nil {
		return nil, err
	}
	for _, key := range []string{"providerName", "orgId", "expires"} {
		if _, ok := payload[key]; ok {
			return nil, errors.New("Invalid enterprise token")
		}
	}
	return payload, nil
}

// RegisterEnterpriseController is enterprise.controller.ts (public, /enterprise).
func RegisterEnterpriseController(r *httpx.Router, manager *integrations.Manager, orgs *organizations.Service,
	integrationService *integration.Service, posts PostsService, store redis.Store) {
	g := r.Group("/enterprise")
	failed := map[string]bool{"success": false}

	g.Post("/create-user", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		load, err := verifyEnterpriseToken(str(fields, "params"))
		if err != nil {
			return failed, nil
		}
		id, saasName := str(load, "id"), str(load, "saasName")
		if id == "" || saasName == "" {
			return failed, nil
		}
		created, err := orgs.CreateMaxUser(c.R.Context(), id, str(load, "name"), saasName, str(load, "email"))
		if err != nil {
			return map[string]bool{"create": false}, nil
		}
		return created, nil
	})

	g.Post("/url", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		url, err := enterpriseURL(c.R.Context(), str(fields, "params"), manager, orgs, store)
		if err != nil || url == "" {
			return nil, nil
		}
		return url, nil
	})

	g.Post("/delete-channel", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		load, err := verifyEnterpriseToken(str(fields, "params"))
		if err != nil {
			return failed, nil
		}
		apiKey, id := str(load, "apiKey"), str(load, "id")
		if apiKey == "" || id == "" {
			return failed, nil
		}
		ctx := c.R.Context()
		org, err := orgs.GetOrgByAPIKey(ctx, apiKey)
		if err != nil || org == nil {
			return failed, nil
		}

		groups, err := integrationService.GetPostsForChannel(ctx, org.ID, id)
		if err != nil {
			return failed, nil
		}
		for _, post := range groups {
			// fire and forget, like the unawaited `.catch(() => {})`
			go func(group string) { _, _ = posts.DeletePost(context.WithoutCancel(ctx), org.ID, group) }(post.Group)
		}

		if _, err := integrationService.DeleteChannel(ctx, org.ID, id); err != nil {
			return failed, nil
		}
		return map[string]bool{"success": true}, nil
	})
}

// enterpriseURL starts an OAuth connection on behalf of an enterprise
// customer and returns the provider's auth URL ("" = undefined).
func enterpriseURL(ctx context.Context, params string, manager *integrations.Manager, orgs *organizations.Service, store redis.Store) (string, error) {
	load, err := verifyEnterpriseToken(params)
	if err != nil {
		return "", err
	}
	redirectURL, apiKey, provider := str(load, "redirectUrl"), str(load, "apiKey"), str(load, "provider")
	if redirectURL == "" || apiKey == "" || provider == "" {
		return "", nil
	}

	org, err := orgs.GetOrgByAPIKey(ctx, apiKey)
	if err != nil {
		return "", err
	}
	if org == nil {
		return "", errors.New("Organization not found")
	}
	if !slices.Contains(manager.GetAllowedSocialsIntegrations(), provider) {
		return "", errors.New("Integration not allowed")
	}

	auth, err := manager.GetSocialIntegration(provider).GenerateAuthURL(ctx, nil)
	if err != nil {
		return "", err
	}

	if refreshID := str(load, "refreshId"); refreshID != "" {
		if err := store.Set(ctx, "refresh:"+auth.State, refreshID, time.Hour); err != nil {
			return "", err
		}
	}
	for key, value := range map[string]string{
		"webhookUrl:":   str(load, "webhookUrl"),
		"redirect:":     redirectURL,
		"organization:": org.ID,
		"login:":        auth.CodeVerifier,
	} {
		if err := store.Set(ctx, key+auth.State, value, time.Hour); err != nil {
			return "", err
		}
	}
	return auth.URL, nil
}
