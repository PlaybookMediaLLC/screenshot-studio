package notifications

import (
	"context"
	"errors"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func decisionEvent(t *testing.T, f fixture, kind, actor string, background bool) string {
	t.Helper()
	tx, err := f.s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = emitSQL(context.Background(), tx, f.owner.OrganizationID, kind, "campaign", f.campaign, actor, map[string]any{"background": background}); err != nil {
		t.Fatal(err)
	}
	var id string
	if err = tx.QueryRow(`SELECT id FROM outbox_event WHERE "organizationId"=$1 AND type=$2 ORDER BY "createdAt" DESC,id DESC LIMIT 1`, f.owner.OrganizationID, "activity."+kind).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPersonalSlackExpiryAndRecipientRecovery(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	sends := 0
	personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) {
		sends++
		fmt.Fprint(w, `{"ok":true,"channel":"D123","ts":"123.456"}`)
	})
	connection := personalSlackFixture(t, f, f.creator, "U123")
	execFixture(t, f, `UPDATE platform_slack_installation SET expires_at=now()-interval '1 minute' WHERE id=(SELECT installation_id FROM platform_slack_personal_connection WHERE id=$1)`, connection.ID)
	id, err := f.s.Test(ctx, f.creator, "slack_dm", "expire-personal-test")
	if err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	receipt, err := f.s.DeliveryStatus(ctx, f.creator, id)
	if err != nil || receipt.Status != "BLOCKED" || receipt.FailureCode != "reconnect_required" || sends != 0 {
		t.Fatal("expired credentials reached provider", receipt, err, sends)
	}
	if err = f.s.Recover(ctx, f.creator, id, "retry"); err == nil {
		t.Fatal("expired credentials can be retried without reconnect")
	}
	if err = f.s.Recover(ctx, f.owner, id, "confirm_delivered"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("administrator changed someone else's private receipt", err)
	}
	grant := &slackGrant{AppID: "A" + f.owner.UserID, AccessToken: "fixture-token", Scope: strings.Join(slackScopes, ",")}
	grant.Team.ID, grant.Team.Name, grant.AuthedUser.ID = "T123", "Fixture team", "U123"
	reconnected, err := f.s.savePersonalSlack(ctx, f.creator, grant, connection.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reconnected.ID != connection.ID {
		t.Fatal("reconnect changed destination identity")
	}
	if err = f.s.Recover(ctx, f.creator, id, "retry"); err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	receipt, err = f.s.DeliveryStatus(ctx, f.creator, id)
	if err != nil || receipt.Status != "SUCCEEDED" || sends != 1 {
		t.Fatal("same-recipient recovery failed", receipt, err, sends)
	}
}

func TestQueuedRequiredFailureRechecksMastersWithoutLosingCategoryOverride(t *testing.T) {
	for _, change := range []string{"category", "email_master", "slack_master", "workspace"} {
		t.Run(change, func(t *testing.T) {
			f := notificationFixture(t)
			ctx := context.Background()
			t.Setenv("RESEND_API_KEY", "fixture")
			personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected provider call") })
			personalSlackFixture(t, f, f.owner, "U123")
			pol := defaultPolicy()
			pol.Events["post.publish_failed"] = Channels{InApp: true, Email: true}
			if _, err := f.s.SavePolicy(ctx, f.owner, pol); err != nil {
				t.Fatal(err)
			}
			event := decisionEvent(t, f, "post.publish_failed", f.owner.UserID, false)
			for range 1000 {
				if _, err := f.s.fanout(ctx); err != nil {
					t.Fatal(err)
				}
				var done bool
				if err := f.s.DB.QueryRow(`SELECT notification_fanned FROM outbox_event WHERE id=$1`, event).Scan(&done); err != nil {
					t.Fatal(err)
				}
				if done {
					break
				}
			}
			pref := defaultPreferences()
			pref.Events["post.publish_failed"] = Channels{}
			if change == "slack_master" {
				*pref.SlackEnabled = false
			}
			if _, err := f.s.SavePreferences(ctx, f.owner, pref); err != nil {
				t.Fatal(err)
			}
			if change == "email_master" {
				execFixture(t, f, `INSERT INTO user_preference("userId","emailNotifications") VALUES($1,false)`, f.owner.UserID)
			}
			if change == "workspace" {
				pol.Availability = &Channels{}
				if _, err := f.s.SavePolicy(ctx, f.owner, pol); err != nil {
					t.Fatal(err)
				}
			}
			sends := map[string]int{}
			f.s.Send = func(_ context.Context, d Delivery, _ Envelope) (Outcome, error) {
				sends[d.Channel]++
				return Outcome{Status: "SUCCEEDED"}, nil
			}
			if err := f.s.Process(ctx); err != nil {
				t.Fatal(err)
			}
			for _, channel := range []string{"email", "slack_dm"} {
				want := 1
				if change == "workspace" || change == "email_master" && channel == "email" || change == "slack_master" && channel == "slack_dm" {
					want = 0
				}
				if sends[channel] != want {
					t.Fatal("queued failure ignored current precedence", channel, sends, want)
				}
			}
		})
	}
}

func TestRequiredFailurePrecedenceAndIndependentChannelStates(t *testing.T) {
	for _, scenario := range []string{"required", "email_off", "slack_off", "workspace_off", "event_policy_off", "expired", "disconnected", "category_off", "manual_success", "scheduled_success"} {
		t.Run(scenario, func(t *testing.T) {
			f := notificationFixture(t)
			ctx := context.Background()
			t.Setenv("RESEND_API_KEY", "fixture")
			personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) { t.Errorf("unexpected provider call %s", r.URL.Path) })
			connection := personalSlackFixture(t, f, f.owner, "U123")
			kind := "post.publish_failed"
			if strings.Contains(scenario, "success") || scenario == "category_off" {
				kind = "post.published"
			}
			pol, pref := defaultPolicy(), defaultPreferences()
			pol.Events[kind] = Channels{InApp: true, Email: true}
			pref.Events[kind] = Channels{}
			if strings.Contains(scenario, "success") {
				pref.Events[kind] = Channels{InApp: true, Email: true, Slack: true}
			}
			if scenario == "workspace_off" {
				pol.Availability = &Channels{}
			}
			if scenario == "event_policy_off" {
				pol.Events[kind] = Channels{}
			}
			if scenario == "slack_off" {
				*pref.SlackEnabled = false
			}
			if _, err := f.s.SavePolicy(ctx, f.owner, pol); err != nil {
				t.Fatal(err)
			}
			if _, err := f.s.SavePreferences(ctx, f.owner, pref); err != nil {
				t.Fatal(err)
			}
			execFixture(t, f, `INSERT INTO user_preference("userId","emailNotifications") VALUES($1,$2)`, f.owner.UserID, scenario != "email_off")
			if scenario == "expired" {
				execFixture(t, f, `UPDATE platform_slack_installation SET health='RECONNECT_REQUIRED' WHERE id=(SELECT installation_id FROM platform_slack_personal_connection WHERE id=$1)`, connection.ID)
			}
			if scenario == "disconnected" {
				if err := f.s.DisconnectPersonalSlack(ctx, f.owner, connection.ID); err != nil {
					t.Fatal(err)
				}
			}
			sends := map[string]int{}
			f.s.Send = func(_ context.Context, d Delivery, _ Envelope) (Outcome, error) {
				sends[d.Channel]++
				return Outcome{Status: "SUCCEEDED", Receipt: "accepted"}, nil
			}
			event := decisionEvent(t, f, kind, f.owner.UserID, scenario == "scheduled_success" || scenario == "category_off")
			if err := f.s.Process(ctx); err != nil {
				t.Fatal(err)
			}
			if err := f.s.Process(ctx); err != nil {
				t.Fatal(err)
			}
			for _, channel := range []string{"in_app", "email", "slack_dm"} {
				if scenario == "manual_success" {
					var count int
					if err := f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE event_id=$1 AND destination=$2`, event, f.owner.UserID).Scan(&count); err != nil || count != 0 {
						t.Fatal("manual self-action was notified", count, err)
					}
					continue
				}
				wantStatus, wantCode := "SUCCEEDED", ""
				switch {
				case scenario == "workspace_off":
					wantStatus, wantCode = "SKIPPED", "WORKSPACE_CHANNEL_DISABLED"
				case scenario == "category_off":
					wantStatus, wantCode = "SKIPPED", "CATEGORY_DISABLED"
				case scenario == "event_policy_off" && channel != "slack_dm":
					wantStatus, wantCode = "SKIPPED", "WORKSPACE_EVENT_DISABLED"
				case scenario == "email_off" && channel == "email":
					wantStatus, wantCode = "SKIPPED", "EMAIL_TURNED_OFF"
				case scenario == "slack_off" && channel == "slack_dm":
					wantStatus, wantCode = "SKIPPED", "SLACK_TURNED_OFF"
				case scenario == "expired" && channel == "slack_dm":
					wantStatus, wantCode = "BLOCKED", "SLACK_RECONNECT_REQUIRED"
				case scenario == "disconnected" && channel == "slack_dm":
					wantStatus, wantCode = "SKIPPED", "SLACK_NOT_CONNECTED"
				}
				var status, code, decision string
				if err := f.s.DB.QueryRow(`SELECT status,failure_code,decision_code FROM platform_notification_delivery WHERE event_id=$1 AND channel=$2 AND destination=$3`, event, channel, f.owner.UserID).Scan(&status, &code, &decision); err != nil || status != wantStatus || code != wantCode {
					t.Fatalf("%s status=%s code=%s want=%s/%s error=%v", channel, status, code, wantStatus, wantCode, err)
				}
				if scenario == "required" && decision != "REQUIRED_FAILURE_ALERT" {
					t.Fatal("required decision was not persisted", decision)
				}
				if channel != "in_app" && ((wantStatus == "SUCCEEDED" && sends[channel] != 1) || (wantStatus != "SUCCEEDED" && sends[channel] != 0)) {
					t.Fatal("wrong external send count", channel, sends[channel])
				}
			}
		})
	}
}

func TestRecipientRecoveryUsesOriginalResendRequestAndIsIdempotent(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("RESEND_API_KEY", "fixture")
	var mu sync.Mutex
	var keys, bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		body, _ := io.ReadAll(r.Body)
		keys = append(keys, r.Header.Get("Idempotency-Key"))
		bodies = append(bodies, string(body))
		if len(keys) == 1 {
			w.WriteHeader(503)
			return
		} // Provider accepted, but its response was lost.
		fmt.Fprint(w, `{"id":"one-provider-receipt"}`)
	}))
	defer server.Close()
	f.s.EmailBase = server.URL
	id, err := f.s.Test(ctx, f.creator, "email", "recipient-recovery-key")
	if err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = f.s.Recover(ctx, f.creator, id, "retry"); err != nil {
			t.Fatal(err)
		}
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	if err = f.s.Recover(ctx, f.creator, id, "retry"); err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(keys) != 2 || keys[0] == "" || keys[0] != keys[1] || bodies[0] != bodies[1] {
		t.Fatal("retry changed provider identity/payload or sent twice", len(keys))
	}
	var audits, events int
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM audit_log WHERE "organizationId"=$1 AND action='notification.delivery_retry' AND "entityId"=$2`, f.owner.OrganizationID, id).Scan(&audits); err != nil || audits != 1 {
		t.Fatal("replay duplicated recovery audit", audits, err)
	}
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM outbox_event WHERE "organizationId"=$1 AND type='activity.notification.test'`, f.owner.OrganizationID).Scan(&events); err != nil || events != 1 {
		t.Fatal("recovery duplicated domain event", events, err)
	}
	list, err := f.s.Deliveries(ctx, f.creator, "personal")
	if err != nil || len(list) != 1 || list[0].Status != "SUCCEEDED" {
		t.Fatal("recipient cannot inspect own delivery", err)
	}
	list, err = f.s.Deliveries(ctx, f.owner, "personal")
	if err != nil || len(list) != 0 {
		t.Fatal("personal list leaked another recipient", err)
	}
}

func TestRequiredFailureBypassesLegacySetOptOutWithoutExpandingAccess(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	setID, draftID, _ := queueDraftNotification(t, f, "")
	f.s.Send = func(context.Context, Delivery, Envelope) (Outcome, error) { return Outcome{Status: "SUCCEEDED"}, nil }
	pref := defaultPreferences()
	pref.SocialSets[setID] = map[string]bool{"post.publish_failed": false}
	pref.Events["post.publish_failed"] = Channels{}
	if _, err := f.s.SavePreferences(ctx, f.creator, pref); err != nil {
		t.Fatal(err)
	}
	for _, private := range []bool{false, true} {
		if private {
			execFixture(t, f, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.owner.UserID)
		}
		tx, err := f.s.DB.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err = emitSQL(ctx, tx, f.owner.OrganizationID, "post.publish_failed", "content_draft", draftID, f.owner.UserID, nil); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		var id string
		if err = tx.QueryRow(`SELECT id FROM outbox_event WHERE "organizationId"=$1 AND type='activity.post.publish_failed' ORDER BY "createdAt" DESC,id DESC LIMIT 1`, f.owner.OrganizationID).Scan(&id); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		if err = f.s.Process(ctx); err != nil {
			t.Fatal(err)
		}
		var count int
		if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_inbox WHERE event_id=$1 AND "userId"=$2`, id, f.creator.UserID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if (!private && count != 1) || (private && count != 0) {
			t.Fatal("required alert ignored source authorization", private, count)
		}
	}
}
