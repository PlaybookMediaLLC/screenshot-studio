package platformmigrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestWorkspaceCreationMigrationFreshAndUpgrade(t *testing.T) {
	uri := os.Getenv("PLATFORM_WORKSPACE_CREATION_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("requires a fresh disposable workspace-creation migration database")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, uri)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	var existing bool
	if err := db.SQL.QueryRow(`SELECT current_database(),to_regclass('public.organization') IS NOT NULL`).Scan(&name, &existing); err != nil || !strings.Contains(name, "test") || existing {
		t.Fatal("migration test requires an empty disposable test database")
	}
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatalf("fresh database: %v", err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Recreate the pre-upgrade schema in this disposable database. The new
	// receipt table is still empty, so no retry history is discarded.
	exec(`DROP TABLE platform_workspace_creation`)
	exec(`DELETE FROM "_screenshot_studio_go_migrations" WHERE name='20261101090000_platform_workspace_creation.sql'`)
	exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('creator','Creator','creator@example.test',true,now(),now())`)
	exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES('existing','Existing team','existing',now())`)
	exec(`INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES('owner','existing','creator','owner',now())`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatalf("representative upgrade: %v", err)
	}
	var owners, receipts int
	if err := db.SQL.QueryRow(`SELECT (SELECT count(*) FROM member WHERE id='owner' AND role='owner'),(SELECT count(*) FROM platform_workspace_creation)`).Scan(&owners, &receipts); err != nil || owners != 1 || receipts != 0 {
		t.Fatalf("upgrade altered existing identity: owners=%d receipts=%d err=%v", owners, receipts, err)
	}
	exec(`INSERT INTO platform_workspace_creation(id,"organizationId","userId","requestKey","requestHash") VALUES('receipt','existing','creator','key:stable','hash')`)
	if err := Apply(ctx, db.SQL); err != nil {
		t.Fatalf("migration replay: %v", err)
	}
	exec(`DELETE FROM organization WHERE id='existing'`)
	if err := db.SQL.QueryRow(`SELECT count(*) FROM platform_workspace_creation WHERE id='receipt'`).Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("organization deletion lost tombstone: %d %v", receipts, err)
	}
	exec(`DELETE FROM "user" WHERE id='creator'`)
	if err := db.SQL.QueryRow(`SELECT count(*) FROM platform_workspace_creation`).Scan(&receipts); err != nil || receipts != 0 {
		t.Fatalf("user deletion retained personal receipt: %d %v", receipts, err)
	}
}
