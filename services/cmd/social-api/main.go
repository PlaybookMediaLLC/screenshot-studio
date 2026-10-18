// Command backend is the social backend server: the
// REST API, the public API, the MCP server and the copilot runtime.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/activities"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/api/account"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/api/channels"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/api/content"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/app"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/chat"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/publicapi"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/sentryx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/worker"
)

func main() {
	// process.env.TZ = 'UTC': Prisma's timestamp(3) columns hold UTC wall
	// clocks, and pgx writes time.Time in the local zone.
	time.Local = time.UTC
	if sentryx.Initialize("screenshot-studio-backend") {
		defer sentry.Flush(2 * time.Second)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	a, err := app.New(ctx)
	if err != nil {
		slog.Error("screenshot-studio-backend failed to start", "error", err)
		os.Exit(1)
	}
	defer a.Close()

	// TemporalRegisterMissingSearchAttributesModule and
	// InfiniteWorkflowRegisterModule run on module init, before listen.
	if err := temporalx.RegisterSearchAttributes(ctx, a.Temporal); err != nil {
		slog.Error("screenshot-studio-backend failed to start", "error", err)
		os.Exit(1)
	}
	worker.StartMissingPostWorkflow(ctx, a.Temporal)
	workerErr := make(chan error, 1)
	if strings.EqualFold(os.Getenv("RUN_WORKER"), "true") {
		go func() {
			workerErr <- worker.Run(ctx, worker.Deps{
				Client:  a.Temporal,
				Manager: a.Manager,
				Post: activities.NewPostActivities(a.Posts, a.Notifications, a.Manager, a.Integrations, a.Refresh, a.Webhooks,
					a.Temporal, a.Subscriptions),
				Autopost:     activities.NewAutopostActivities(a.Autopost),
				Email:        activities.NewEmailActivities(a.Email, a.Organizations),
				Integrations: activities.NewIntegrationsActivities(a.Integrations),
				Video:        activities.NewVideoActivities(a.Media, a.Organizations),
				Media:        activities.NewMediaActivities(a.Media),
				Clipping:     activities.NewClippingActivities(a.Clipping, a.ClippingRepo),
			})
			stop()
		}()
	}

	router := newRouter(a)
	loadSwagger(router)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	server := &http.Server{
		Addr: ":" + port,
		// Order: CORS, then MCP, then compression in front of the router.
		Handler:           cors().Wrap(a.MCP.Handler(httpx.Compress(router))),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		slog.Error("screenshot-studio-backend failed to start on port "+port, "error", err)
		os.Exit(1)
	}
	slog.Info("screenshot-studio-backend started successfully on port " + port)
	checkConfiguration() // last, so obvious issues end the startup log
	slog.Info("🚀 screenshot-studio-backend is running on: http://localhost:" + port)

	if err := server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("screenshot-studio-backend stopped", "error", err)
		os.Exit(1)
	}
	select {
	case err := <-workerErr:
		if err != nil {
			slog.Error("screenshot-studio worker stopped", "error", err)
			os.Exit(1)
		}
	default:
	}
}

// cors returns the CORS options of the API.
func cors() httpx.CORS {
	notSecured := os.Getenv("NOT_SECURED") != ""
	exposed := []string{"reload", "onboarding", "activate", "x-copilotkit-runtime-client-gql-version"}
	if notSecured {
		exposed = append(exposed, "auth", "showorg", "impersonate")
	}
	origins := []string{os.Getenv("FRONTEND_URL"), "http://localhost:6274"}
	if v := os.Getenv("MAIN_URL"); v != "" {
		origins = append(origins, v)
	}
	// the Canva app calls the public API from its iframe origin (browsers
	// send it lowercase, e.g. https://app-aabbcc.canva-apps.com)
	if v := os.Getenv("CANVA_APP_ORIGIN"); v != "" {
		origins = append(origins, strings.ToLower(strings.TrimRight(strings.TrimSpace(v), "/")))
	}
	return httpx.CORS{
		Origins:     origins,
		Credentials: !notSecured,
		AllowedHeaders: []string{"Content-Type", "Authorization", "auth", "showorg", "impersonate", "x-postiz-org",
			"x-postiz-include-deleted", "x-copilotkit-runtime-client-gql-version"},
		ExposedHeaders: exposed,
	}
}

// newRouter registers the controllers in a fixed order: the API
// controllers, then the public API controllers. Routes match in
// registration order, so the order is part of the API.
func newRouter(a *app.App) *httpx.Router {
	r := httpx.NewRouter()
	if os.Getenv("MCP_ONLY") != "" {
		account.RegisterRootController(r)
		content.RegisterOAuthController(r, a.OAuth)
		content.RegisterMediaWidgetController(r, a.Media, a.Uploader())
		content.RegisterClippingWidgetController(r, a.Clipping)
		return r
	}

	account.RegisterRootController(r)
	account.RegisterPaymentController(r, a.Payments)
	account.RegisterStripeController(r, a.Payments)
	account.RegisterAuthController(r, a.Auth, a.Email, a.Redis)
	content.RegisterPublicController(r, a.Track, a.AgentInsertService(), a.Posts, a.Subscriptions, a.Redis)
	account.RegisterMonitorController(r)
	account.RegisterEnterpriseController(r, a.Manager, a.Organizations, a.Integrations, a.Posts, a.Redis)
	channels.RegisterNoAuthIntegrationsController(r, a.Manager, a.Integrations, a.Organizations, a.Redis)
	content.RegisterOAuthController(r, a.OAuth)
	content.RegisterMediaWidgetController(r, a.Media, a.Uploader())
	content.RegisterClippingWidgetController(r, a.Clipping)

	// authenticatedController, behind AuthMiddleware
	mw := auth.AuthMiddleware(a.AuthOrgs, a.Users)
	perms := a.Permissions
	account.RegisterUsersController(r, mw, perms, a.Payments, a.Auth, a.Organizations, a.Users, a.Track)
	account.RegisterAnalyticsController(r, mw, a.Integrations, a.Posts)
	channels.RegisterIntegrationsController(r, mw, perms, a.Manager, a.Integrations, a.Posts, a.Redis)
	account.RegisterSettingsController(r, mw, perms, a.Organizations)
	content.RegisterPostsController(r, mw, perms, a.Posts, a.AgentGraphStream(), a.ShortLink)
	content.RegisterMediaController(r, mw, a.Media, a.Subscriptions, a.Uploader())
	content.RegisterClippingController(r, mw, a.Clipping)
	account.RegisterBillingController(r, mw, perms, a.Subscriptions, a.Notifications, a.Users, a.Payments)
	account.RegisterNotificationsController(r, mw, a.Notifications)
	content.RegisterCopilotController(r, mw, perms, a.Subscriptions, a.Agent, a.AgentMemory())
	channels.RegisterWebhooksController(r, mw, perms, a.Webhooks)
	channels.RegisterSignatureController(r, mw, a.Signatures)
	channels.RegisterAutopostController(r, mw, perms, a.Autopost)
	channels.RegisterSetsController(r, mw, a.Sets)
	channels.RegisterThirdPartyController(r, mw, a.ThirdParty, a.Media, a.Storage)
	content.RegisterOAuthAppController(r, mw, perms, a.OAuth)
	content.RegisterApprovedAppsController(r, mw, a.OAuth)
	content.RegisterOAuthAuthorizedController(r, mw, a.OAuth)
	account.RegisterAnnouncementsController(r, mw, a.Announcements)
	account.RegisterAdminController(r, mw, a.Errors, a.AdminStats)

	// PublicApiModule (PublicAuthMiddleware, then the global throttler guard)
	publicapi.RegisterPublicIntegrationsController(r, publicapi.Deps{
		Orgs: a.AuthOrgs, OAuth: a.OAuth, Store: a.Redis, Perms: perms,
		Integrations: a.Integrations, Posts: a.Posts, Media: a.Media, Storage: a.Storage,
		Notifications: a.Notifications, Manager: a.Manager, Users: a.Users, AdminStats: a.AdminStats,
		Organizations: a.Organizations, Clipping: a.Clipping, Subscriptions: a.Subscriptions,
		ValidationSchema: chat.ValidationSchema,
	})
	return r
}

// checkConfiguration reports configuration problems at startup.
func checkConfiguration() {
	checker := &helpers.ConfigurationChecker{}
	checker.ReadEnvFromProcess()
	checker.Check()
	if !checker.HasIssues() {
		slog.Info("Configuration check completed without any issues")
		return
	}
	for _, issue := range checker.GetIssues() {
		slog.Warn(issue, "context", "Configuration issue")
	}
	slog.Warn("Configuration issues found: " + strconv.Itoa(checker.GetIssuesCount()))
}
