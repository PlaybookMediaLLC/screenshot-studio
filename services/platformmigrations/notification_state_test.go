package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestNotificationStateUpgradePreservesReceipts(t *testing.T) {
	uri := os.Getenv("PLATFORM_NOTIFICATION_STATE_UPGRADE_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable notification upgrade database")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, uri)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err = db.SQL.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatal("upgrade requires a test database")
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.SQL.Exec(sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE "_screenshot_studio_go_migrations" (name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir("sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "20261031090000_notification_receipt_state.sql" {
			break
		}
		if err := applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('state-org','State upgrade','state-org',now())`)
	exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('state-user','Member','state@example.test',true,now(),now())`)
	for _, kind := range []string{"comment.created", "post.published"} {
		exec(`INSERT INTO platform_notification_inbox(id,"organizationId","userId",event_id,kind,resource_type,resource_id,description,href) VALUES($1,'state-org','state-user',$1,$1,'legacy_activity',$1,'Original description','')`, kind)
	}
	exec(`INSERT INTO platform_notification_seen_action(id,"organizationId","userId",request_key,deleted_count) VALUES('old-read','state-org','state-user','previous-stable-request',4)`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ kind, category string }{{"comment.created", "inbox"}, {"post.published", "activity"}} {
		var category, description string
		var unread, unarchived bool
		err := db.SQL.QueryRow(`SELECT category,description,read_at IS NULL,archived_at IS NULL FROM platform_notification_inbox WHERE id=$1`, tc.kind).Scan(&category, &description, &unread, &unarchived)
		if err != nil || category != tc.category || description != "Original description" || !unread || !unarchived {
			t.Fatalf("upgrade changed receipt: %s %s %v %v %v", category, description, unread, unarchived, err)
		}
	}
	exec(`UPDATE platform_notification_inbox SET read_at=now(),archived_at=now() WHERE id='comment.created'`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.SQL.QueryRow(`SELECT count(*) FROM platform_notification_inbox WHERE read_at IS NOT NULL AND archived_at IS NOT NULL`).Scan(&count); err != nil || count != 1 {
		t.Fatal("migration replay reset recipient state", err)
	}
	var fingerprint string
	if err := db.SQL.QueryRow(`SELECT deleted_count,request_fingerprint FROM platform_notification_seen_action WHERE id='old-read'`).Scan(&count, &fingerprint); err != nil || count != 4 || fingerprint != "" {
		t.Fatal("historical acknowledgment receipt changed", err)
	}
}
