package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// API keys, support grants, and service callers reach product operations
// without a session; each is rechecked against live rows on every request.
func TestNonSessionPrincipalsAndAuthEvents(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	id := cuid.New()
	org, other, userID := "org_"+id, "other_"+id, "user_"+id
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Support',$2,true,now(),now())`, userID, id+"@example.test")
	for _, organization := range []string{org, other} {
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1`, userID)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM apikey WHERE "referenceId"=$1 OR "referenceId"=$2`, org, other)
	})
	key := func(suffix, organization string, enabled bool, expires string) string {
		keyID := "key_" + suffix + id
		exec(`INSERT INTO apikey (id,"referenceId",key,enabled,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,'hashed',$3,`+expires+`,now(),now())`,
			keyID, organization, enabled)
		return keyID
	}
	live, disabled, expired, foreign := key("live", org, true, "NULL"), key("off", org, false, "NULL"),
		key("old", org, true, "now()-interval '1 minute'"), key("far", other, true, "NULL")
	exec(`INSERT INTO support_access_grant (id,"organizationId","userId",purpose,"expiresAt") VALUES ($1,$2,$3,'debug',now()+interval '1 hour')`,
		"grant_"+id, org, userID)

	repo := NewConfiguration(db.Client)
	for _, check := range []struct {
		actor Actor
		want  error
	}{
		{Actor{OrganizationID: org, Kind: "api_key", KeyID: live}, nil},
		{Actor{OrganizationID: org, Kind: "api_key", KeyID: disabled}, publishing.ErrUnauthorized},
		{Actor{OrganizationID: org, Kind: "api_key", KeyID: expired}, publishing.ErrUnauthorized},
		{Actor{OrganizationID: org, Kind: "api_key", KeyID: foreign}, publishing.ErrUnauthorized},
		{Actor{OrganizationID: org, Kind: "support", UserID: userID, GrantID: "grant_" + id}, nil},
		{Actor{OrganizationID: other, Kind: "support", UserID: userID, GrantID: "grant_" + id}, publishing.ErrForbidden},
		{Actor{OrganizationID: org, Kind: "service"}, nil},
		{Actor{OrganizationID: "missing_" + id, Kind: "webhook"}, publishing.ErrForbidden},
		{Actor{OrganizationID: org, Kind: "superuser"}, publishing.ErrUnauthorized},
	} {
		if err := repo.AuthorizeRead(ctx, check.actor); !errors.Is(err, check.want) && err != check.want {
			t.Errorf("%s %s: got %v want %v", check.actor.Kind, check.actor.KeyID, err, check.want)
		}
	}

	if err := repo.RecordAuthEvent(ctx, AuthEvent{Action: "product.workspace_created", ActorUserID: userID,
		ActorDisplay: id + "@example.test", EntityID: org, EntityType: "organization", OrganizationID: org}); err != nil {
		t.Fatal(err)
	}
	if err := repo.RecordAuthEvent(ctx, AuthEvent{Action: "product.workspace_created", EntityID: org,
		EntityType: "organization", OrganizationID: org}); err != nil {
		t.Fatalf("replayed workspace creation: %v", err)
	}
	var settings, entitlements int
	if err := db.SQL.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM workspace_settings WHERE "organizationId"=$1),
		(SELECT count(*) FROM workspace_entitlement WHERE "organizationId"=$1)`, org).Scan(&settings, &entitlements); err != nil || settings != 1 || entitlements != 1 {
		t.Fatalf("provisioned settings=%d entitlements=%d err=%v", settings, entitlements, err)
	}
	exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
		"session_"+id, userID, org)
	if err := repo.RecordAuthEvent(ctx, AuthEvent{Action: "product.member_removed", EntityID: "member_" + id,
		EntityType: "member", OrganizationID: org, RemovedUserID: userID}); err != nil {
		t.Fatal(err)
	}
	var sessions int
	if err := db.SQL.QueryRowContext(ctx, `SELECT count(*) FROM session WHERE id=$1`, "session_"+id).Scan(&sessions); err != nil || sessions != 0 {
		t.Fatalf("removed member kept %d sessions: %v", sessions, err)
	}
	if err := repo.RecordAuthEvent(ctx, AuthEvent{Action: "product.campaign_created", EntityID: org,
		EntityType: "organization", OrganizationID: org}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unlisted auth event accepted: %v", err)
	}

	if err := repo.AppendAuditEvent(ctx, Actor{OrganizationID: org, Kind: "api_key", KeyID: live, Display: "CI key"},
		AuditEventInput{Action: "product.campaign_produced", EntityID: "c1", EntityType: "campaign"}); err != nil {
		t.Fatal(err)
	}
	logged, err := db.Client.AuditLog.Query().Where(auditlog.OrganizationID(org), auditlog.Action("product.campaign_produced")).Only(ctx)
	if err != nil || logged.ActorType != auditlog.ActorTypeSERVICE || logged.ActorDisplay == nil || *logged.ActorDisplay != "CI key" {
		t.Fatalf("api key audit = %+v err=%v", logged, err)
	}
	if err := repo.AppendAuditEvent(ctx, Actor{OrganizationID: org, Kind: "service"},
		AuditEventInput{Action: "DROP TABLE", EntityID: "c1", EntityType: "campaign"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("malformed audit action accepted: %v", err)
	}

	if operational, err := repo.WorkspaceOperational(ctx, org); err != nil || !operational {
		t.Fatalf("operational=%v err=%v", operational, err)
	}
	exec(`INSERT INTO workspace_deletion (id,"organizationId","requestedByUserId","scheduledFor","updatedAt") VALUES ($1,$2,$3,now()+interval '7 days',now())`,
		"deletion_"+id, org, userID)
	if operational, err := repo.WorkspaceOperational(ctx, org); err != nil || operational {
		t.Fatalf("pending deletion operational=%v err=%v", operational, err)
	}
	if err := repo.AuthorizeRead(ctx, Actor{OrganizationID: org, Kind: "api_key", KeyID: live}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("api key reached a workspace pending deletion: %v", err)
	}
}
