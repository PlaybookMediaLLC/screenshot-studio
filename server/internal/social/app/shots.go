package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/capture"
	platformdb "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/quota"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/chat/mcp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// shotsPlatform is the Shots domain the MCP tools and the agent token
// exchange call (RFC 026): the platform Ent client on the shared database,
// the Redis counters /v1 meters quotas with, the tenant object store, and the
// screenshot API. It is the same service graph services/backend serves /v1 with.
type shotsPlatform struct {
	product *product.Configuration
	counter *quota.RedisCounter
	close   func()
}

func openShotsPlatform(ctx context.Context) (*shotsPlatform, error) {
	db, err := platformdb.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return nil, fmt.Errorf("platform database: %w", err)
	}
	platform := &shotsPlatform{product: product.NewConfiguration(db.Client).
		WithAssetDownloads(shotsPlatformEnv("PUBLISHING_SERVICE_TOKEN"), shotsPlatformEnv("BETTER_AUTH_URL")), close: func() { _ = db.Close() }}
	objects, err := media.NewS3StoreFromEnvironment()
	if err != nil {
		platform.close()
		return nil, fmt.Errorf("media storage: %w", err)
	}
	if objects != nil {
		platform.product.WithObjectStore(objects)
	}
	// REST and MCP must count one quota: PLATFORM_QUOTA_REDIS_URL names the
	// Redis services/backend meters with when it is not this REDIS_URL.
	quotaURL := os.Getenv("PLATFORM_QUOTA_REDIS_URL")
	if quotaURL == "" {
		quotaURL = os.Getenv("REDIS_URL")
	}
	if quotaURL != "" {
		counter, err := quota.NewRedisCounter(quotaURL)
		if err != nil {
			platform.close()
			return nil, fmt.Errorf("quota counter: %w", err)
		}
		meter, err := counter.MonthlyMeter()
		if err != nil {
			_ = counter.Close()
			platform.close()
			return nil, fmt.Errorf("monthly meter: %w", err)
		}
		platform.product.WithQuotaCounter(counter).WithMonthlyMeter(meter)
		platform.counter = counter
		closeDB := platform.close
		platform.close = func() { _ = counter.Close(); closeDB() }
	}
	return platform, nil
}

// The combined process already inherits TENANT_ settings. Use the same grant
// secret and public origin as its product API; standalone processes use the
// ordinary names. Do not introduce a second signer or a separate media secret.
func shotsPlatformEnv(key string) string {
	if value := os.Getenv("TENANT_" + key); value != "" {
		return value
	}
	return os.Getenv(key)
}

func (p *shotsPlatform) mcpServer() (*mcp.Server, error) {
	config := mcp.Config{Product: p.product, Capture: capture.FromEnvironment()}
	if p.counter != nil {
		config.Limiter = p.counter
	}
	return mcp.New(config)
}

// agentCodes answers the token endpoint for a Shots consent code: the
// access token is the agent's workspace API key.
type agentCodes struct{ product *product.Configuration }

func (a agentCodes) ExchangeAgentCode(ctx context.Context, clientID, code, codeVerifier, redirectURI string) (map[string]any, error) {
	token, err := a.product.ExchangeAgentCode(ctx, clientID, code, codeVerifier, redirectURI)
	if errors.Is(err, product.ErrInvalidGrant) {
		return nil, httpx.HTTPException(map[string]any{"error": "invalid_grant"}, http.StatusBadRequest)
	}
	if err != nil {
		return nil, err
	}
	response := map[string]any{"access_token": token.AccessToken, "token_type": "bearer",
		"scope": strings.Join(token.Scopes, " ")}
	if token.ExpiresAt != nil {
		response["expires_in"] = int(time.Until(*token.ExpiresAt).Seconds())
	}
	return response, nil
}
