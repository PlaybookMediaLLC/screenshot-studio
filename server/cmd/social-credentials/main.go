// Command social-credentials encrypts or rotates the existing provider credentials.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/credentialbackfill"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := credentialcipher.ValidateKey(); err != nil {
		slog.Error("Social credential encryption key is unavailable")
		os.Exit(1)
	}
	db, err := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("Social database unavailable")
		os.Exit(1)
	}
	defer db.Close()
	updated, err := credentialbackfill.Run(ctx, db.Client)
	if err != nil {
		slog.Error("Social credential backfill failed", "updated", updated, "error", err)
		os.Exit(1)
	}
	slog.Info("Social credentials encrypted", "updated", updated)
}
