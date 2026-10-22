package notifications

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/lucsky/cuid"
)

// Queue a real publication event without running the delivery worker yet.
// The creator is the draft author and the owner is the actor, so only the
// creator receives the personal notification.
func queueDraftNotification(t *testing.T, f fixture, slackConnection string) (setID, draftID, eventID string) {
	t.Helper()
	setID, draftID = cuid.New(), cuid.New()
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES($1,$2,'Queued brand',$1)`, setID, f.owner.OrganizationID)
	execFixture(t, f, `INSERT INTO content_draft(id,"organizationId",title,body,"plainText","assetIds","channelConnectionIds","createdByUserId","socialSetId") VALUES($1,$2,'Queued draft','{}','','[]','[]',$3,$4)`, draftID, f.owner.OrganizationID, f.creator.UserID, setID)
	execFixture(t, f, `INSERT INTO platform_notification_policy("organizationId",events,slack_connection_id,slack_channel_id) VALUES($1,$2,$3,'C123')`, f.owner.OrganizationID, fmt.Sprintf(`{"post.published":{"inApp":true,"email":%t,"slack":%t}}`, slackConnection == "", slackConnection != ""), slackConnection)
	tx, err := f.s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = emitSQL(context.Background(), tx, f.owner.OrganizationID, "post.published", "content_draft", draftID, f.owner.UserID, nil); err != nil {
		t.Fatal(err)
	}
	if err = tx.QueryRow(`SELECT id FROM outbox_event WHERE "organizationId"=$1 AND "aggregateId"=$2 AND type='activity.post.published'`, f.owner.OrganizationID, draftID).Scan(&eventID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	for range 1000 {
		if _, err = f.s.fanout(context.Background()); err != nil {
			t.Fatal(err)
		}
		var done bool
		if err = f.s.DB.QueryRow(`SELECT notification_fanned FROM outbox_event WHERE id=$1`, eventID).Scan(&done); err != nil {
			t.Fatal(err)
		}
		if done {
			return
		}
	}
	t.Fatal("fixture event was not projected")
	return
}

func assertDeliveryOutcome(t *testing.T, f fixture, eventID, channel, status, code string, wantAttempts int) {
	t.Helper()
	var gotStatus, gotCode, payload string
	var attempts int
	err := f.s.DB.QueryRow(`SELECT status,failure_code,encrypted_payload,attempts FROM platform_notification_delivery WHERE event_id=$1 AND channel=$2`, eventID, channel).Scan(&gotStatus, &gotCode, &payload, &attempts)
	if err != nil || gotStatus != status || gotCode != code || payload != "" || attempts != wantAttempts {
		t.Fatalf("delivery status=%s code=%s payload retained=%t attempts=%d error=%v", gotStatus, gotCode, payload != "", attempts, err)
	}
	var events int
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM outbox_event WHERE id=$1`, eventID).Scan(&events); err != nil || events != 1 {
		t.Fatalf("original activity lost or duplicated: count=%d error=%v", events, err)
	}
}

func TestQueuedEmailRechecksResourceAuthority(t *testing.T) {
	for _, change := range []string{"unchanged", "member_removed", "banned", "private", "draft_deleted", "set_deleted"} {
		t.Run(change, func(t *testing.T) {
			f := notificationFixture(t)
			t.Setenv("RESEND_API_KEY", "fixture")
			var sends atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				sends.Add(1)
				_, _ = io.WriteString(w, `{"id":"accepted"}`)
			}))
			defer server.Close()
			f.s.EmailBase = server.URL
			setID, draftID, eventID := queueDraftNotification(t, f, "")
			switch change {
			case "member_removed":
				execFixture(t, f, `DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2`, f.creator.OrganizationID, f.creator.UserID)
			case "banned":
				execFixture(t, f, `UPDATE "user" SET banned=true WHERE id=$1`, f.creator.UserID)
			case "private":
				execFixture(t, f, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.owner.UserID)
			case "draft_deleted":
				execFixture(t, f, `DELETE FROM content_draft WHERE id=$1`, draftID)
			case "set_deleted":
				execFixture(t, f, `UPDATE social_set SET "deletedAt"=now() WHERE id=$1`, setID)
			}
			if err := f.s.Process(context.Background()); err != nil {
				t.Fatal(err)
			}
			want, status, code := int32(0), "SKIPPED", "ACCESS_REMOVED"
			if change == "unchanged" {
				want, status, code = 1, "SUCCEEDED", ""
			}
			if sends.Load() != want {
				t.Fatalf("provider calls=%d, want %d", sends.Load(), want)
			}
			attempts := 1
			if change == "member_removed" {
				code, attempts = "MEMBERSHIP_REMOVED", 0
			}
			assertDeliveryOutcome(t, f, eventID, "email", status, code, attempts)
			if change == "private" || change == "draft_deleted" || change == "set_deleted" {
				page, err := f.s.ListFeed(context.Background(), f.creator, "activity", "")
				if err != nil || len(page.Items) != 1 || page.Items[0].Href != "" || page.Items[0].Description != "This activity is no longer available." {
					t.Fatalf("stale activity was not redacted: %+v %v", page, err)
				}
				if target, err := f.s.Resolve(context.Background(), f.creator, page.Items[0].ID); err != nil || target != "" {
					t.Fatalf("stale activity resolved: %q %v", target, err)
				}
			}
		})
	}
}

func TestQueuedSlackRechecksSocialSetVisibility(t *testing.T) {
	for _, change := range []string{"unchanged", "private", "set_deleted", "draft_deleted", "private_during_validation"} {
		t.Run(change, func(t *testing.T) {
			f := notificationFixture(t)
			connection := testSlackConnection(t, f)
			setID, draftID, eventID := queueDraftNotification(t, f, connection.ID)
			var sends, validations atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/conversations.info":
					if validations.Add(1) == 1 && change == "private_during_validation" {
						if _, err := f.s.DB.Exec(`UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.creator.UserID); err != nil {
							t.Error(err)
						}
					}
					_, _ = io.WriteString(w, `{"ok":true,"channel":{"id":"C123","name":"team","is_member":true}}`)
				case "/api/chat.postMessage":
					sends.Add(1)
					_, _ = io.WriteString(w, `{"ok":true,"channel":"C123","ts":"123.456"}`)
				default:
					t.Errorf("unexpected provider path: %s", r.URL.Path)
					w.WriteHeader(400)
				}
			}))
			defer server.Close()
			f.s.SlackBase = server.URL
			switch change {
			case "private":
				execFixture(t, f, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.creator.UserID)
			case "set_deleted":
				execFixture(t, f, `UPDATE social_set SET "deletedAt"=now() WHERE id=$1`, setID)
			case "draft_deleted":
				execFixture(t, f, `DELETE FROM content_draft WHERE id=$1`, draftID)
			}
			if err := f.s.Process(context.Background()); err != nil {
				t.Fatal(err)
			}
			want, status, code := int32(0), "SKIPPED", "ACCESS_REMOVED"
			if change == "unchanged" {
				want, status, code = 1, "SUCCEEDED", ""
			}
			if sends.Load() != want {
				t.Fatalf("provider sends=%d, want %d", sends.Load(), want)
			}
			assertDeliveryOutcome(t, f, eventID, "slack", status, code, 1)
		})
	}
}

// A database trigger changes authority exactly when the first payload is stored,
// exercising the final pre-send check without adding test hooks to production.
func mutateAfterPayload(t *testing.T, f fixture, eventID, mutation string) {
	t.Helper()
	name := "notification_boundary_" + cuid.New()
	literal := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	execFixture(t, f, fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
		IF NEW.event_id=%s AND OLD.encrypted_payload='' AND NEW.encrypted_payload<>'' THEN %s; END IF;
		RETURN NEW; END $$`, name, literal(eventID), mutation))
	t.Cleanup(func() { execFixture(t, f, `DROP FUNCTION `+name+`() CASCADE`) })
	execFixture(t, f, `CREATE TRIGGER `+name+` AFTER UPDATE OF encrypted_payload ON platform_notification_delivery FOR EACH ROW EXECUTE FUNCTION `+name+`()`)
}

func TestQueuedEmailRechecksAfterPayloadPersistence(t *testing.T) {
	for _, change := range []string{"email_changed", "member_removed", "banned", "claim_cancelled"} {
		t.Run(change, func(t *testing.T) {
			f := notificationFixture(t)
			t.Setenv("RESEND_API_KEY", "fixture")
			_, _, eventID := queueDraftNotification(t, f, "")
			status, code := "SKIPPED", "ACCESS_REMOVED"
			var mutation string
			switch change {
			case "email_changed":
				code = "EMAIL_CHANGED"
				mutation = fmt.Sprintf(`UPDATE "user" SET email='changed@example.test' WHERE id='%s'`, f.creator.UserID)
			case "member_removed":
				status, code = "UNCERTAIN", "MEMBERSHIP_REMOVED"
				mutation = fmt.Sprintf(`DELETE FROM member WHERE "organizationId"='%s' AND "userId"='%s'`, f.creator.OrganizationID, f.creator.UserID)
			case "banned":
				mutation = fmt.Sprintf(`UPDATE "user" SET banned=true WHERE id='%s'`, f.creator.UserID)
			case "claim_cancelled":
				code = "OPERATOR_CANCELLED"
				mutation = fmt.Sprintf(`UPDATE platform_notification_delivery SET status='SKIPPED',failure_code='%s',claim_token='',encrypted_payload='' WHERE event_id='%s' AND channel='email'`, code, eventID)
			}
			mutateAfterPayload(t, f, eventID, mutation)
			var sends atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				sends.Add(1)
				_, _ = io.WriteString(w, `{"id":"accepted"}`)
			}))
			defer server.Close()
			f.s.EmailBase = server.URL
			if err := f.s.Process(context.Background()); err != nil {
				t.Fatal(err)
			}
			if sends.Load() != 0 {
				t.Fatal("sent a payload after its authority, destination or claim changed")
			}
			assertDeliveryOutcome(t, f, eventID, "email", status, code, 1)
		})
	}
}
