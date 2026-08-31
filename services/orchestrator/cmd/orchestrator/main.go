package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/config"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/storage"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := config.LoadOrchestrator()
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
	repository := publishing.NewRepository(db.Client)
	httpClient := &http.Client{Timeout: cfg.ProviderTimeout}
	assetReader := storage.New(cfg.StorageAPIURL, cfg.StorageBucket, cfg.StorageKey, httpClient)
	provider := postiz.New(cfg.PostizAPIURL, httpClient, assetReader)
	activities := temporalpublishing.NewActivities(repository, provider)
	workflowWorker := worker.New(temporalClient, cfg.WorkflowTaskQueue, worker.Options{
		OnFatalError: func(err error) { slog.Error("Temporal workflow worker failed", "error", err); stop() },
	})
	workflowWorker.RegisterWorkflowWithOptions(temporalpublishing.PostWorkflowV1, workflow.RegisterOptions{Name: temporalpublishing.WorkflowNameV1})
	activityWorker := worker.New(temporalClient, cfg.ActivityTaskQueue, worker.Options{
		DisableWorkflowWorker: true, MaxConcurrentActivityExecutionSize: cfg.ActivityConcurrency,
		OnFatalError: func(err error) { slog.Error("Temporal activity worker failed", "error", err); stop() },
	})
	activityWorker.RegisterActivityWithOptions(activities.Prepare, activity.RegisterOptions{Name: temporalpublishing.PrepareActivityName})
	activityWorker.RegisterActivityWithOptions(activities.Publish, activity.RegisterOptions{Name: temporalpublishing.PublishActivityName})
	activityWorker.RegisterActivityWithOptions(activities.MarkUnknown, activity.RegisterOptions{Name: temporalpublishing.MarkUnknownActivityName})

	health := healthHandler(repository, temporalClient)
	server := &http.Server{Addr: fmt.Sprintf(":%d", cfg.Port), Handler: health, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		slog.Info("publishing orchestrator health server listening", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("orchestrator health server stopped", "error", err)
			stop()
		}
	}()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	if err := activityWorker.Start(); err != nil {
		slog.Error("Temporal activity worker did not start", "error", err)
		os.Exit(1)
	}
	if err := workflowWorker.Start(); err != nil {
		activityWorker.Stop()
		slog.Error("Temporal workflow worker did not start", "error", err)
		os.Exit(1)
	}
	<-ctx.Done()
	workflowWorker.Stop()
	activityWorker.Stop()
}

type healthStore interface{ Ping(context.Context) error }
type temporalHealth interface {
	CheckHealth(context.Context, *client.CheckHealthRequest) (*client.CheckHealthResponse, error)
}

func healthHandler(store healthStore, temporal temporalHealth) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "publishing-orchestrator"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := store.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is unavailable"})
			return
		}
		if _, err := temporal.CheckHealth(ctx, nil); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Temporal is unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
