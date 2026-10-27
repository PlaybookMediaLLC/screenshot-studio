package migrations

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database"
	"github.com/lucsky/cuid"
)

func TestVerifiedIdentityMigrationUpgradeAndReplay(t *testing.T) {
	base := os.Getenv("SOCIAL_TEST_DATABASE_URL")
	if base == "" {
		t.Skip("requires a disposable social test database")
	}
	u, err := url.Parse(base)
	if err != nil || !strings.Contains(u.Path, "test") {
		t.Fatal("requires a disposable test database")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "social_verification_test_" + strings.ToLower(cuid.New())
	if _, err := admin.SQL.ExecContext(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.SQL.ExecContext(ctx, "DROP DATABASE "+name+" WITH (FORCE)") }()
	u.Path = "/" + name
	db, err := database.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	const migration = "0003_verified_provider_capabilities.sql"
	exec(`CREATE TABLE "_social_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= migration {
			break
		}
		script, err := files.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		exec(string(script))
		exec(`INSERT INTO "_social_migrations"(name) VALUES($1)`, entry.Name())
	}
	exec(`INSERT INTO "Organization"(id,name,"updatedAt") VALUES('legacy-org','Legacy',now())`)
	exec(`INSERT INTO "Integration"(id,"organizationId","internalId",name,"providerIdentifier",type,token,"additionalSettings") VALUES('legacy','legacy-org','123','Legacy','mastodon','social','legacy-token','[{"title":"maxCharacters","value":"9999"}]')`)
	// DDL is transactional: an interrupted upgrade cannot leave partial proof columns.
	tx, err := db.SQL.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	script, err := files.ReadFile(migration)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, string(script)); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.SQL.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_name='Integration' AND column_name='verifiedAccountKey'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("rollback left partial schema")
	}
	for range 2 {
		if err := Apply(ctx, db.SQL); err != nil {
			t.Fatal(err)
		}
	}
	var preserved bool
	if err := db.SQL.QueryRowContext(ctx, `SELECT "internalId"='123' AND token='legacy-token' AND "additionalSettings" LIKE '%9999%' AND "verifiedAccountKey" IS NULL AND "verifiedAccountKind" IS NULL AND "verifiedScopes" IS NULL AND "verifiedCapabilities" IS NULL AND "identityVerifiedAt" IS NULL FROM "Integration" WHERE id='legacy'`).Scan(&preserved); err != nil || !preserved {
		t.Fatal("upgrade changed the existing account or invented provider verification")
	}
	if _, err := db.SQL.ExecContext(ctx, `UPDATE "Integration" SET "verifiedAccountKey"='mastodon:example.social:123' WHERE id='legacy'`); err == nil {
		t.Fatal("database accepted a partial verified identity")
	}
	if err := db.SQL.QueryRowContext(ctx, `SELECT count(*) FROM "_social_migrations" WHERE name=$1`, migration).Scan(&count); err != nil || count != 1 {
		t.Fatal("migration replay was not idempotent")
	}
}
