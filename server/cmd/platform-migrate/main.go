// Command platform-migrate applies the Screenshot Studio product schema.
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/platformmigrations"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	db, err := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("platform database unavailable", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := platformmigrations.Apply(ctx, db.SQL); err != nil {
		slog.Error("platform migration failed", "error", err)
		os.Exit(1)
	}
	slog.Info("platform migrations applied")
}
