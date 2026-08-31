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
	"github.com/PlaybookMediaLLC/screenshot-studio/services/orchestrator/internal/worker"
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
	repository := publishing.NewRepository(db.Client)
	httpClient := &http.Client{Timeout: cfg.ProviderTimeout}
	assetReader := storage.New(cfg.StorageAPIURL, cfg.StorageBucket, cfg.StorageKey, httpClient)
	provider := postiz.New(cfg.PostizAPIURL, httpClient, assetReader)
	publisher := worker.New(repository, provider, worker.Config{
		BatchSize: cfg.BatchSize, MaxAttempts: cfg.MaxAttempts, PollInterval: cfg.PollInterval,
		RetryDelay: cfg.RetryDelay, StaleAfter: cfg.StaleAfter,
	})

	health := healthHandler(repository)
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
	if err := publisher.Run(ctx); err != nil {
		slog.Error("orchestrator stopped", "error", err)
		os.Exit(1)
	}
}

type healthStore interface{ Ping(context.Context) error }

func healthHandler(store healthStore) http.Handler {
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
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
