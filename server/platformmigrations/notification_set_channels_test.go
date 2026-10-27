package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestNotificationSetChannelsUpgradePreservesOptOuts(t *testing.T) {
	uri := os.Getenv("PLATFORM_NOTIFICATION_SET_CHANNELS_UPGRADE_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable notification preference upgrade database")
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
	exec := func(query string) {
		t.Helper()
		if _, err := db.SQL.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE "_screenshot_studio_go_migrations" (name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir("sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "20261101120000_notification_set_channels.sql" {
			break
		}
		if err := applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('preference-org','Upgrade','preference-org',now())`)
	exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('preference-user','Member','preference@example.test',true,now(),now())`)
	exec(`INSERT INTO platform_notification_preference(id,"organizationId","userId",events,generation,social_sets) VALUES('old-preference','preference-org','preference-user','{"post.published":{"inApp":false,"email":true,"slack":false}}',9,'{"setone":{"post.published":false}}')`)
	for range 2 {
		if err := Apply(ctx, db.SQL); err != nil {
			t.Fatal(err)
		}
	}
	var retained int
	if err := db.SQL.QueryRow(`SELECT count(*) FROM platform_notification_preference WHERE id='old-preference' AND generation=9 AND social_sets='{"setone":{"post.published":false}}'::jsonb AND events='{"post.published":{"inApp":false,"email":true,"slack":false}}'::jsonb AND social_set_channels='{}'::jsonb`).Scan(&retained); err != nil || retained != 1 {
		t.Fatal("upgrade or replay changed existing choices", err)
	}
}
