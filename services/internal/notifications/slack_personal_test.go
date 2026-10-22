package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func personalSlackFixture(t *testing.T, f fixture, p Principal, user string) *SlackConnection {
	t.Helper()
	grant := &slackGrant{AppID: "A" + f.owner.UserID, AccessToken: "fixture-token", Scope: strings.Join(slackScopes, ",")}
	grant.Team.ID, grant.Team.Name = "T123", "Fixture team"
	grant.AuthedUser.ID = user
	c, err := f.s.savePersonalSlack(context.Background(), p, grant, "")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func personalSlackServer(t *testing.T, f fixture, send func(http.ResponseWriter, *http.Request)) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth.test" {
			fmt.Fprint(w, `{"ok":true,"team_id":"T123"}`)
			return
		}
		send(w, r)
	}))
	t.Cleanup(server.Close)
	f.s.SlackBase = server.URL
}

func TestPersonalSlackOAuthOwnershipAndReconnect(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("SLACK_CLIENT_ID", "fixture-client")
	t.Setenv("SLACK_CLIENT_SECRET", "fixture-secret")
	var calls atomic.Int32
	slackUser := "U123"
	personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/oauth.v2.access" {
			t.Error("unexpected endpoint", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "app_id": "A" + strings.ToUpper(strings.ReplaceAll(f.owner.UserID, "_", "")), "access_token": "fixture-token", "scope": "chat:write", "team": map[string]string{"id": "T123", "name": "Fixture team"}, "authed_user": map[string]string{"id": slackUser}})
	})
	start := func() string {
		t.Helper()
		redirect, err := f.s.Connect(ctx, f.creator, "personal")
		if err != nil {
			t.Fatal(err)
		}
		u, _ := url.Parse(redirect)
		if u.Query().Get("scope") != "chat:write" {
			t.Fatal("personal flow requested unnecessary scopes")
		}
		return u.Query().Get("state")
	}
	state := start()
	if _, err := f.s.Callback(ctx, f.owner, state, "code"); err == nil {
		t.Fatal("another user consumed the attempt")
	}
	wrong := f.creator
	wrong.SessionID = f.owner.SessionID
	if _, err := f.s.Callback(ctx, wrong, state, "code"); err == nil {
		t.Fatal("another session consumed the attempt")
	}
	if calls.Load() != 0 {
		t.Fatal("invalid principal reached provider")
	}
	c, err := f.s.Callback(ctx, f.creator, state, "code")
	if err != nil || c.SlackUserID != "U123" {
		t.Fatal("creator could not connect their DM", err)
	}
	if _, err = f.s.Callback(ctx, f.creator, state, "code"); err == nil || calls.Load() != 1 {
		t.Fatal("callback replay exchanged another code")
	}
	ownerSettings, err := f.s.Settings(ctx, f.owner)
	if err != nil || ownerSettings.PersonalSlack != nil || len(ownerSettings.Connections) != 0 {
		t.Fatal("personal connection leaked into another user's/shared settings", err)
	}
	if err = f.s.DisconnectPersonalSlack(ctx, f.owner, c.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("owner disconnected another member's DM", err)
	}
	if _, err = f.s.Connect(ctx, f.creator, "notifications"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatal("personal flow granted shared admin access", err)
	}
	state = start()
	slackUser = "U456"
	if _, err = f.s.Callback(ctx, f.creator, state, "code"); err == nil {
		t.Fatal("reconnect silently changed Slack identity")
	}
	saved, err := personalSlack(ctx, f.s.DB, f.creator.OrganizationID, f.creator.UserID)
	if err != nil || saved.SlackUserID != "U123" || saved.ID != c.ID {
		t.Fatal("failed reconnect changed mapping", err)
	}
	state = start()
	slackUser = "U123"
	if _, err = f.s.Callback(ctx, f.creator, state, "code"); err != nil {
		t.Fatal("same-account reconnect failed", err)
	}
	if err = f.s.DisconnectPersonalSlack(ctx, f.creator, c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.s.Token(ctx, f.creator.OrganizationID, c.ID); err == nil {
		t.Fatal("personal connection became a shared publishing credential")
	}
}

func TestPersonalSlackRechecksAuthorityAfterProvider(t *testing.T) {
	for _, change := range []string{"membership", "session", "team", "missing_user"} {
		t.Run(change, func(t *testing.T) {
			f := notificationFixture(t)
			personalSlackServer(t, f, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider write") })
			// auth.test happens before the transaction; mutate authority while it is in flight.
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				team := "T123"
				switch change {
				case "membership":
					execFixture(t, f, `DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2`, f.creator.OrganizationID, f.creator.UserID)
				case "session":
					execFixture(t, f, `UPDATE session SET "activeOrganizationId"=$2 WHERE id=$1`, f.creator.SessionID, f.otherOrg)
				case "team":
					team = "TOTHER"
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "team_id": team})
			}))
			defer server.Close()
			f.s.SlackBase = server.URL
			grant := &slackGrant{AppID: "A123", AccessToken: "fixture-token", Scope: "chat:write"}
			grant.Team.ID = "T123"
			grant.AuthedUser.ID = "U123"
			if change == "missing_user" {
				grant.AuthedUser.ID = ""
			}
			if _, err := f.s.savePersonalSlack(context.Background(), f.creator, grant, ""); err == nil {
				t.Fatal("invalid authority or identity persisted")
			}
			var count int
			if err := f.s.DB.QueryRow(`SELECT count(*) FROM platform_slack_personal_connection WHERE "organizationId"=$1`, f.owner.OrganizationID).Scan(&count); err != nil || count != 0 {
				t.Fatal("failed callback left a connection", err)
			}
		})
	}
}

func TestPersonalSlackDeliveryIsPrivateAndIdempotent(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	var sends atomic.Int32
	personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat.postMessage" {
			t.Error("unexpected endpoint", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["channel"] != "U123" {
			t.Error("DM used an unverified destination")
		}
		sends.Add(1)
		fmt.Fprint(w, `{"ok":true,"channel":"D123","ts":"123.456"}`)
	})
	personalSlackFixture(t, f, f.owner, "U123")
	pref := defaultPreferences()
	pref.Events["generation.completed"] = Channels{Slack: true}
	if _, err := f.s.SavePreferences(ctx, f.owner, pref); err != nil {
		t.Fatal(err)
	}
	// Email master and an unselected shared channel do not suppress private DMs.
	execFixture(t, f, `INSERT INTO user_preference("userId","emailNotifications") VALUES($1,false)`, f.owner.UserID)
	event := f.event(t, "generation.completed", f.creator.UserID)
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	var id, status, receipt string
	if err := f.s.DB.QueryRow(`SELECT id,status,provider_receipt FROM platform_notification_delivery WHERE event_id=$1 AND channel='slack_dm'`, event).Scan(&id, &status, &receipt); err != nil || status != "SUCCEEDED" || receipt != "D123:123.456" || sends.Load() != 1 {
		t.Fatalf("DM result status=%s sends=%d err=%v", status, sends.Load(), err)
	}
	if _, err := f.s.DeliveryStatus(ctx, f.creator, id); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("another member read a DM receipt", err)
	}
	if _, err := f.s.DeliveryStatus(ctx, f.owner, id); err != nil {
		t.Fatal(err)
	}
	// Read and archive mutations operate only on the in-app occurrence.
	var inbox int
	if err := f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_inbox WHERE event_id=$1`, event).Scan(&inbox); err != nil || inbox != 0 {
		t.Fatal("DM generated an unwanted inbox row", err)
	}
}

func TestPersonalSlackDisconnectAndMembershipFenceQueuedWork(t *testing.T) {
	for _, change := range []string{"disconnect", "membership", "preferences", "workspace_policy"} {
		t.Run(change, func(t *testing.T) {
			f := notificationFixture(t)
			ctx := context.Background()
			personalSlackServer(t, f, func(http.ResponseWriter, *http.Request) { t.Error("cancelled DM reached provider") })
			shared := testSlackConnection(t, f)
			c := personalSlackFixture(t, f, f.creator, "U123")
			id, err := f.s.Test(ctx, f.creator, "slack_dm", "personal-test-key-123456")
			if err != nil {
				t.Fatal(err)
			}
			duplicate, err := f.s.Test(ctx, f.creator, "slack_dm", "personal-test-key-123456")
			if err != nil || duplicate != id {
				t.Fatal("test retry duplicated delivery", err)
			}
			switch change {
			case "disconnect":
				if err = f.s.DisconnectPersonalSlack(ctx, f.creator, c.ID); err != nil {
					t.Fatal(err)
				}
			case "membership":
				execFixture(t, f, `DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2`, f.creator.OrganizationID, f.creator.UserID)
			case "preferences":
				if _, err = f.s.SavePreferences(ctx, f.creator, defaultPreferences()); err != nil {
					t.Fatal(err)
				}
			case "workspace_policy":
				pol := defaultPolicy()
				pol.Availability.Slack = false
				if _, err = f.s.SavePolicy(ctx, f.owner, pol); err != nil {
					t.Fatal(err)
				}
			}
			if err = f.s.Process(ctx); err != nil {
				t.Fatal(err)
			}
			var status string
			if err = f.s.DB.QueryRow(`SELECT status FROM platform_notification_delivery WHERE id=$1`, id).Scan(&status); err != nil || status != "SKIPPED" {
				t.Fatal("cancelled DM not fenced", status, err)
			}
			if _, err = f.s.Token(ctx, f.owner.OrganizationID, shared.ID); err != nil {
				t.Fatal("personal change revoked shared installation", err)
			}
		})
	}
}

func TestPersonalSlackAmbiguousSendIsNotRetried(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	var sends atomic.Int32
	personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) { sends.Add(1); w.WriteHeader(503) })
	personalSlackFixture(t, f, f.creator, "U123")
	id, err := f.s.Test(ctx, f.creator, "slack_dm", "personal-uncertain-key")
	if err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	receipt, err := f.s.DeliveryStatus(ctx, f.creator, id)
	if err != nil || receipt.Status != "UNCERTAIN" || sends.Load() != 1 {
		t.Fatal("uncertain Slack write retried", err)
	}
	if _, err = f.s.DeliveryStatus(ctx, f.owner, id); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("admin could read another member's DM receipt", err)
	}
	if err = f.s.Recover(ctx, f.owner, id, "retry"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("admin could retry another member's DM", err)
	}
}

func TestPersonalSlackRetainsInstallationAfterSharedDisconnect(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	personalSlackServer(t, f, func(http.ResponseWriter, *http.Request) { t.Error("unexpected write") })
	shared := testSlackConnection(t, f)
	c := personalSlackFixture(t, f, f.creator, "U123")
	if err := f.s.Disconnect(ctx, f.owner, shared.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.s.personalSlackToken(ctx, f.creator.OrganizationID, f.creator.UserID, c.ID); err != nil {
		t.Fatal("shared disconnect revoked personal access", err)
	}
	if _, _, err := f.s.personalSlackToken(ctx, f.otherOrg, f.creator.UserID, c.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("cross-workspace token access", err)
	}
	if _, _, err := f.s.personalSlackToken(ctx, f.creator.OrganizationID, f.owner.UserID, c.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("cross-member token access", err)
	}
	// Health maintenance must retain installations used exclusively by personal DMs.
	if err := f.s.Maintain(ctx); err != nil {
		t.Fatal(err)
	}
	saved, err := personalSlack(ctx, f.s.DB, f.creator.OrganizationID, f.creator.UserID)
	if err != nil || saved == nil || saved.Health != "CONNECTED" {
		t.Fatal("maintenance removed personal installation", err)
	}
}

func TestPersonalSlackRefreshCannotOutliveMembership(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	var sends atomic.Int32
	personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/oauth.v2.access" {
			execFixture(t, f, `DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2`, f.creator.OrganizationID, f.creator.UserID)
			fmt.Fprint(w, `{"ok":true,"access_token":"new-fixture-token","refresh_token":"new-refresh","expires_in":43200}`)
			return
		}
		sends.Add(1)
		fmt.Fprint(w, `{"ok":true,"channel":"D123","ts":"1"}`)
	})
	c := personalSlackFixture(t, f, f.creator, "U123")
	raw, _ := json.Marshal(slackCredentials{AccessToken: "old-fixture", RefreshToken: "old-refresh"})
	sealed, err := seal(raw)
	if err != nil {
		t.Fatal(err)
	}
	execFixture(t, f, `UPDATE platform_slack_installation SET encrypted_credentials=$2,expires_at=now() WHERE id=(SELECT installation_id FROM platform_slack_personal_connection WHERE id=$1)`, c.ID, sealed)
	id, err := f.s.Test(ctx, f.creator, "slack_dm", "refresh-membership-key")
	if err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = f.s.DB.QueryRow(`SELECT status FROM platform_notification_delivery WHERE id=$1`, id).Scan(&status); err != nil || status != "UNCERTAIN" || sends.Load() != 0 {
		t.Fatal("refresh revived a removed member's delivery", status, err)
	}
}

func TestPersonalSlackGrantCannotReduceSharedScopes(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	personalSlackServer(t, f, func(http.ResponseWriter, *http.Request) { t.Error("unexpected write") })
	shared := testSlackConnection(t, f)
	g := &slackGrant{AppID: shared.AppID, AccessToken: "reduced-fixture-token", Scope: "chat:write"}
	g.Team.ID, g.Team.Name, g.AuthedUser.ID = shared.TeamID, shared.TeamName, "U123"
	if _, err := f.s.savePersonalSlack(ctx, f.creator, g, ""); err == nil {
		t.Fatal("personal grant removed shared scopes")
	}
	token, err := f.s.Token(ctx, f.owner.OrganizationID, shared.ID)
	if err != nil || token != "fixture-token" {
		t.Fatal("rejected grant changed shared credentials", err)
	}
}

func TestPersonalSlackTestDistinguishesMissingAndExpiredConnection(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	if _, err := f.s.Test(ctx, f.creator, "slack_dm", "missing-personal-connection"); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "connect your Slack account") {
		t.Fatal("missing personal connection was reported as backend configuration failure", err)
	}
	personalSlackServer(t, f, func(http.ResponseWriter, *http.Request) { t.Error("unexpected write") })
	c := personalSlackFixture(t, f, f.creator, "U123")
	execFixture(t, f, `UPDATE platform_slack_installation SET health='RECONNECT_REQUIRED' WHERE id=(SELECT installation_id FROM platform_slack_personal_connection WHERE id=$1)`, c.ID)
	if _, err := f.s.Test(ctx, f.creator, "slack_dm", "expired-personal-connection"); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "reconnect your Slack account") {
		t.Fatal("expired personal connection was reported as backend configuration failure", err)
	}
}
