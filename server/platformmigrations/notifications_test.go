package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	socialmigrations "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/migrations"
)

func TestNotificationUpgradePreservesHistoricalRows(t *testing.T) {
	uri := os.Getenv("PLATFORM_MIGRATION_UPGRADE_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("PLATFORM_MIGRATION_UPGRADE_TEST_DATABASE_URL requires a fresh test database")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, uri)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err = db.SQL.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %s: %v", name, err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE IF NOT EXISTS "_screenshot_studio_go_migrations" (name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir("sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "20261026090000" {
			break
		}
		if err = applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	if err = socialmigrations.Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('upgrade-workspace','Upgrade','upgrade-workspace',now())`)
	exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('upgrade-person','Person','fixture@example.test',true,now(),now())`)
	exec(`INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES('upgrade-member','upgrade-workspace','upgrade-person','owner',now())`)
	exec(`INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey",attempts) VALUES('upgrade-review','upgrade-workspace','campaign_posts.submitted','campaign','old-campaign','{}','upgrade-review',2)`)
	exec(`INSERT INTO integration_connection(id,"organizationId",provider,"externalId","displayName","encryptedCredentials",scopes,"createdAt","updatedAt") VALUES('upgrade-slack','upgrade-workspace','SLACK','T123','Slack','v1.original-ciphertext','[]',now(),now())`)
	exec(`INSERT INTO "Organization"(id,name,"updatedAt") VALUES('upgrade-social','Legacy',now())`)
	exec(`INSERT INTO "User"(id,email,"providerName",timezone,"updatedAt","sendSuccessEmails","lastReadNotifications") VALUES('upgrade-legacy-person','legacy@example.test','LOCAL',0,now(),false,now())`)
	exec(`INSERT INTO "Notifications"(id,"organizationId",content,"createdAt","updatedAt") VALUES('upgrade-notification','upgrade-social','Preserve uncertain read status',now()-interval '1 day',now())`)
	for range 2 {
		if err = Apply(ctx, db.SQL); err != nil {
			t.Fatal(err)
		}
	}
	var version, attempts, inboxes, deliveries int
	var ciphertext, content string
	var successEmail bool
	if err = db.SQL.QueryRow(`SELECT notification_version,attempts FROM outbox_event WHERE id='upgrade-review'`).Scan(&version, &attempts); err != nil || version != 0 || attempts != 2 {
		t.Fatalf("historical review changed: %d %d %v", version, attempts, err)
	}
	if err = db.SQL.QueryRow(`SELECT "encryptedCredentials" FROM integration_connection WHERE id='upgrade-slack'`).Scan(&ciphertext); err != nil || ciphertext != "v1.original-ciphertext" {
		t.Fatalf("legacy credentials changed: %v", err)
	}
	if err = db.SQL.QueryRow(`SELECT content FROM "Notifications" WHERE id='upgrade-notification'`).Scan(&content); err != nil || content != "Preserve uncertain read status" {
		t.Fatalf("legacy inbox removed: %v", err)
	}
	if err = db.SQL.QueryRow(`SELECT "sendSuccessEmails" FROM "User" WHERE id='upgrade-legacy-person'`).Scan(&successEmail); err != nil || successEmail {
		t.Fatalf("legacy preference changed: %v", err)
	}
	if err = db.SQL.QueryRow(`SELECT (SELECT count(*) FROM platform_notification_inbox),(SELECT count(*) FROM platform_notification_delivery)`).Scan(&inboxes, &deliveries); err != nil || inboxes != 0 || deliveries != 0 {
		t.Fatalf("historical fan-out: %d %d %v", inboxes, deliveries, err)
	}
}
