package platformmigrations

import (
	"context"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

// Migrations apply in file-name order, and a database first migrated by
// Prisma is adopted by matching these names against _prisma_migrations, so
// every file must keep the timestamped "<14 digits>_<name>.sql" form.
func TestEmbeddedMigrationsAreTimestampOrdered(t *testing.T) {
	entries, err := files.ReadDir("sql")
	if err != nil || len(entries) == 0 {
		t.Fatalf("embedded migrations=%d err=%v", len(entries), err)
	}
	pattern := regexp.MustCompile(`^\d{14}_[a-z0-9_]+\.sql$`)
	previous := ""
	for _, entry := range entries {
		if !pattern.MatchString(entry.Name()) || entry.Name() <= previous {
			t.Fatalf("migration %q is misnamed or out of order after %q", entry.Name(), previous)
		}
		previous = entry.Name()
	}
}

func TestApplyFreshDatabaseAndIsIdempotent(t *testing.T) {
	url := os.Getenv("PLATFORM_MIGRATION_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PLATFORM_MIGRATION_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatalf("repeat migration failed: %v", err)
	}
	var applied int
	if err := db.SQL.QueryRowContext(ctx, `SELECT COUNT(*) FROM "_screenshot_studio_go_migrations"`).Scan(&applied); err != nil || applied != 24 {
		t.Fatalf("applied migrations=%d err=%v", applied, err)
	}
}
