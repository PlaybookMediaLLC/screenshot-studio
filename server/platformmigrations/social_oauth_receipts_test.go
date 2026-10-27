package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestOAuthReceiptUpgradePreservesPendingStarts(t *testing.T) {
	uri := os.Getenv("PLATFORM_OAUTH_UPGRADE_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable OAuth upgrade database")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, uri)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err := db.SQL.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatal("upgrade requires a test database")
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE "_screenshot_studio_go_migrations" (name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`)
	entries, err := files.ReadDir("sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() >= "20261031100000_social_oauth_receipts.sql" {
			break
		}
		if err := applyOne(ctx, db.SQL, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('oauth-upgrade-org','OAuth upgrade','oauth-upgrade-org',now())`)
	for _, provider := range []string{"x", "platform-slack"} {
		exec(`INSERT INTO social_oauth_start(state,"organizationId","userId","sessionId",provider,"secretReference","expiresAt","createdAt","socialSetId") VALUES($1,'oauth-upgrade-org','original-user','original-session',$1,'FIXTURE_ONLY',now()+interval '1 hour',now(),'original-target')`, provider)
	}
	if err := applyOne(ctx, db.SQL, "20261031100000_social_oauth_receipts.sql"); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO social_oauth_start(state,"organizationId","userId","sessionId",provider,"secretReference","expiresAt","createdAt","socialSetId","expectedConnectionId")
	    VALUES('reconnect','oauth-upgrade-org','original-user','original-session','x','FIXTURE_ONLY',now()+interval '1 hour',now(),'original-target','original-connection')`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	for _, provider := range []string{"x", "platform-slack"} {
		var status, user, session, target, operation string
		var receiptMissing bool
		err := db.SQL.QueryRow(`SELECT "exchangeStatus","userId","sessionId","socialSetId","exchangeReceipt" IS NULL,operation FROM social_oauth_start WHERE state=$1`, provider).Scan(&status, &user, &session, &target, &receiptMissing, &operation)
		if err != nil || status != "PENDING" || user != "original-user" || session != "original-session" || target != "original-target" || !receiptMissing || operation != "ADD_ACCOUNT" {
			t.Fatalf("upgrade changed pending %s: %s %s %s %s %v %v", provider, status, user, session, target, receiptMissing, err)
		}
	}
	var reconnects int
	if err := db.SQL.QueryRow(`SELECT count(*) FROM social_oauth_start WHERE state='reconnect' AND operation='RECONNECT' AND "expectedConnectionId"='original-connection' AND "socialSetId"='original-target'`).Scan(&reconnects); err != nil || reconnects != 1 {
		t.Fatalf("upgrade lost reconnect identity: %d %v", reconnects, err)
	}
	exec(`UPDATE social_oauth_start SET "exchangeStatus"='COMPLETED',"exchangeReceipt"='{"id":"verified-account"}',"completedConnectionId"='connection',"completedAt"=now() WHERE state='x'`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.SQL.QueryRow(`SELECT count(*) FROM social_oauth_start WHERE state='x' AND "exchangeStatus"='COMPLETED' AND "exchangeReceipt"->>'id'='verified-account' AND "completedConnectionId"='connection'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("migration replay changed completed receipt: %d %v", count, err)
	}
}
