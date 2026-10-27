package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/agentclients"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/authstore"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/config"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/githubapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/httpapi"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/platformai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/quota"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/tenantpublishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialconnect"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalonboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
	"github.com/getsentry/sentry-go"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := config.LoadBackend()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database unavailable", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	temporalClient, err := temporalpublishing.Dial(ctx, temporalpublishing.ConnectionConfig{
		APIKey: cfg.APIKey, Address: cfg.Address, Namespace: cfg.Namespace, TLS: cfg.TLS,
	})
	if err != nil {
		slog.Error("Temporal unavailable", "error", err)
		os.Exit(1)
	}
	defer temporalClient.Close()
	if !cfg.TLS {
		if err := temporalpublishing.RegisterSearchAttributes(ctx, temporalClient, cfg.Namespace); err != nil {
			slog.Error("Temporal search attributes unavailable", "error", err)
			os.Exit(1)
		}
	}
	scheduler := temporalpublishing.NewScheduler(temporalClient, temporalpublishing.SchedulerConfig{
		ActivityTaskQueue: cfg.ActivityTaskQueue, ActivityTimeout: cfg.ActivityTimeout,
		MaxAttempts: cfg.MaxAttempts, Namespace: cfg.Namespace,
		RetryDelay: cfg.RetryDelay, WorkflowTaskQueue: cfg.WorkflowTaskQueue,
	})
	objects, err := media.NewS3StoreFromEnvironment()
	if err != nil {
		slog.Error("media storage unavailable", "error", err)
		os.Exit(1)
	}
	configuration := product.NewConfiguration(db.Client).WithNotifications(notifications.New(db.SQL, db.Client)).WithAuthStore(authstore.New(db.SQL)).
		WithAgentClients(agentclients.New(db.SQL)).WithInvitationEmailVerification(os.Getenv("AUTH_REQUIRE_EMAIL_VERIFICATION") != "false").
		WithAssetDownloads(cfg.ServiceToken, os.Getenv("BETTER_AUTH_URL"))
	if objects != nil {
		configuration.WithObjectStore(objects)
	}
	// Live draft posts' engagement is read through the direct social publisher,
	// which shares this database (RFC 013).
	if publisher, closeShared, err := tenantpublishing.OpenShared(ctx, cfg.DatabaseURL, publishing.NewRepository(db.Client),
		media.NewTenantObjects(objects)); err == nil {
		defer closeShared()
		configuration.WithPostMetrics(publisher).WithAccountStanding(publisher).WithAnalytics(publisher)
	} else {
		slog.Warn("post engagement unavailable", "error", err)
	}
	// Outbound webhooks (RFC 024): the key seals signing secrets.
	webhookKey, err := config.WebhookEncryptionKey()
	if err != nil {
		slog.Error("invalid webhook configuration", "error", err)
		os.Exit(1)
	}
	configuration.WithWebhooks(webhookKey, nil)
	// End-to-end runs publish drafts through the local provider fixture (RFC 025).
	if os.Getenv("PLATFORM_E2E_DRAFT_PLATFORM") == "enabled" {
		product.EnableE2EDraftPlatform()
	}
	// Content draft collaboration (RFC 013): only the backend can sign tokens.
	if key := os.Getenv("COLLAB_TOKEN_SECRET"); key != "" {
		configuration.WithCollabKey([]byte(key))
	}
	github, err := githubapp.FromEnvironment()
	if err != nil {
		slog.Error("invalid GitHub App configuration", "error", err)
		os.Exit(1)
	}
	if github != nil {
		configuration.WithGitHubApp(github)
	}
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		counter, err := quota.NewRedisCounter(redisURL)
		if err != nil {
			slog.Error("invalid quota counter configuration", "error", err)
			os.Exit(1)
		}
		defer counter.Close()
		configuration.WithQuotaCounter(counter)
		meter, err := counter.MonthlyMeter()
		if err != nil {
			slog.Error("monthly quota meter unavailable", "error", err)
			os.Exit(1)
		}
		configuration.WithMonthlyMeter(meter)
	}

	temporalonboarding.InitSentry("publishing-backend")
	defer sentry.Flush(2 * time.Second)
	// Without OPENROUTER_API_KEY the onboarding drafts come from page metadata.
	var model onboarding.Model
	if client := platformai.FromEnvironment(); client != nil {
		model = client
	}
	// SOCIAL_API_URL keeps the HTTP social API (the browser e2e suite mocks it);
	// otherwise channels connect in process.
	var verifier httpapi.DestinationVerifier
	if socialURL := os.Getenv("SOCIAL_API_URL"); socialURL != "" {
		verifier = socialapi.New(socialURL, &http.Client{Timeout: 20 * time.Second}, nil)
	} else {
		connector, closeConnector, err := socialconnect.Open(ctx, cfg.DatabaseURL, db.Client)
		if err != nil {
			slog.Error("social connections unavailable", "error", err)
			os.Exit(1)
		}
		defer closeConnector()
		verifier = connector
	}
	server := &http.Server{
		Addr: fmt.Sprintf(":%d", cfg.Port),
		Handler: httpapi.NewWithOnboarding(publishing.NewRepository(db.Client), scheduler, verifier, cfg.ServiceToken, configuration,
			&onboarding.Service{Background: &temporalonboarding.Client{SeedSurfaces: os.Getenv("PLATFORM_ONBOARDING_SURFACES") == "enabled", Temporal: temporalClient},
				FastPath: &onboarding.FastPath{Fetcher: onboarding.NewFetcher(), Model: model}, Store: configuration}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	slog.Info("publishing backend listening", "port", cfg.Port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("backend stopped", "error", err)
		os.Exit(1)
	}
}
