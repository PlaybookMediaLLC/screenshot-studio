package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Announcements are scheduled for the maintenance delivery job, so the rows
// written here must match what that job selects.
func TestAnnouncementsAndAudience(t *testing.T) {
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
	org, other, owner, creator := "org_"+id, "other_"+id, "owner_"+id, "creator_"+id
	approved, draft := "approved"+id, "draft"+id
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	for _, organization := range []string{org, other} {
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
	}
	for role, user := range map[string]string{"owner": owner, "creator": creator} {
		exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$1,$2,true,now(),now())`, user, user+"@example.test")
		exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`, "session_"+user, user, org)
		exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())`, "member_"+user, org, user, role)
	}
	outsider := "outsider_" + id
	exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$1,$2,true,now(),now())`, outsider, outsider+"@example.test")
	exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`, "session_"+outsider, outsider, other)
	exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, "member_"+outsider, other, outsider)
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1 OR id=$2 OR id=$3`, owner, creator, outsider)
	})
	exec(`INSERT INTO release (id,"organizationId",title,"benefitStatement","updatedAt") VALUES ($1,$2,'Faster exports','Exports finish sooner',now())`, "release"+id, org)
	exec(`INSERT INTO release_document (id,"organizationId","releaseId",revision,"frontMatter","bodyMarkdown",status,"updatedAt") VALUES ($1,$2,$3,2,'{}','Body','APPROVED',now()),($4,$2,$3,3,'{}','Body','DRAFT',now())`,
		approved, org, "release"+id, draft)

	meter := &recordingMonthlyMeter{}
	repo := NewConfiguration(db.Client).WithMonthlyMeter(meter)
	subscribe(t, ctx, repo, org, "pro")
	emails := monthlyMeterKey(QuotaEmails, org, time.Now())
	session := Actor{OrganizationID: org, UserID: owner, SessionID: "session_" + owner, RequestID: "req_" + id}
	creatorSession := Actor{OrganizationID: org, UserID: creator, SessionID: "session_" + creator}
	service := Actor{OrganizationID: org, Kind: "service", Display: "b@example.test"}
	foreign := Actor{OrganizationID: other, Kind: "service"}
	foreignSession := Actor{OrganizationID: other, UserID: outsider, SessionID: "session_" + outsider}
	schedule := func(actor Actor, document, key string) (*AnnouncementSchedule, error) {
		return repo.ScheduleAnnouncement(ctx, actor, ScheduleAnnouncementInput{IdempotencyKey: key, ReleaseDocumentID: document})
	}

	if _, err := schedule(session, approved, "empty"); !errors.Is(err, publishing.ErrConflict) || !strings.Contains(err.Error(), "no subscribed customers") {
		t.Fatalf("empty audience scheduled: %v", err)
	}
	if _, err := repo.AddAudienceSubscribers(ctx, creatorSession, []AudienceSubscriberInput{{Email: "x@example.test"}}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("creator edited audience: %v", err)
	}
	added, err := repo.AddAudienceSubscribers(ctx, session, []AudienceSubscriberInput{
		{Email: " A@Example.test "}, {Email: "a@example.test", Name: stringPointer(" Ada ")}, {Email: "b@example.test"}})
	if err != nil || added.Added != 2 || added.Skipped != 0 {
		t.Fatalf("added=%+v err=%v", added, err)
	}
	if _, err := repo.AddAudienceSubscribers(ctx, session, []AudienceSubscriberInput{{Email: "not an address"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid address accepted: %v", err)
	}

	if err := repo.UnsubscribeAudienceMember(ctx, session, "b@example.test"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("session unsubscribed: %v", err)
	}
	for range 2 {
		if err := repo.UnsubscribeAudienceMember(ctx, service, "b@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.UnsubscribeAudienceMember(ctx, foreign, "a@example.test"); err != nil {
		t.Fatal(err)
	}
	unsubscribed, err := db.Client.AuditLog.Query().Where(auditlog.OrganizationID(org), auditlog.Action("audience.unsubscribed")).All(ctx)
	if err != nil || len(unsubscribed) != 1 || unsubscribed[0].RequestID != "b@example.test" || unsubscribed[0].ActorType != auditlog.ActorTypeSERVICE {
		t.Fatalf("unsubscribe audits=%+v err=%v", unsubscribed, err)
	}
	// Re-importing must not resurrect consent.
	added, err = repo.AddAudienceSubscribers(ctx, session, []AudienceSubscriberInput{{Email: "B@example.test"}, {Email: "c@example.test"}})
	if err != nil || added.Added != 1 || added.Skipped != 1 {
		t.Fatalf("re-import added=%+v err=%v", added, err)
	}
	if reach, err := repo.GetAudienceReach(ctx, session); err != nil || reach != 2 {
		t.Fatalf("reach=%d err=%v", reach, err)
	}
	active, err := repo.ListAudienceSubscribers(ctx, session, false, 100)
	all, allErr := repo.ListAudienceSubscribers(ctx, session, true, 100)
	if err != nil || allErr != nil || len(active) != 2 || len(all) != 3 {
		t.Fatalf("active=%d all=%d err=%v %v", len(active), len(all), err, allErr)
	}
	for _, subscriber := range all {
		if subscriber.Email == "a@example.test" && (subscriber.Name == nil || *subscriber.Name != "Ada") {
			t.Fatalf("last duplicate name not kept: %+v", subscriber)
		}
		if subscriber.Email == "b@example.test" && subscriber.UnsubscribedAt == nil {
			t.Fatal("re-import cleared an unsubscribe")
		}
	}
	if reach, err := repo.GetAudienceReach(ctx, foreign); err != nil || reach != 0 {
		t.Fatalf("foreign reach=%d err=%v", reach, err)
	}

	if _, err := schedule(session, draft, "draft"); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("draft scheduled: %v", err)
	}
	if _, err := schedule(foreignSession, approved, "foreign"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("foreign document scheduled: %v", err)
	}
	if _, err := schedule(service, approved, "service"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("service scheduled: %v", err)
	}
	if _, err := schedule(creatorSession, approved, "creator"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("creator scheduled: %v", err)
	}
	past := time.Now().Add(-time.Minute)
	if _, err := repo.ScheduleAnnouncement(ctx, session, ScheduleAnnouncementInput{IdempotencyKey: "past",
		ReleaseDocumentID: approved, ScheduledFor: &past}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("past schedule accepted: %v", err)
	}
	first, err := schedule(session, approved, "launch")
	if err != nil || !first.Created || first.Announcement.Status != "SCHEDULED" || first.Announcement.Channel != "EMAIL" {
		t.Fatalf("schedule=%+v err=%v", first, err)
	}
	charged := meter.used[emails]
	replay, err := schedule(session, approved, "launch")
	if err != nil || replay.Created || replay.Announcement.ID != first.Announcement.ID {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
	if meter.used[emails] != charged {
		t.Fatalf("a replayed schedule charged emails again: %d then %d", charged, meter.used[emails])
	}
	var due bool
	if err := db.SQL.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM customer_communication WHERE id=$1 AND channel='EMAIL' AND status='SCHEDULED' AND "scheduledFor"<=now())`, first.Announcement.ID).Scan(&due); err != nil || !due {
		t.Fatalf("maintenance would not pick up the announcement: due=%v err=%v", due, err)
	}
	scheduled, err := db.Client.AuditLog.Query().Where(auditlog.OrganizationID(org), auditlog.Action("communication.scheduled")).Only(ctx)
	if err != nil || scheduled.RequestID != "launch" || scheduled.Metadata["releaseId"] != "release"+id || scheduled.ActorType != auditlog.ActorTypeUSER {
		t.Fatalf("schedule audit=%+v err=%v", scheduled, err)
	}
	exec(`INSERT INTO communication_recipient (id,"organizationId","customerCommunicationId",email) VALUES ($1,$2,$3,'a@example.test')`, "recipient"+id, org, first.Announcement.ID)
	listed, err := repo.ListAnnouncements(ctx, session, 50)
	if err != nil || len(listed) != 1 || listed[0].Count.Recipients != 1 || listed[0].ReleaseDocument == nil ||
		listed[0].ReleaseDocument.Release.Title != "Faster exports" || listed[0].ReleaseDocument.Revision != 2 {
		t.Fatalf("listed=%+v err=%v", listed, err)
	}
	if listed, err := repo.ListAnnouncements(ctx, foreign, 50); err != nil || len(listed) != 0 {
		t.Fatalf("foreign listed=%+v err=%v", listed, err)
	}

	if cancelled, err := repo.CancelAnnouncement(ctx, foreignSession, first.Announcement.ID); err != nil || cancelled {
		t.Fatalf("foreign cancelled=%v err=%v", cancelled, err)
	}
	for _, want := range []bool{true, false} {
		if cancelled, err := repo.CancelAnnouncement(ctx, session, first.Announcement.ID); err != nil || cancelled != want {
			t.Fatalf("cancel = %v want %v err=%v", cancelled, want, err)
		}
	}
	if count, err := db.Client.AuditLog.Query().Where(auditlog.OrganizationID(org), auditlog.Action("communication.cancelled")).Count(ctx); err != nil || count != 1 {
		t.Fatalf("cancel audits=%d err=%v", count, err)
	}
}
