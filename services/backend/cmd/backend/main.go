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

	"github.com/PlaybookMediaLLC/screenshot-studio/services/backend/internal/httpapi"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/agentclients"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/authstore"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/config"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/githubapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/quota"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
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
	configuration := product.NewConfiguration(db.Client).WithObjectStore(objects).WithAuthStore(authstore.New(db.SQL)).
		WithAgentClients(agentclients.New(db.SQL))
	// Content draft collaboration (RFC 037): only the backend can sign tokens.
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

	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           httpapi.NewWithConfiguration(publishing.NewRepository(db.Client), scheduler, postiz.New(os.Getenv("POSTIZ_API_URL"), &http.Client{Timeout: 20 * time.Second}, nil), cfg.ServiceToken, configuration),
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
