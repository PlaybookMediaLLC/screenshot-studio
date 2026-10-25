package notifications

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

func TestPreferenceCeilingAndRestrictedChannels(t *testing.T) {
	d, _ := activity.Lookup("campaign_posts.submitted")
	for _, tc := range []struct{ workspace, personal, want bool }{{false, false, false}, {false, true, false}, {true, false, false}, {true, true, true}} {
		p, pref := defaultPolicy(), defaultPreferences()
		p.Events[d.ID] = Channels{Email: tc.workspace}
		pref.Events[d.ID] = Channels{Email: tc.personal}
		if got := enabled(p, pref, d, "email"); got != tc.want {
			t.Errorf("policy=%v personal=%v got=%v", tc.workspace, tc.personal, got)
		}
	}
	if validEvents(map[string]Channels{d.ID: {Slack: true}}, false) {
		t.Fatal("restricted Slack stream accepted")
	}
	if !validEvents(map[string]Channels{"capture.completed": {Slack: true}}, true) {
		t.Fatal("personal preferences cannot configure Slack DMs")
	}
	if validEvents(map[string]Channels{"invented": {InApp: true}}, false) {
		t.Fatal("unknown event accepted")
	}
	for _, d := range activity.Catalogue {
		p := defaultPolicy()
		// Publish success is on after a user connects a verified destination;
		// every other shared-channel event still requires explicit opt-in.
		if !p.Events[d.ID].InApp || p.Events[d.ID].Slack != (d.ID == "post.published") {
			t.Fatalf("unexpected default for %s", d.ID)
		}
		p.Availability = &Channels{}
		if enabled(p, defaultPreferences(), d, "in_app") || enabled(p, defaultPreferences(), d, "email") {
			t.Fatalf("disabled channel bypassed for %s", d.ID)
		}
	}
}
func TestCredentialTamperingAndVersion(t *testing.T) {
	t.Setenv("PLATFORM_NOTIFICATION_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	sealed, err := seal([]byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	clear, err := unseal(sealed)
	if err != nil || string(clear) != "secret" {
		t.Fatalf("decrypt=%q err=%v", clear, err)
	}
	for _, bad := range []string{"", "v2.AA", sealed[:len(sealed)-4] + "AAAA", "v1." + sealed} {
		if _, err = unseal(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	t.Setenv("PLATFORM_NOTIFICATION_ENCRYPTION_KEY", "")
	if _, err = seal([]byte("secret")); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
}
func TestSlackResponseAndSafeFallback(t *testing.T) {
	if got := escapeSlack("<@U123> & <!channel>"); got != "&lt;@U123&gt; &amp; &lt;!channel&gt;" {
		t.Fatal(got)
	}
	for _, tc := range []struct {
		name, body string
		status     int
		uncertain  bool
		retry      bool
	}{
		{"accepted", `{"ok":true,"ts":"123"}`, 200, false, false},
		{"empty", `{}`, 200, true, false}, {"malformed", `<html>error</html>`, 200, true, false},
		{"fatal", `{"ok":false,"error":"fatal_error"}`, 200, true, false},
		{"revoked", `{"ok":false,"error":"token_revoked"}`, 200, false, false},
		{"rate", ``, 429, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture-token" {
					t.Error("missing bearer")
				}
				w.Header().Set("Retry-After", "7")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			s := &Service{HTTP: server.Client(), SlackBase: server.URL}
			_, err := s.slackAPI(context.Background(), "fixture-token", "chat.postMessage", map[string]any{"text": "test"})
			if tc.name == "accepted" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var failure *slackError
			if !errors.As(err, &failure) || failure.Uncertain != tc.uncertain || (failure.RetryAfter > 0) != tc.retry {
				t.Fatalf("outcome=%+v err=%v", failure, err)
			}
		})
	}
}
func TestSlackReadRequestParameters(t *testing.T) {
	for _, tc := range []struct {
		method  string
		payload map[string]any
		want    map[string]string
	}{
		{"auth.test", map[string]any{}, map[string]string{}},
		{"conversations.info", map[string]any{"channel": "C123"}, map[string]string{"channel": "C123"}},
		{"conversations.list", map[string]any{"cursor": "page+two/=", "limit": 200, "exclude_archived": true, "types": "public_channel,private_channel"}, map[string]string{"cursor": "page+two/=", "limit": "200", "exclude_archived": "true", "types": "public_channel,private_channel"}},
		{"chat.getPermalink", map[string]any{"channel": "C123", "message_ts": "123.456"}, map[string]string{"channel": "C123", "message_ts": "123.456"}},
	} {
		t.Run(tc.method, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Slack ignores JSON bodies on these read endpoints.
				if r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" || r.ParseForm() != nil {
					t.Error("read request did not use form encoding")
					_, _ = w.Write([]byte(`{"ok":false,"error":"invalid_arguments"}`))
					return
				}
				for key, want := range tc.want {
					if got := r.PostForm.Get(key); got != want {
						t.Errorf("%s = %q, want %q", key, got, want)
					}
				}
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer server.Close()
			s := &Service{HTTP: server.Client(), SlackBase: server.URL}
			if _, err := s.slackAPI(context.Background(), "fixture-token", tc.method, tc.payload); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEmailIdempotencyAndUncertainAcceptance(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "fixture-key")
	t.Setenv("AUTH_EMAIL_FROM", "Workspace <sender@example.test>")
	var status atomic.Int32
	status.Store(200)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Idempotency-Key") != "workspace-activity/delivery-one" {
			t.Error("unstable idempotency key")
		}
		var payload map[string]any
		if json.NewDecoder(r.Body).Decode(&payload) != nil || payload["text"] == nil || payload["html"] == nil {
			t.Error("missing email alternatives")
		}
		w.WriteHeader(int(status.Load()))
		_, _ = w.Write([]byte(`{"id":"provider-receipt"}`))
	}))
	defer server.Close()
	s := &Service{HTTP: server.Client(), EmailBase: server.URL}
	d := Delivery{ID: "delivery-one", Channel: "email"}
	env := Envelope{To: "person@example.test", Subject: "Activity", Text: "Plain", HTML: "<p>Plain</p>"}
	out, err := s.send(context.Background(), d, env)
	if err != nil || out.Status != "SUCCEEDED" || out.Receipt != "provider-receipt" {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	status.Store(500)
	out, err = s.send(context.Background(), d, env)
	if err != nil || out.Status != "UNCERTAIN" {
		t.Fatalf("potential acceptance retried: %+v %v", out, err)
	}
	status.Store(429)
	out, err = s.send(context.Background(), d, env)
	if err != nil || out.Status != "PENDING" {
		t.Fatalf("rate limit outcome: %+v %v", out, err)
	}
}

type fixture struct {
	s                  *Service
	owner, creator     Principal
	otherOrg, campaign string
}

func notificationFixture(t *testing.T) fixture {
	t.Helper()
	databaseURL := os.Getenv("NOTIFICATIONS_TEST_DATABASE_URL")
	if databaseURL == "" {
		databaseURL = os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	}
	if databaseURL == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	db, err := database.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err = db.SQL.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %s: %v", name, err)
	}
	id := cuid.New()
	f := fixture{s: New(db.SQL, db.Client), owner: Principal{OrganizationID: "org_" + id, UserID: "owner_" + id, SessionID: "owner_session_" + id}, creator: Principal{OrganizationID: "org_" + id, UserID: "creator_" + id, SessionID: "creator_session_" + id}, otherOrg: "other_" + id, campaign: "campaign_" + id}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, org := range []string{f.owner.OrganizationID, f.otherOrg} {
		exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,'Notification workspace',$1,now())`, org)
	}
	for _, p := range []Principal{f.owner, f.creator} {
		role := "creator"
		if p.UserID == f.owner.UserID {
			role = "owner"
		}
		exec(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,now(),now())`, p.UserID, p.UserID+"@example.test")
		exec(`INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())`, cuid.New(), p.OrganizationID, p.UserID, role)
		exec(`INSERT INTO session(id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`, p.SessionID, p.UserID, p.OrganizationID)
	}
	exec(`UPDATE outbox_event SET notification_fanned=true WHERE "organizationId"=$1`, f.owner.OrganizationID)
	exec(`INSERT INTO campaign(id,"organizationId",name,objective,"createdByUserId","updatedAt") VALUES($1,$2,'Private campaign title','Test',$3,now())`, f.campaign, f.owner.OrganizationID, f.owner.UserID)
	t.Cleanup(func() {
		tx, err := db.SQL.Begin()
		if err != nil {
			t.Error(err)
			return
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`SELECT set_config('shots.audit_retention','on',true)`); err != nil {
			t.Error(err)
			return
		}
		for _, statement := range []string{`DELETE FROM audit_log WHERE "organizationId" IN ($1,$2)`, `DELETE FROM organization WHERE id IN ($1,$2)`} {
			if _, err = tx.Exec(statement, f.owner.OrganizationID, f.otherOrg); err != nil {
				t.Error("fixture workspace cleanup", err)
				return
			}
		}
		if _, err = tx.Exec(`DELETE FROM "user" WHERE id IN ($1,$2)`, f.owner.UserID, f.creator.UserID); err != nil {
			t.Error("fixture user cleanup", err)
			return
		}
		if err = tx.Commit(); err != nil {
			t.Error(err)
		}
	})
	t.Setenv("PLATFORM_NOTIFICATION_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	t.Setenv("BETTER_AUTH_URL", "https://app.example.test")
	return f
}
func (f fixture) event(t *testing.T, kind, actor string) string {
	t.Helper()
	tx, err := f.s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = emitSQL(context.Background(), tx, f.owner.OrganizationID, kind, "campaign", f.campaign, actor, nil); err != nil {
		t.Fatal(err)
	}
	var id string
	if err = tx.QueryRow(`SELECT id FROM outbox_event WHERE "organizationId"=$1 ORDER BY "createdAt" DESC,id DESC LIMIT 1`, f.owner.OrganizationID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestCampaignReviewRecipientsDoNotExpandAcrossRelease(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("RESEND_API_KEY", "fixture")
	releaseID := "release_" + f.campaign
	execFixture(t, f, `INSERT INTO release(id,"organizationId",title,"benefitStatement","updatedAt") VALUES($1,$2,'Release','Benefit',now())`, releaseID, f.owner.OrganizationID)
	execFixture(t, f, `UPDATE campaign SET "releaseId"=$2 WHERE id=$1`, f.campaign, releaseID)
	execFixture(t, f, `INSERT INTO campaign(id,"organizationId",name,objective,"createdByUserId","releaseId","updatedAt") VALUES($1,$2,'Other campaign','Test',$3,$4,now())`, "other_"+f.campaign, f.owner.OrganizationID, f.creator.UserID, releaseID)
	event := f.event(t, "campaign_posts.decided", "")
	sends := 0
	f.s.Send = func(_ context.Context, d Delivery, _ Envelope) (Outcome, error) {
		sends++
		if d.Destination != f.owner.UserID {
			t.Error("review email reached another campaign's creator")
		}
		return Outcome{Status: "SUCCEEDED"}, nil
	}
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	var deliveries, foreign int
	if err := f.s.DB.QueryRow(`SELECT count(*),count(*) FILTER (WHERE destination<>$2) FROM platform_notification_delivery WHERE event_id=$1`, event, f.owner.UserID).Scan(&deliveries, &foreign); err != nil {
		t.Fatal(err)
	}
	if sends != 1 || deliveries != 3 || foreign != 0 {
		t.Fatalf("review sends=%d deliveries=%d foreign=%d", sends, deliveries, foreign)
	}
	def, _ := activity.Lookup("release.ingested")
	recipients, err := f.s.recipients(ctx, occurrence{org: f.owner.OrganizationID, kind: def.ID, resourceType: "release", resourceID: releaseID}, def)
	if err != nil || len(recipients) != 2 {
		t.Fatalf("release activity lost its campaign creators: %v %v", recipients, err)
	}
}

func TestInboxIsolationAcknowledgmentReplayAndMarkAll(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	event := f.event(t, "generation.completed", f.creator.UserID)
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		page, err := f.s.List(ctx, f.owner, "")
		if err != nil || len(page.Items) != 1 || page.UnseenCount != 1 {
			t.Fatalf("read mutated inbox: %+v %v", page, err)
		}
	}
	page, _ := f.s.List(ctx, f.owner, "")
	foreign := f.owner
	foreign.OrganizationID = f.otherOrg
	if _, err := f.s.List(ctx, foreign, ""); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("cross-workspace read: %v", err)
	}
	result, err := f.s.Seen(ctx, f.creator, []string{page.Items[0].ID}, false, "")
	if err != nil || result.Deleted != 0 {
		t.Fatalf("another recipient deleted row: %+v %v", result, err)
	}
	result, err = f.s.Seen(ctx, f.owner, []string{page.Items[0].ID}, false, "")
	if err != nil || result.Deleted != 1 {
		t.Fatalf("seen=%+v %v", result, err)
	}
	var present int
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_inbox WHERE id=$1`, page.Items[0].ID).Scan(&present); err != nil || present != 1 {
		t.Fatal("read receipt was removed from database")
	}
	if _, err = f.s.DB.Exec(`UPDATE outbox_event SET notification_fanned=false WHERE id=$1`, event); err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	n, err := f.s.Count(ctx, f.owner)
	if err != nil || n != 0 {
		t.Fatalf("replay reset read state: %d %v", n, err)
	}
	f.event(t, "generation.completed", f.creator.UserID)
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	key := cuid.New()
	if _, err = f.s.Seen(ctx, f.owner, nil, true, key); err != nil {
		t.Fatal(err)
	}
	f.event(t, "generation.completed", f.creator.UserID)
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	result, err = f.s.Seen(ctx, f.owner, nil, true, key)
	if err != nil || result.Deleted != 1 || result.UnseenCount != 1 {
		t.Fatalf("mark-all retry swallowed arrivals: %+v %v", result, err)
	}
	if _, err = f.s.DB.Exec(`DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2`, f.owner.OrganizationID, f.owner.UserID); err != nil {
		t.Fatal(err)
	}
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_inbox WHERE "organizationId"=$1 AND "userId"=$2`, f.owner.OrganizationID, f.owner.UserID).Scan(&present); err != nil || present != 0 {
		t.Fatal("membership removal retained inbox")
	}
}
func TestConcurrentFanoutAndQueuedOptOut(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("RESEND_API_KEY", "fixture-only")
	event := f.event(t, "campaign_posts.submitted", f.creator.UserID)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := f.s.fanout(ctx); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE event_id=$1`, event).Scan(&n); err != nil || n != 3 {
		t.Fatalf("expected one decision per channel: %d %v", n, err)
	}
	var skipped int
	if err := f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE event_id=$1 AND channel='slack_dm' AND status='SKIPPED' AND failure_code='CATEGORY_DISABLED'`, event).Scan(&skipped); err != nil || skipped != 1 {
		t.Fatal("missing single Slack opt-out decision", skipped, err)
	}
	pref := defaultPreferences()
	pref.Events["campaign_posts.submitted"] = Channels{InApp: true, Email: false}
	if _, err := f.s.SavePreferences(ctx, f.owner, pref); err != nil {
		t.Fatal(err)
	}
	called := false
	f.s.Send = func(context.Context, Delivery, Envelope) (Outcome, error) {
		called = true
		return Outcome{Status: "SUCCEEDED"}, nil
	}
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("queued email ignored opt out")
	}
	var status string
	if err := f.s.DB.QueryRow(`SELECT status FROM platform_notification_delivery WHERE event_id=$1 AND channel='email'`, event).Scan(&status); err != nil || status != "SKIPPED" {
		t.Fatalf("opt-out status=%s %v", status, err)
	}
}
func TestOAuthStateBoundToSessionWorkspaceAndSingleUse(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("SLACK_CLIENT_ID", "fixture-client")
	t.Setenv("SLACK_CLIENT_SECRET", "fixture-secret")
	t.Setenv("PLATFORM_SLACK_CALLBACK_URL", "http://localhost:3000/api/integrations/slack/callback")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"ok":true,"app_id":"A123","access_token":"fixture-token","team":{"id":"T123","name":"Fixture team"},"scope":"chat:write,channels:read,groups:read,files:write,channels:join"}`))
	}))
	defer server.Close()
	f.s.SlackBase = server.URL
	redirect, err := f.s.Connect(ctx, f.owner, "notifications")
	if err != nil {
		t.Fatal(err)
	}
	state := strings.Split(strings.Split(redirect, "state=")[1], "&")[0]
	wrong := f.owner
	wrong.SessionID = f.creator.SessionID
	if _, err = f.s.Callback(ctx, wrong, state, "fixture-code"); err == nil {
		t.Fatal("wrong session accepted")
	}
	wrong = f.owner
	wrong.OrganizationID = f.otherOrg
	if _, err = f.s.Callback(ctx, wrong, state, "fixture-code"); err == nil {
		t.Fatal("changed workspace accepted")
	}
	connection, err := f.s.Callback(ctx, f.owner, state, "fixture-code")
	if err != nil || connection.TeamID != "T123" {
		t.Fatalf("callback=%+v %v", connection, err)
	}
	if _, err = f.s.Callback(ctx, f.owner, state, "fixture-code"); err == nil {
		t.Fatal("state replay accepted")
	}
	if calls != 1 {
		t.Fatalf("exchanged %d times", calls)
	}
	redirect, err = f.s.Connect(ctx, f.owner, "notifications")
	if err != nil {
		t.Fatal(err)
	}
	state = strings.Split(strings.Split(redirect, "state=")[1], "&")[0]
	if _, err = f.s.DB.Exec(`UPDATE social_oauth_start SET "expiresAt"=now()-interval '1 second' WHERE state=$1`, state); err != nil {
		t.Fatal(err)
	}
	if _, err = f.s.Callback(ctx, f.owner, state, "fixture-code"); err == nil {
		t.Fatal("expired state accepted")
	}
	redirect, err = f.s.Connect(ctx, f.owner, "notifications")
	if err != nil {
		t.Fatal(err)
	}
	state = strings.Split(strings.Split(redirect, "state=")[1], "&")[0]
	execFixture(t, f, `UPDATE member SET role='viewer' WHERE "organizationId"=$1 AND "userId"=$2`, f.owner.OrganizationID, f.owner.UserID)
	if _, err = f.s.Callback(ctx, f.owner, state, "fixture-code"); err == nil || calls != 1 {
		t.Fatal("lost administrator permission exchanged an OAuth code", err)
	}
}
func TestRetryAfter(t *testing.T) {
	if retryAfter("12") != 12*time.Second {
		t.Fatal("numeric Retry-After ignored")
	}
	if retryAfter("invalid") <= 0 {
		t.Fatal("invalid delay not bounded")
	}
}
