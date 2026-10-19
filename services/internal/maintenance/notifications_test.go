package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
)

func TestNotificationsRunByDefault(t *testing.T) {
	db, err := sql.Open("pgx", "postgres://localhost/unused")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := &Store{Activity: &notifications.Service{DB: db}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	for _, legacyPaused := range []string{"", "true", "false"} {
		t.Run("legacyPaused="+legacyPaused, func(t *testing.T) {
			t.Setenv("PLATFORM_ACTIVITY_LEGACY_PAUSED", legacyPaused)
			_, err := store.Notifications(ctx)
			if legacyPaused == "false" {
				if err != nil {
					t.Fatalf("dispatcher ran alongside legacy senders: %v", err)
				}
			} else if !errors.Is(err, context.Canceled) {
				t.Fatalf("dispatcher did not reach database with cancelled context: %v", err)
			}
		})
	}
}
