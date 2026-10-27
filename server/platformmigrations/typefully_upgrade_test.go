package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestTypefullyUpgradePreservesContentAndNotificationOptOut(t *testing.T) {
	uri := os.Getenv("PLATFORM_TYPEFULLY_UPGRADE_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable Typefully upgrade database")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, uri)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err = db.SQL.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || !strings.HasSuffix(name, "_test") {
		t.Fatal("upgrade requires a test database")
	}
	exec := func(q string) {
		t.Helper()
		if _, err := db.SQL.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE "_screenshot_studio_go_migrations" (name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir("sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "20261102090000" {
			break
		}
		if err := applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('tf-upgrade','Upgrade','tf-upgrade',now())`)
	exec(`INSERT INTO content_draft(id,"organizationId",title,body,"plainText","assetIds","channelConnectionIds",version,"reviewStatus","approvedVersion") VALUES('tf-draft','tf-upgrade','Reviewed','[{"type":"p","children":[{"text":"Keep me"}]}]','Keep me','[]','[]',7,'approved',7)`)
	exec(`INSERT INTO platform_notification_policy("organizationId",events,generation) VALUES('tf-upgrade','{"post.published":{"inApp":true,"email":false,"slack":false}}',9)`)
	exec(`INSERT INTO "user"(id,name,email,"updatedAt") VALUES('tf-user','Upgrade','tf-user@example.test',now())`)
	exec(`INSERT INTO user_preference("userId",theme,version) VALUES('tf-user','light',3)`)
	for range 2 {
		if err = Apply(ctx, db.SQL); err != nil {
			t.Fatal(err)
		}
	}
	var kept bool
	if err = db.SQL.QueryRow(`SELECT version=7 AND "approvedVersion"=7 AND "reviewStatus"='approved' AND "plainText"='Keep me' AND "suppressSlackOnPublish"=false FROM content_draft WHERE id='tf-draft'`).Scan(&kept); err != nil || !kept {
		t.Fatal("migration changed reviewed content", err)
	}
	if err = db.SQL.QueryRow(`SELECT generation=9 AND events->'post.published'->>'slack'='false' AND social_set_slack_channels='{}'::jsonb FROM platform_notification_policy WHERE "organizationId"='tf-upgrade'`).Scan(&kept); err != nil || !kept {
		t.Fatal("migration changed explicit notification opt-out", err)
	}
	if err = db.SQL.QueryRow(`SELECT theme='light' AND version=3 AND "accentColor"='' FROM user_preference WHERE "userId"='tf-user'`).Scan(&kept); err != nil || !kept {
		t.Fatal("migration changed personal preferences", err)
	}
	for _, table := range []string{"platform_social_observation", "platform_draft_import"} {
		var count int
		if err = db.SQL.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("migration fabricated observations or receipts", table, count, err)
		}
	}
}
