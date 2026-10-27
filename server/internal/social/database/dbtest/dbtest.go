// Package dbtest gives tests a migrated, empty social database. Set
// SOCIAL_TEST_DATABASE_URL to a disposable server database (its name must
// contain "test"); tests skip when it is unset.
package dbtest

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/migrations"
	"github.com/lucsky/cuid"
)

func init() {
	// Set once before test workers start; rewriting time.Local during gRPC polling races.
	time.Local = time.UTC
}

// Open creates a fresh database for the test, applies the social migrations,
// and drops it when the test ends.
func Open(t *testing.T) *ent.Client {
	t.Helper()
	base := os.Getenv("SOCIAL_TEST_DATABASE_URL")
	if base == "" {
		t.Skip("SOCIAL_TEST_DATABASE_URL is not set")
	}
	if !strings.Contains(base, "test") {
		t.Fatal("SOCIAL_TEST_DATABASE_URL must name a disposable test database")
	}
	if os.Getenv("PLATFORM_SOCIAL_ENCRYPTION_KEY") == "" {
		t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	name := "social_test_" + strings.ToLower(cuid.New())
	if _, err := admin.SQL.ExecContext(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	url := replaceDatabase(base, name)
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrations.Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, _ = admin.SQL.ExecContext(context.Background(), fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", name))
		admin.Close()
	})
	return db.Client
}

func replaceDatabase(url, name string) string {
	query := ""
	if i := strings.Index(url, "?"); i >= 0 {
		url, query = url[:i], url[i:]
	}
	return url[:strings.LastIndex(url, "/")+1] + name + query
}
