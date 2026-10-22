package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestNotificationSourceUpgradePreservesHistoricalState(t *testing.T) {
	uri := os.Getenv("PLATFORM_NOTIFICATION_SOURCE_UPGRADE_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable notification-source upgrade database")
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
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE "_screenshot_studio_go_migrations" (name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir("sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "20261101100000_notification_source_context.sql" {
			break
		}
		if err := applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('source-org','Upgrade','source-org',now())`)
	exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('source-user','Member','source@example.test',true,now(),now())`)
	exec(`INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES('source-set','source-org','Original source','source-set')`)
	exec(`INSERT INTO content_draft(id,"organizationId",title,body,"plainText","assetIds","channelConnectionIds","createdByUserId","socialSetId") VALUES('source-draft','source-org','Draft','{}','','[]','[]','source-user','source-set')`)
	insert := `INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey") VALUES($1,'source-org','activity.member.mentioned','content_draft','source-draft','{}',$1)`
	exec(insert, "historical-event")
	exec(`INSERT INTO platform_notification_inbox(id,"organizationId","userId",event_id,kind,resource_type,resource_id,description,href,read_at,archived_at) VALUES('historical-receipt','source-org','source-user','historical-event','member.mentioned','content_draft','source-draft','Original description','/drafts/source-draft',now(),now())`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	exec(insert, "new-event")
	for _, tc := range []struct{ event, source string }{{"historical-event", ""}, {"new-event", "source-set"}} {
		var source string
		if err := db.SQL.QueryRow(`SELECT notification_social_set_id FROM outbox_event WHERE id=$1`, tc.event).Scan(&source); err != nil || source != tc.source {
			t.Fatalf("source for %s: %q %v", tc.event, source, err)
		}
	}
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	var retained int
	if err := db.SQL.QueryRow(`SELECT count(*) FROM platform_notification_inbox WHERE id='historical-receipt' AND description='Original description' AND read_at IS NOT NULL AND archived_at IS NOT NULL`).Scan(&retained); err != nil || retained != 1 {
		t.Fatal("upgrade or replay changed historical recipient state", err)
	}
}
