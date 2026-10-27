package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestPersonalSlackUpgradePreservesSharedConnections(t *testing.T) {
	uri := os.Getenv("PLATFORM_PERSONAL_SLACK_UPGRADE_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable personal Slack upgrade database")
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
		if entry.Name() >= "20261101110000_personal_slack_connections.sql" {
			break
		}
		if err = applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('dm-org','Upgrade','dm-org',now())`)
	exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('dm-user','Member','dm@example.test',true,now(),now())`)
	exec(`INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES('dm-member','dm-org','dm-user','creator',now())`)
	exec(`INSERT INTO platform_slack_installation(id,app_id,team_id,team_name,encrypted_credentials) VALUES('dm-install','A123','T123','Fixture team','fixture-encrypted-placeholder')`)
	exec(`INSERT INTO platform_slack_connection(id,"organizationId",installation_id) VALUES('shared','dm-org','dm-install')`)
	exec(`INSERT INTO platform_notification_delivery(id,"organizationId",event_id,kind,channel,destination,status,provider_receipt) VALUES('old-delivery','dm-org','old-event','notification.test','slack','C123','SUCCEEDED','C123:1')`)
	if err = Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO platform_slack_personal_connection(id,"organizationId","userId",member_id,installation_id,slack_user_id) VALUES('personal','dm-org','dm-user','dm-member','dm-install','U123')`)
	if _, err = db.SQL.Exec(`INSERT INTO platform_slack_personal_connection(id,"organizationId","userId",member_id,installation_id,slack_user_id) VALUES('duplicate','dm-org','dm-user','dm-member','dm-install','U456')`); err == nil {
		t.Fatal("one member acquired ambiguous DM identities")
	}
	exec(`INSERT INTO platform_notification_delivery(id,"organizationId",event_id,kind,channel,destination,status,connection_id) VALUES('queued','dm-org','dm-event','notification.test','slack_dm','dm-user','PENDING','personal')`)
	exec(`INSERT INTO platform_notification_delivery(id,"organizationId",event_id,kind,channel,destination,status,connection_id,claim_token,send_started_at,encrypted_payload) VALUES('claimed','dm-org','dm-event-2','notification.test','slack_dm','dm-user','CLAIMED','personal','claim',now(),'fixture-payload')`)
	if err = Apply(ctx, db.SQL); err != nil {
		t.Fatal("migration replay", err)
	}
	exec(`DELETE FROM member WHERE id='dm-member'`)
	var connections, personal, retained int
	if err = db.SQL.QueryRow(`SELECT (SELECT count(*) FROM platform_slack_connection WHERE id='shared'),(SELECT count(*) FROM platform_slack_personal_connection),(SELECT count(*) FROM platform_notification_delivery WHERE id='old-delivery' AND status='SUCCEEDED' AND provider_receipt='C123:1')`).Scan(&connections, &personal, &retained); err != nil || connections != 1 || personal != 0 || retained != 1 {
		t.Fatal("upgrade or member removal changed shared history", err)
	}
	for _, tc := range []struct{ id, status string }{{"queued", "SKIPPED"}, {"claimed", "UNCERTAIN"}} {
		var status, claim, payload string
		if err = db.SQL.QueryRow(`SELECT status,claim_token,encrypted_payload FROM platform_notification_delivery WHERE id=$1`, tc.id).Scan(&status, &claim, &payload); err != nil || status != tc.status || claim != "" || payload != "" {
			t.Fatalf("membership removal failed to fence %s: %s %v", tc.id, status, err)
		}
	}
}
