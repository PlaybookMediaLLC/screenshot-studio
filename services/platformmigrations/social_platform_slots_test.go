package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialplatform"
)

func TestSocialPlatformSlotsUpgrade(t *testing.T) {
	uri := os.Getenv("PLATFORM_SOCIAL_SLOT_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable platform-slot upgrade database")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, uri)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err := db.SQL.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatal("requires test database")
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	const migration = "20261031120000_social_platform_slots.sql"
	exec(`CREATE TABLE "_screenshot_studio_go_migrations" (name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir("sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= migration {
			break
		}
		if err := applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('slot-org','Slots','slot-org',now())`)
	exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('slot-user','Slots','slots@example.test',true,now(),now())`)
	exec(`INSERT INTO social_set(id,"organizationId",name,"publicSlug","defaultPlatforms","primaryPlatform") VALUES('slot-set','slot-org','Slots','slot-public','["mastodon-custom","mastodon","twitter","x","linkedin-page"]','mastodon-custom')`)
	for _, platform := range []string{"mastodon", "mastodon-custom"} {
		exec(`INSERT INTO channel_connection(id,"organizationId",provider,platform,"externalAccountId","secretReference","createdByUserId","updatedAt","socialSetId") VALUES($1,'slot-org','social',$1,$1,'FIXTURE','slot-user',now(),'slot-set')`, platform)
	}
	if err := Apply(ctx, db.SQL); err == nil || !strings.Contains(err.Error(), "Multiple active accounts") {
		t.Fatalf("ambiguous slots accepted: %v", err)
	}
	var rolledBack bool
	if err := db.SQL.QueryRow(`SELECT to_regprocedure('platform_social_channel_v1(text)') IS NULL AND NOT EXISTS(SELECT 1 FROM "_screenshot_studio_go_migrations" WHERE name=$1)`, migration).Scan(&rolledBack); err != nil || !rolledBack {
		t.Fatal("failed upgrade left partial schema")
	}
	var count, version int
	if err := db.SQL.QueryRow(`SELECT count(*) FROM channel_connection WHERE status='ACTIVE'`).Scan(&count); err != nil || count != 2 {
		t.Fatal("upgrade removed an account")
	}
	// Explicit operator resolution preserves the disabled account and its identity.
	exec(`UPDATE channel_connection SET status='DISABLED' WHERE id='mastodon'`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	var defaults, primary string
	if err := db.SQL.QueryRow(`SELECT "defaultPlatforms"::text,"primaryPlatform",version FROM social_set WHERE id='slot-set'`).Scan(&defaults, &primary, &version); err != nil || defaults != `["mastodon", "x", "linkedin"]` || primary != "mastodon" || version != 2 {
		t.Fatalf("defaults=%s primary=%s version=%d err=%v", defaults, primary, version, err)
	}
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	if err := db.SQL.QueryRow(`SELECT version FROM social_set WHERE id='slot-set'`).Scan(&version); err != nil || version != 2 {
		t.Fatal("migration replay changed defaults")
	}
	// The database catches races and legacy writers, not only the application check.
	if _, err := db.SQL.Exec(`UPDATE channel_connection SET status='ACTIVE' WHERE id='mastodon'`); err == nil {
		t.Fatal("alias bypassed unique slot")
	}
	exec(`UPDATE channel_connection SET status='DISABLED' WHERE id='mastodon-custom'`)
	exec(`UPDATE channel_connection SET status='ACTIVE' WHERE id='mastodon'`)
	if err := db.SQL.QueryRow(`SELECT count(*) FROM channel_connection`).Scan(&count); err != nil || count != 2 {
		t.Fatal("history was removed")
	}
	for _, provider := range []string{"x", "twitter", "linkedin-page", "instagram-standalone", "mastodon-custom", "mastodoncustom", "threads"} {
		var canonical string
		if err := db.SQL.QueryRow(`SELECT platform_social_channel_v1($1)`, provider).Scan(&canonical); err != nil || canonical != socialplatform.Canonical(provider) {
			t.Fatalf("database/application mapping diverged: %s %s %v", provider, canonical, err)
		}
	}
}
