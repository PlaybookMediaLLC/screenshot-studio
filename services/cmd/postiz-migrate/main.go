// Command postiz-migrate applies the Postiz schema before the API and workers start.
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/migrations"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	db, err := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("Postiz database unavailable", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := migrations.Apply(ctx, db.SQL); err != nil {
		slog.Error("Postiz migration failed", "error", err)
		os.Exit(1)
	}
	slog.Info("Postiz migrations applied")
}
