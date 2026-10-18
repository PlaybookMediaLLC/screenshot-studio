// Package app builds the service graph once from the environment: the
// database, API providers, chat, agent, video, third-party, and Temporal
// modules. The backend and the orchestrator binaries share it.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"go.temporal.io/sdk/client"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/agent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/chat/mcp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/adminstats"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/agencies"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/announcements"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/autopost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/errorsdb"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/oauth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/sets"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/signatures"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/thirdparty"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/users"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/deepgram"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/email"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations/social"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/openai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/payment"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/shortlink"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/thirdparties"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/track"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/upload"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/videos"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/migrations"
)

// App is every service of the Postiz backend and orchestrator. Fields typed
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

	Tools       []*chat.Tool
	Memory      *chat.Memory
	Agent       *chat.Agent
	Relay       *mcp.RelayService
	MCP         *mcp.Server
	AgentGraph  *agent.GraphService
	AgentInsert *agent.InsertService
}

// New connects to Postgres, Redis and Temporal and wires every service.
// Migrations only run with POSTIZ_GO_MIGRATE=true: Postiz migrates with
// Prisma, so by default the Go services use the schema as they find it.
func New(ctx context.Context) (*App, error) {
	a := &App{}
	var err error
	if a.DB, err = database.Open(ctx, os.Getenv("DATABASE_URL")); err != nil {
		return nil, err
	}
	if os.Getenv("POSTIZ_GO_MIGRATE") == "true" {
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
	a.wire()
	return a, nil
}

func (a *App) wire() {
	db := a.DB.Client
	a.Manager = social.NewManager()

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
	a.OAuth = oauth.NewService(oauth.NewRepository(db))
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
	a.Relay = mcp.NewRelayService(selfHostedOAuth{a.OAuth}, a.Tools)
	var relay *mcp.RelayService
	if oauth.SelfHostedRelayEnabled() {
		relay = a.Relay
	}
	a.MCP = mcp.New(a.Agent, a.Tools, a.Organizations, mcpOAuth{a.OAuth}, relay)

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
}
