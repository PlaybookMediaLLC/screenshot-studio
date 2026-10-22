package notifications

import (
	"context"
	"testing"

	"github.com/lucsky/cuid"
)

// TestSocialSetNotificationGating covers RFC 043's three gates: a per-set
// preference, a private set's owner-only visibility, and the email master
// switch.
func TestSocialSetNotificationGating(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("RESEND_API_KEY", "fixture")
	f.s.Send = func(context.Context, Delivery, Envelope) (Outcome, error) {
		return Outcome{Status: "SUCCEEDED"}, nil
	}
	setID, draftID := "set_"+f.campaign, "draft_"+f.campaign
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES($1,$2,'Brand',$3)`, setID, f.owner.OrganizationID, cuid.New())
	execFixture(t, f, `INSERT INTO content_draft(id,"organizationId",title,body,"plainText","assetIds","channelConnectionIds","createdByUserId","socialSetId") VALUES($1,$2,'Draft','{}','','[]','[]',$3,$4)`, draftID, f.owner.OrganizationID, f.owner.UserID, setID)
	published := func() int {
		t.Helper()
		tx, err := f.s.DB.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if err = emitSQL(ctx, tx, f.owner.OrganizationID, "post.published", "content_draft", draftID, f.creator.UserID, nil); err != nil {
			t.Fatal(err)
		}
		var event string
		if err = tx.QueryRow(`SELECT id FROM outbox_event WHERE "organizationId"=$1 ORDER BY "createdAt" DESC,id DESC LIMIT 1`, f.owner.OrganizationID).Scan(&event); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		if err = f.s.Process(ctx); err != nil {
			t.Fatal(err)
		}
		var deliveries int
		if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE event_id=$1 AND destination=$2 AND status<>'SKIPPED'`, event, f.owner.UserID).Scan(&deliveries); err != nil {
			t.Fatal(err)
		}
		return deliveries
	}
	if n := published(); n == 0 {
		t.Fatal("the draft's author heard nothing about a publish in a shared set")
	}

	execFixture(t, f, `INSERT INTO platform_notification_preference(id,"organizationId","userId",events,generation,social_sets) VALUES($1,$2,$3,'{}',2,$4)`, cuid.New(), f.owner.OrganizationID, f.owner.UserID, `{"`+setID+`":{"post.published":false}}`)
	if n := published(); n != 0 {
		t.Fatalf("a set turned off still notified: %d deliveries", n)
	}

	execFixture(t, f, `UPDATE platform_notification_preference SET social_sets='{}' WHERE "userId"=$1`, f.owner.UserID)
	execFixture(t, f, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.creator.UserID)
	if n := published(); n != 0 {
		t.Fatalf("a private set's activity reached a member who is not its owner: %d deliveries", n)
	}
	if private, err := f.s.privateEvent(ctx, occurrence{org: f.owner.OrganizationID, resourceType: "content_draft", resourceID: draftID}); err != nil || !private {
		t.Fatalf("a private set's event was cleared for Slack: %v %v", private, err)
	}

	execFixture(t, f, `INSERT INTO user_preference("userId","emailNotifications") VALUES($1,false)`, f.owner.UserID)
	event := f.event(t, "campaign_posts.decided", "")
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	var email, inApp int
	if err := f.s.DB.QueryRow(`SELECT count(*) FILTER (WHERE channel='email' AND status<>'SKIPPED'),count(*) FILTER (WHERE channel='in_app') FROM platform_notification_delivery WHERE event_id=$1 AND destination=$2 AND status<>'SKIPPED'`, event, f.owner.UserID).Scan(&email, &inApp); err != nil {
		t.Fatal(err)
	}
	if email != 0 || inApp != 1 {
		t.Fatalf("email switch off: email=%d in_app=%d", email, inApp)
	}
}
