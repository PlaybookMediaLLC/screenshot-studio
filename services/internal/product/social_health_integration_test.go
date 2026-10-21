package product

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// socialCredentialFixture writes the same tenant binding and provider rows
// that the social service owns. No health bypass is installed in production.
func socialCredentialFixture(t *testing.T, ctx context.Context, db *sql.DB, org string) func(string, string) {
	t.Helper()
	var name string
	if err := db.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	remote := "social-" + org
	exec(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ($1,'Fixture',now())`, remote)
	exec(`INSERT INTO social_tenant_binding ("organizationId","goOrganizationId","secretReference") VALUES ($1,$2,$3)`, org, remote, "SOCIAL_FIXTURE_"+org)
	t.Cleanup(func() {
		for _, row := range []struct{ query, id string }{
			{`DELETE FROM "Integration" WHERE "organizationId"=$1`, remote},
			{`DELETE FROM social_tenant_binding WHERE "organizationId"=$1`, org},
			{`DELETE FROM "Organization" WHERE id=$1`, remote},
		} {
			if _, err := db.ExecContext(ctx, row.query, row.id); err != nil {
				t.Errorf("social fixture cleanup: %v", err)
			}
		}
	})
	return func(id, platform string) {
		t.Helper()
		exec(`INSERT INTO "Integration" (id,"internalId","organizationId",name,"providerIdentifier",type,token) VALUES ($1,$1,$2,'Fixture',$3,'social','fixture-only-credential')`, id, remote, platform)
	}
}

func TestUnverifiedSocialCredentialsCannotSchedule(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo, owner := w.ctx, w.repo.WithMonthlyMeter(&recordingMonthlyMeter{}), w.owner
	subscribe(t, ctx, repo, w.org, "pro")
	if _, err := repo.ListSocialSets(ctx, owner); err != nil {
		t.Fatal(err)
	}
	external := "x-" + w.id
	connection, err := repo.auth.CreateConnection(ctx, publishing.Actor{Organization: w.org, UserID: owner.UserID, RequestID: owner.RequestID, Type: "USER"},
		publishing.CreateConnectionInput{ExternalAccountID: external, Platform: "x", ProviderSettings: map[string]any{}, SecretReference: "SOCIAL_API_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := repo.CreateContentDraft(ctx, owner, ContentDraftInput{Title: "Keep this draft", PlainText: "Unchanged"})
	if err != nil {
		t.Fatal(err)
	}
	schedule := func() error {
		_, err := repo.ScheduleContentDraft(ctx, owner, draft.ID, ScheduleContentDraftInput{ScheduledFor: time.Now().Add(time.Hour), Version: draft.Version,
			Targets: []ContentDraftScheduleTarget{{Caption: "Verified only", ChannelConnectionID: connection.ID}}})
		return err
	}
	expect := func(want string) {
		t.Helper()
		set, err := repo.GetSocialSet(ctx, owner, *connection.SocialSetID)
		if err != nil || len(set.Accounts) != 1 || set.Accounts[0].Health != want || !set.NeedsAttention {
			t.Fatalf("health=%+v want=%s err=%v", set, want, err)
		}
		if err := schedule(); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("%s credentials scheduled: %v", want, err)
		}
		current, err := repo.GetContentDraft(ctx, owner, draft.ID)
		if err != nil || current.Version != draft.Version || current.PlainText != "Unchanged" {
			t.Fatalf("failed verification changed draft: %+v %v", current, err)
		}
		count, err := w.db.Client.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(draft.ID)).Count(ctx)
		if err != nil || count != 0 {
			t.Fatalf("failed verification created %d posts: %v", count, err)
		}
	}
	// No binding, then a binding whose account is absent: both are unknown.
	expect(AccountUnverified)
	add := socialCredentialFixture(t, ctx, w.db.SQL, w.org)
	expect(AccountUnverified)
	add(external, "x")
	// A real row from a different social tenant is never evidence of access.
	w.exec(t, `UPDATE social_tenant_binding SET "goOrganizationId"=$2 WHERE "organizationId"=$1`, w.org, "foreign-"+w.org)
	expect(AccountUnverified)
	w.exec(t, `UPDATE social_tenant_binding SET "goOrganizationId"=$2 WHERE "organizationId"=$1`, w.org, "social-"+w.org)
	for _, test := range []struct{ name, update string }{
		{AccountUnverified, `"providerIdentifier"='linkedin'`},
		{AccountUnverified, `"providerIdentifier"='x', token=''`},
		{AccountExpired, `token='fixture-only-credential', "tokenExpiration"=now()-interval '1 minute'`},
		{AccountReconnectRequired, `"tokenExpiration"=NULL, "refreshNeeded"=true`},
		{AccountPermissionRequired, `"refreshNeeded"=false, "inBetweenSteps"=true`},
		{AccountRevoked, `"inBetweenSteps"=false, "deletedAt"=now()`},
	} {
		w.exec(t, `UPDATE "Integration" SET `+test.update+` WHERE id=$1`, external)
		expect(test.name)
	}
	w.exec(t, `UPDATE "Integration" SET "deletedAt"=NULL WHERE id=$1`, external)
	// Known product removal wins even if provider state is healthy.
	if err := w.db.Client.ChannelConnection.UpdateOneID(connection.ID).SetStatus(channelconnection.StatusDISABLED).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	removed, err := w.db.Client.ChannelConnection.Get(ctx, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	health, err := connectionHealth(ctx, w.db.Client, w.org, []*ent.ChannelConnection{removed})
	if err != nil || health[connection.ID] != AccountRemoved {
		t.Fatalf("removed=%v %v", health, err)
	}
	if err := schedule(); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("removed account scheduled: %v", err)
	}
	if err := w.db.Client.ChannelConnection.UpdateOneID(connection.ID).SetStatus(channelconnection.StatusACTIVE).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	set, err := repo.GetSocialSet(ctx, owner, *connection.SocialSetID)
	if err != nil || set.Accounts[0].Health != AccountConnected || set.NeedsAttention {
		t.Fatalf("verified=%+v %v", set, err)
	}
	if err := schedule(); err != nil {
		t.Fatalf("healthy verified account refused: %v", err)
	}
}
