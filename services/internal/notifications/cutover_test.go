package notifications

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/authstore"
	"github.com/lucsky/cuid"
)

func TestLegacyImportRequiresVerifiedMappingsAndNeverFansOut(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	legacyOrg := cuid.New()
	legacyUser := cuid.New()
	item := cuid.New()
	execFixture(t, f, `INSERT INTO "Organization"(id,name,"updatedAt") VALUES($1,'Legacy',now())`, legacyOrg)
	execFixture(t, f, `INSERT INTO "User"(id,email,"providerName",timezone,"updatedAt","sendSuccessEmails","lastReadNotifications") VALUES($1,$2,'LOCAL',0,now(),false,now())`, legacyUser, f.owner.UserID+"@example.test")
	execFixture(t, f, `INSERT INTO "UserOrganization"(id,"userId","organizationId","updatedAt") VALUES($1,$2,$3,now())`, cuid.New(), legacyUser, legacyOrg)
	execFixture(t, f, `INSERT INTO social_tenant_binding("organizationId","goOrganizationId","secretReference","createdAt") VALUES($1,$2,$3,now())`, f.owner.OrganizationID, legacyOrg, cuid.New())
	execFixture(t, f, `INSERT INTO "Notifications"(id,"organizationId",content,"createdAt","updatedAt") VALUES($1,$2,'<p>Earlier activity &amp; context</p>',now()-interval '1 day',now())`, item, legacyOrg)
	t.Cleanup(func() {
		_, _ = f.s.DB.Exec(`DELETE FROM "Organization" WHERE id=$1`, legacyOrg)
		_, _ = f.s.DB.Exec(`DELETE FROM "User" WHERE id=$1`, legacyUser)
	})
	input := LegacyImport{WorkspaceID: f.owner.OrganizationID, OperatorID: f.owner.UserID, PreserveEmail: true, Mappings: []LegacyMapping{{LegacyUserID: legacyUser, UserID: f.owner.UserID}}}
	if _, err := f.s.ImportLegacy(ctx, input, true); err == nil {
		t.Fatal("email coincidence accepted without identity evidence")
	}
	input.Mappings[0].Evidence = "verified migration account binding fixture"
	preview, err := f.s.ImportLegacy(ctx, input, false)
	if err != nil || preview.Copies != 1 {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	page, err := f.s.List(ctx, f.owner, "")
	if err != nil || len(page.Items) != 0 {
		t.Fatal("preview mutated inbox", err)
	}
	result, err := f.s.ImportLegacy(ctx, input, true)
	if err != nil || result.Copies != 1 {
		t.Fatalf("import=%+v err=%v", result, err)
	}
	page, err = f.s.List(ctx, f.owner, "")
	if err != nil || len(page.Items) != 1 || page.Items[0].Description != "Earlier activity & context" || page.Items[0].Href != "" {
		t.Fatalf("historical unseen row=%+v err=%v", page, err)
	}
	var remaining, external int
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM "Notifications" WHERE id=$1`, item).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("shared legacy content retained", err)
	}
	pref, err := preferences(ctx, f.s.DB, f.owner.OrganizationID, f.owner.UserID)
	if err != nil || pref.Events["post.published"].Email || !pref.Events["post.publish_failed"].Email {
		t.Fatal("legacy preferences changed", err)
	}
	if _, err = f.s.Seen(ctx, f.owner, []string{page.Items[0].ID}, false, ""); err != nil {
		t.Fatal(err)
	}
	if _, err = f.s.ImportLegacy(ctx, input, true); err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	page, _ = f.s.List(ctx, f.owner, "")
	if len(page.Items) != 1 || page.Items[0].ReadAt == nil || page.UnseenCount != 0 {
		t.Fatal("import reset acknowledged receipt")
	}
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE "organizationId"=$1 AND channel<>'in_app'`, f.owner.OrganizationID).Scan(&external); err != nil || external != 0 {
		t.Fatal("historical external fan-out", err)
	}
}

func TestConcurrentMarkAllReusesCompletedAction(t *testing.T) {
	f := notificationFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// Process claims bounded batches across workspaces. Other integration
	// fixtures can precede ours even in a dedicated test database.
	processUntil := func(want int) {
		t.Helper()
		for {
			if err := f.s.Process(ctx); err != nil {
				t.Fatal(err)
			}
			page, err := f.s.List(ctx, f.owner, "")
			if err != nil {
				t.Fatal(err)
			}
			if len(page.Items) == want {
				return
			}
			if len(page.Items) > want {
				t.Fatalf("unexpected receipts: %d, want %d", len(page.Items), want)
			}
			if err := ctx.Err(); err != nil {
				t.Fatalf("receipts did not arrive: %v", err)
			}
		}
	}
	for range 8 {
		f.event(t, "generation.completed", f.creator.UserID)
	}
	processUntil(8)
	key := cuid.New()
	var group sync.WaitGroup
	for range 4 {
		group.Go(func() {
			result, err := f.s.Seen(ctx, f.owner, nil, true, key)
			if err != nil || result.Deleted != 8 {
				t.Errorf("concurrent receipt=%+v err=%v", result, err)
			}
		})
	}
	group.Wait()
	f.event(t, "generation.completed", f.creator.UserID)
	processUntil(9)
	result, err := f.s.Seen(ctx, f.owner, nil, true, key)
	if err != nil || result.Deleted != 8 || result.UnseenCount != 1 {
		t.Fatalf("retry consumed later arrival: %+v %v", result, err)
	}
}

func TestLocalSlackPacingDoesNotConsumeProviderRetryBudget(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	event := f.event(t, "generation.completed", f.creator.UserID)
	id := cuid.New()
	execFixture(t, f, `INSERT INTO platform_notification_delivery(id,"organizationId",event_id,kind,channel,destination,status,claim_token,attempts) VALUES($1,$2,$3,'generation.completed','slack','C123','CLAIMED','worker',20)`, id, f.owner.OrganizationID, event)
	if err := f.s.finish(ctx, Delivery{ID: id, claimToken: "worker", Attempts: 20}, Outcome{Status: "PENDING", Code: "channel_pacing", RetryAfter: time.Second}); err != nil {
		t.Fatal(err)
	}
	var status string
	var attempts int
	if err := f.s.DB.QueryRow(`SELECT status,attempts FROM platform_notification_delivery WHERE id=$1`, id).Scan(&status, &attempts); err != nil || status != "PENDING" || attempts != 19 {
		t.Fatalf("pacing counted as provider failure: %s %d %v", status, attempts, err)
	}
}

func TestAuthMembershipWritesCommitActorAndIgnoreRepeatedUpdates(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	execFixture(t, f, `INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,'member',now())`, "provisioned_"+f.owner.UserID, f.otherOrg, f.owner.UserID)
	var backgroundActor string
	if err := f.s.DB.QueryRow(`SELECT payload->>'actorUserId' FROM outbox_event WHERE "organizationId"=$1 AND type='activity.member.joined'`, f.otherOrg).Scan(&backgroundActor); err != nil || backgroundActor != "" {
		t.Fatalf("background provisioning invented a human actor: %s %v", backgroundActor, err)
	}
	store := authstore.New(f.s.DB)
	request := authstore.Request{ActorSessionID: f.owner.SessionID, Model: "member", Op: "update", Where: []authstore.Where{{Field: "organizationId", Value: f.owner.OrganizationID}, {Field: "userId", Value: f.creator.UserID}}, Data: map[string]any{"role": "approver"}}
	for range 2 {
		if _, err := store.Execute(ctx, request); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var actor string
	if err := f.s.DB.QueryRow(`SELECT count(*),min(payload->>'actorUserId') FROM outbox_event WHERE "organizationId"=$1 AND type='activity.member.role_changed'`, f.owner.OrganizationID).Scan(&count, &actor); err != nil || count != 1 || actor != f.owner.UserID {
		t.Fatalf("committed actor: %d %s %v", count, actor, err)
	}
	request.ActorSessionID = "expired-session"
	request.Data = map[string]any{"role": "admin"}
	if _, err := store.Execute(ctx, request); err == nil {
		t.Fatal("expired actor session mutated membership")
	}
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	page, err := f.s.List(ctx, f.owner, "")
	if err != nil || len(page.Items) != 0 {
		t.Fatal("human actor notified about own membership action", err)
	}
	page, err = f.s.List(ctx, f.creator, "")
	if err != nil || len(page.Items) != 1 {
		t.Fatal("affected member not notified", err)
	}
}

func TestProviderHealthIntentRollsBackAndIgnoresPolling(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	org, id := cuid.New(), cuid.New()
	execFixture(t, f, `INSERT INTO "Organization"(id,name,"updatedAt") VALUES($1,'Provider workspace',now())`, org)
	execFixture(t, f, `INSERT INTO social_tenant_binding("organizationId","goOrganizationId","secretReference","createdAt") VALUES($1,$2,$3,now())`, f.owner.OrganizationID, org, cuid.New())
	execFixture(t, f, `INSERT INTO "Integration"(id,"organizationId","internalId",name,"providerIdentifier",type,token) VALUES($1,$2,'provider-id','Provider','linkedin','social','fixture')`, id, org)
	t.Cleanup(func() { _, _ = f.s.DB.Exec(`DELETE FROM "Organization" WHERE id=$1`, org) })
	tx, err := f.s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE "Integration" SET "refreshNeeded"=true WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback()
	var count int
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM outbox_event WHERE "organizationId"=$1 AND type='activity.integration.reconnect_required'`, f.owner.OrganizationID).Scan(&count); err != nil || count != 0 {
		t.Fatal("rollback emitted activity", err)
	}
	for range 2 {
		execFixture(t, f, `UPDATE "Integration" SET "refreshNeeded"=true WHERE id=$1`, id)
	}
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM outbox_event WHERE "organizationId"=$1 AND type='activity.integration.reconnect_required'`, f.owner.OrganizationID).Scan(&count); err != nil || count != 1 {
		t.Fatal("polling emitted duplicate health activity", err)
	}
}
