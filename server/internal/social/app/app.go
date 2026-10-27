// Package app builds the service graph once from the environment: the
// database, API providers, chat, agent, video, third-party, and Temporal
// modules. The backend and the orchestrator binaries share it.
package app

import (
	"context"
	"fmt"
	platformnotifications "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
	"log/slog"
	"os"

	"go.temporal.io/sdk/client"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/agent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/chat"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/chat/mcp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/adminstats"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/agencies"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/announcements"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/autopost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/errorsdb"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/oauth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/sets"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/signatures"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/thirdparty"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/users"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/deepgram"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/email"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/migrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/openai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/payment"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/shortlink"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/thirdparties"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/track"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/upload"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/videos"
)

// App is every service of the original app's backend and orchestrator. Fields typed
// by a consumer interface hold the adapter that consumer needs.
type App struct {
	DB       *database.Database
	Redis    redis.Store
	Temporal client.Client
	Storage  upload.Provider
	Manager  *integrations.Manager

	Email      *email.Service
	ShortLink  *shortlink.Service
	Track      *track.Service
	OpenAI     *openai.Service
	Fal        *openai.FalService
	Extract    *openai.ExtractContentService
	Deepgram   *deepgram.Service
	Videos     *videos.Manager
	ThirdParty *thirdparties.Manager

	OrganizationsRepo *organizations.Repository
	Organizations     *organizations.Service
	Users             *users.Service
	Notifications     *notifications.Service
	Subscriptions     *subscriptions.Service
	Agencies          *agencies.Service
	Announcements     *announcements.Service
	AdminStats        *adminstats.Service
	ThirdParties      *thirdparty.Service
	Sets              *sets.Service
	Signatures        *signatures.Service
	Webhooks          *webhooks.Service
	Errors            *errorsdb.Service
	AutopostRepo      *autopost.Repository
	Autopost          *autopost.Service
	OAuth             *oauth.Service
	IntegrationRepo   *integration.Repository
	Integrations      *integration.Service
	Refresh           *integration.RefreshIntegrationService
	Media             *media.Service
	ClippingRepo      *clipping.Repository
	Clipping          *clipping.Service
	Posts             *posts.Service

	Payments       *payment.Service
	PaymentManager *payment.ProviderManager
	Codes          *payment.CodesService

	// AuthOrgs is organizations.Service as the auth package sees it.
	AuthOrgs      auth.OrganizationService
	AuthProviders *auth.AuthProviderManager
	Auth          *auth.AuthService
	Permissions   *auth.PermissionsService

	Tools  []*chat.Tool
	Memory *chat.Memory
	Agent  *chat.Agent
	MCP    *mcp.Server
	// shots is the platform domain behind the MCP tools.
	shots       *shotsPlatform
	AgentGraph  *agent.GraphService
	AgentInsert *agent.InsertService
}

// New connects to Postgres, Redis and Temporal and wires every service.
// Migrations only run with SOCIAL_MIGRATE=true: the original app migrates with
// Prisma, so by default the Go services use the schema as they find it.
func New(ctx context.Context) (*App, error) {
	if err := credentialcipher.ValidateKey(); err != nil {
		return nil, err
	}
	a := &App{}
	var err error
	if a.DB, err = database.Open(ctx, os.Getenv("DATABASE_URL")); err != nil {
		return nil, err
	}
	if os.Getenv("SOCIAL_MIGRATE") == "true" {
		if err := migrations.Apply(ctx, a.DB.SQL); err != nil {
			a.Close()
			return nil, fmt.Errorf("migrate: %w", err)
		}
		slog.Info("database migrations applied")
	}
	if a.Redis, err = redis.New(); err != nil {
		a.Close()
		return nil, fmt.Errorf("redis: %w", err)
	}
	if a.Temporal, err = temporalx.Dial(ctx); err != nil {
		a.Close()
		return nil, fmt.Errorf("temporal: %w", err)
	}
	if a.Storage, err = upload.CreateStorage(); err != nil {
		a.Close()
		return nil, err
	}
	if a.shots, err = openShotsPlatform(ctx); err != nil {
		a.Close()
		return nil, err
	}
	a.wire()
	if a.MCP, err = a.shots.mcpServer(); err != nil {
		a.Close()
		return nil, err
	}
	return a, nil
}

func (a *App) wire() {
	db := a.DB.Client
	a.Manager = social.NewManager(platformnotifications.New(a.DB.SQL, nil))

	a.Email = email.NewService(a.Temporal)
	a.ShortLink = shortlink.NewService()
	a.Track = track.NewService()
	a.OpenAI = openai.NewService()
	a.Fal = openai.NewFalService()
	a.Extract = openai.NewExtractContentService()
	a.Deepgram = deepgram.NewService()
	a.Videos = videos.NewManager(a.OpenAI, a.Fal)

	a.OrganizationsRepo = organizations.NewRepository(db)
	a.Notifications = notifications.NewService(notifications.NewRepository(db), notificationEmail{a.Email}, a.OrganizationsRepo, a.Temporal)
	a.Organizations = organizations.NewService(a.OrganizationsRepo, a.Notifications)

	a.AutopostRepo = autopost.NewRepository(db)
	a.IntegrationRepo = integration.NewRepository(db, a.Storage)
	a.Integrations = integration.NewService(a.IntegrationRepo, a.AutopostRepo, a.Manager, integrationNotifications{a.Notifications},
		a.Temporal, a.Redis, a.Storage)
	a.Refresh = a.Integrations.RefreshIntegrationService()

	a.Users = users.NewService(users.NewRepository(db), a.OrganizationsRepo, a.IntegrationRepo, a.Notifications)
	a.Subscriptions = subscriptions.NewService(subscriptions.NewRepository(db), a.Integrations, a.Organizations)
	a.Agencies = agencies.NewService(agencies.NewRepository(db), a.Notifications)
	a.Announcements = announcements.NewService(announcements.NewRepository(db))
	a.AdminStats = adminstats.NewService(adminstats.NewRepository(db))
	a.ThirdParties = thirdparty.NewService(thirdparty.NewRepository(db))
	a.Sets = sets.NewService(sets.NewRepository(db))
	a.Signatures = signatures.NewService(signatures.NewRepository(db))
	a.Webhooks = webhooks.NewService(webhooks.NewRepository(db))
	a.Errors = errorsdb.NewService(errorsdb.NewRepository(db))
	a.OAuth = oauth.NewService(oauth.NewRepository(db)).WithAgentCodes(agentCodes{a.shots.product})
	a.ThirdParty = thirdparties.NewManager(thirdPartyService{a.ThirdParties}, a.OpenAI)

	a.Media = media.NewService(media.NewRepository(db), a.OpenAI, mediaSubscriptions{a.Subscriptions}, videoManager{a.Videos},
		a.Temporal, a.Redis, newMediaStorage(a.Storage), newProcessor(upload.CreateProcessor()))
	a.Posts = posts.NewService(posts.NewRepository(db), a.Manager, postsIntegrations{a.Integrations}, a.Media,
		postsShortLink{a.ShortLink}, postsOpenAI{a.OpenAI}, a.Temporal, a.Refresh, a.Storage, a.Redis)
	a.Autopost = autopost.NewService(a.AutopostRepo, a.Temporal, a.Integrations, autopostPosts{a.Posts})
	a.ClippingRepo = clipping.NewRepository(db)
	a.Clipping = clipping.NewService(a.ClippingRepo, clippingSubscriptions{a.Subscriptions}, a.Organizations, a.Integrations,
		clippingPosts{a.Posts}, a.Media, clippingOpenAI{a.OpenAI}, clippingDeepgram{a.Deepgram}, a.Temporal, a.Redis, a.Storage,
		newProcessor(upload.CreateIngestProcessor()), newProcessor(upload.CreateClipProcessor()))

	// Payments: PaymentProviderManager gets stripe first, then revenuecat
	// (the @PaymentProvider module order).
	paymentSubs := paymentSubscriptions{a.Subscriptions}
	paymentOrgs := paymentOrganizations{a.Organizations, a.OrganizationsRepo}
	a.PaymentManager = payment.NewProviderManager()
	a.PaymentManager.Register(payment.StripeProviderName, payment.NewStripeService(paymentSubs, paymentOrgs, a.Users, paymentTrack{a.Track}))
	a.PaymentManager.Register(payment.RevenueCatProviderName, payment.NewRevenueCatProvider(paymentSubs, paymentOrgs))
	a.Payments = payment.NewService(a.PaymentManager, paymentSubs)
	a.Codes = payment.NewCodesService()

	a.AuthOrgs = authOrganizations{a.Organizations}
	a.AuthProviders = auth.NewAuthProviderManager(a.Redis)
	a.Auth = auth.NewAuthService(a.Users, a.AuthOrgs, authEmail{a.Email}, a.AuthProviders, authNewsletter{})
	a.Permissions = auth.NewPermissionsService(a.Subscriptions, a.Posts, a.Integrations, a.Webhooks)

	a.Tools = chat.NewTools(chat.Services{
		Integrations:        chatIntegrations{a.Integrations},
		RefreshIntegrations: chatRefresh{a.Refresh},
		IntegrationManager:  a.Manager,
		Posts:               chatPosts{a.Posts},
		Media:               chatMedia{a.Media},
		Subscriptions:       chatSubscriptions{a.Subscriptions},
		Clipping:            chatClipping{a.Clipping},
		Videos:              chatVideos{a.Videos},
		Storage:             a.Storage,
		ClippingEnabled:     upload.ClippingEnabled,
	})
	a.Memory = chat.NewMemory(db)
	a.Agent = chat.NewAgent(a.Tools, a.Memory)

	a.AgentGraph = agent.NewGraphService(agentPosts{a.Posts}, agentMedia{a.Media}, a.Storage)
	a.AgentInsert = agent.NewInsertService(agentPosts{a.Posts})
}

// Close releases the connections.
func (a *App) Close() {
	if a.Temporal != nil {
		a.Temporal.Close()
	}
	if a.DB != nil {
		_ = a.DB.Close()
	}
	if a.shots != nil {
		a.shots.close()
	}
}
