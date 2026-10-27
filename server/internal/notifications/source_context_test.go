package notifications

import (
	"context"
	"testing"

	"github.com/lucsky/cuid"
)

func TestNotificationSourceSurvivesMoveAndRedactsLostSourceAccess(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	setID, draftID, eventID := queueDraftNotification(t, f, "")
	var captured string
	if err := f.s.DB.QueryRow(`SELECT notification_social_set_id FROM outbox_event WHERE id=$1`, eventID).Scan(&captured); err != nil || captured != setID {
		t.Fatalf("event did not retain its source: %q %v", captured, err)
	}
	otherSet := cuid.New()
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES($1,$2,'Queued brand',$1)`, otherSet, f.owner.OrganizationID)
	execFixture(t, f, `UPDATE content_draft SET "socialSetId"=$2 WHERE id=$1`, draftID, otherSet)
	page, err := f.s.ListFeed(ctx, f.creator, "activity", "")
	if err != nil || len(page.Items) != 1 || page.Items[0].SourceSocialSet == nil || page.Items[0].SourceSocialSet.ID != setID || page.Items[0].SourceSocialSet.Name != "Queued brand" {
		t.Fatalf("same-name destination replaced original source: %+v %v", page, err)
	}
	receipt := page.Items[0].ID
	execFixture(t, f, `UPDATE social_set SET name='Renamed source' WHERE id=$1`, setID)
	page, err = f.s.ListFeed(ctx, f.creator, "activity", "")
	if err != nil || page.Items[0].SourceSocialSet.Name != "Renamed source" {
		t.Fatal("source label did not use current authorized name", err)
	}
	// Source attribution is immutable even though its display name is live.
	if _, err = f.s.DB.Exec(`UPDATE outbox_event SET notification_social_set_id=$2 WHERE id=$1`, eventID, otherSet); err == nil {
		t.Fatal("event source was rewritten")
	}
	execFixture(t, f, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.owner.UserID)
	if allowed, _, err := f.s.resource(ctx, f.creator.OrganizationID, f.creator.UserID, "content_draft", draftID); err != nil || !allowed {
		t.Fatal("control: destination draft should remain readable", err)
	}
	page, err = f.s.ListFeed(ctx, f.creator, "activity", "")
	if err != nil || len(page.Items) != 1 || page.Items[0].SourceSocialSet != nil || page.Items[0].Description != "This activity is no longer available." || page.Items[0].Href != "" {
		t.Fatalf("old source leaked through moved draft: %+v %v", page, err)
	}
	if target, err := f.s.Resolve(ctx, f.creator, receipt); err != nil || target != "" {
		t.Fatalf("old source receipt resolved through moved draft: %q %v", target, err)
	}
	var sends int
	f.s.Send = func(context.Context, Delivery, Envelope) (Outcome, error) {
		sends++
		return Outcome{Status: "SUCCEEDED"}, nil
	}
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	if sends != 0 {
		t.Fatal("moving a resource bypassed queued source authority")
	}
	assertDeliveryOutcome(t, f, eventID, "email", "SKIPPED", "ACCESS_REMOVED", 1)
}

func TestNotificationEventCapturesSourceBeforeProjection(t *testing.T) {
	f := notificationFixture(t)
	t.Setenv("RESEND_API_KEY", "")
	ctx := context.Background()
	setID, draftID, _ := queueDraftNotification(t, f, "")
	// The next event is emitted with a real resource association, then the draft
	// moves before the worker projects it. Projection must use event-time source.
	tx, err := f.s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := emitSQL(ctx, tx, f.owner.OrganizationID, "member.mentioned", "content_draft", draftID, f.owner.UserID, map[string]any{"mentionedUserIds": []string{f.creator.UserID}}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	otherSet := cuid.New()
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES($1,$2,'Destination',$1)`, otherSet, f.owner.OrganizationID)
	execFixture(t, f, `UPDATE content_draft SET "socialSetId"=$2 WHERE id=$1`, draftID, otherSet)
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	page, err := f.s.ListFeed(ctx, f.creator, "inbox", "")
	if err != nil || len(page.Items) != 1 || page.Items[0].Kind != "member.mentioned" || page.Items[0].SourceSocialSet == nil || page.Items[0].SourceSocialSet.ID != setID {
		t.Fatalf("late projection lost source: %+v %v", page, err)
	}
	for _, id := range []string{setID, cuid.New()} {
		if _, allowed, err := sourceSocialSet(ctx, f.s.DB, f.otherOrg, f.creator.UserID, id); err != nil || allowed {
			t.Fatal("foreign or missing source was authorized", err)
		}
	}
	execFixture(t, f, `UPDATE social_set SET "deletedAt"=now() WHERE id=$1`, setID)
	page, err = f.s.ListFeed(ctx, f.creator, "inbox", "")
	if err != nil || page.Items[0].SourceSocialSet != nil || page.Items[0].Href != "" {
		t.Fatal("deleted original source disclosed after resource move", err)
	}
}

func TestPrivateConnectionActivityDoesNotBypassSetOwnership(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	setID, connection := cuid.New(), cuid.New()
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug",visibility,"ownerUserId") VALUES($1,$2,'Private identity',$1,'PRIVATE',$3)`, setID, f.owner.OrganizationID, f.creator.UserID)
	execFixture(t, f, `INSERT INTO channel_connection(id,"organizationId",provider,"externalAccountId","displayName","createdByUserId","socialSetId","secretReference","updatedAt") VALUES($1,$2,'social',$1,'Private account',$3,$4,'test-only',now())`, connection, f.owner.OrganizationID, f.creator.UserID, setID)
	if allowed, _, err := f.s.resource(ctx, f.owner.OrganizationID, f.owner.UserID, "channel_connection", connection); err != nil || allowed {
		t.Fatal("workspace owner could read another member's private connection event", err)
	}
	if allowed, _, err := f.s.resource(ctx, f.creator.OrganizationID, f.creator.UserID, "channel_connection", connection); err != nil || !allowed {
		t.Fatal("private owner could not read own connection event", err)
	}
	if private, err := f.s.privateEvent(ctx, occurrence{org: f.owner.OrganizationID, resourceType: "channel_connection", resourceID: connection}); err != nil || !private {
		t.Fatal("private connection was eligible for shared Slack", err)
	}
	execFixture(t, f, `UPDATE social_set SET "deletedAt"=now() WHERE id=$1`, setID)
	if allowed, _, err := f.s.resource(ctx, f.creator.OrganizationID, f.creator.UserID, "channel_connection", connection); err != nil || allowed {
		t.Fatal("deleted set retained connection activity access", err)
	}
}
