package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/lucsky/cuid"
)

func TestPublishSlackSetRoutingAndDraftSkip(t *testing.T) {
	for _, mode := range []string{"set_channel", "disabled_set", "skip_before_projection", "skip_after_projection", "skip_during_validation", "private"} {
		t.Run(mode, func(t *testing.T) {
			f := notificationFixture(t)
			ctx := context.Background()
			connection := testSlackConnection(t, f)
			setID, draftID, firstEvent := queueDraftNotification(t, f, connection.ID)
			// Discard this fixture's queued deliveries before testing new projections.
			execFixture(t, f, `DELETE FROM platform_notification_delivery WHERE event_id=$1`, firstEvent)
			var sends atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/conversations.info":
					if mode == "skip_during_validation" {
						execFixture(t, f, `UPDATE content_draft SET "suppressSlackOnPublish"=true WHERE id=$1`, draftID)
					}
					if err := r.ParseForm(); err != nil {
						t.Error(err)
					}
					if r.Form.Get("channel") != "C456" {
						t.Error("validated wrong channel")
					}
					fmt.Fprint(w, `{"ok":true,"channel":{"id":"C456","name":"brand","is_member":true}}`)
				case "/api/chat.postMessage":
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					if body["channel"] != "C456" {
						t.Error("sent to workspace fallback", body["channel"])
					}
					sends.Add(1)
					fmt.Fprint(w, `{"ok":true,"channel":"C456","ts":"123.456"}`)
				default:
					t.Error("unexpected provider path", r.URL.Path)
					w.WriteHeader(400)
				}
			}))
			defer server.Close()
			f.s.SlackBase = server.URL
			channel := "C456"
			if mode == "disabled_set" {
				channel = ""
			}
			routes, _ := json.Marshal(map[string]SlackDestination{setID: {ChannelID: channel, ChannelName: "brand"}})
			execFixture(t, f, `UPDATE platform_notification_policy SET social_set_slack_channels=$2 WHERE "organizationId"=$1`, f.owner.OrganizationID, routes)
			if mode == "skip_before_projection" {
				execFixture(t, f, `UPDATE content_draft SET "suppressSlackOnPublish"=true WHERE id=$1`, draftID)
			}
			if mode == "private" {
				execFixture(t, f, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.owner.UserID)
			}
			tx, err := f.s.DB.Begin()
			if err != nil {
				t.Fatal(err)
			}
			if err = emitSQL(ctx, tx, f.owner.OrganizationID, "post.published", "content_draft", draftID, f.owner.UserID, nil); err != nil {
				tx.Rollback()
				t.Fatal(err)
			}
			if err = tx.Commit(); err != nil {
				t.Fatal(err)
			}
			for range 100 {
				ok, err := f.s.fanout(ctx)
				if err != nil {
					t.Fatal(err)
				}
				if !ok {
					break
				}
			}
			if mode == "skip_after_projection" {
				execFixture(t, f, `UPDATE content_draft SET "suppressSlackOnPublish"=true WHERE id=$1`, draftID)
			}
			for range 2 {
				if err = f.s.Process(ctx); err != nil {
					t.Fatal(err)
				}
			}
			want := int32(0)
			if mode == "set_channel" {
				want = 1
			}
			if sends.Load() != want {
				t.Fatalf("sent=%d want=%d", sends.Load(), want)
			}
			var successes int
			if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE "organizationId"=$1 AND channel='in_app' AND event_id<>$2 AND status<>'SKIPPED'`, f.owner.OrganizationID, firstEvent).Scan(&successes); err != nil {
				t.Fatal(err)
			}
			if mode != "private" && successes == 0 {
				t.Fatal("Slack preference suppressed personal activity")
			}
		})
	}
}

func TestSaveSlackSetDestinationsValidatesWorkspaceAndProvider(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	connection := testSlackConnection(t, f)
	setID := cuid.New()
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES($1,$2,'Brand',$1)`, setID, f.owner.OrganizationID)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"ok":true,"channel":{"id":"C456","name":"verified","is_member":true}}`)
	}))
	defer server.Close()
	f.s.SlackBase = server.URL
	policy := defaultPolicy()
	policy.SlackConnectionID = connection.ID
	policy.SocialSetSlackChannels = map[string]SlackDestination{setID: {ChannelID: "C456", ChannelName: "forged"}}
	saved, err := f.s.SavePolicy(ctx, f.owner, policy)
	if err != nil || saved.Policy.SocialSetSlackChannels[setID].ChannelName != "verified" {
		t.Fatal("route not verified", saved, err)
	}
	if !saved.Policy.Events["post.published"].Slack {
		t.Fatal("publish notice not enabled by default")
	}
	policy.SocialSetSlackChannels = nil
	saved, err = f.s.SavePolicy(ctx, f.owner, policy)
	if err != nil || saved.Policy.SocialSetSlackChannels[setID].ChannelID != "C456" {
		t.Fatal("older client erased routes", err)
	}
	policy.SocialSetSlackChannels = map[string]SlackDestination{cuid.New(): {ChannelID: ""}}
	if _, err = f.s.SavePolicy(ctx, f.owner, policy); err == nil {
		t.Fatal("unknown set accepted")
	}
	execFixture(t, f, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, setID, f.owner.UserID)
	policy.SocialSetSlackChannels = map[string]SlackDestination{setID: {ChannelID: ""}}
	if _, err = f.s.SavePolicy(ctx, f.owner, policy); err == nil {
		t.Fatal("private set shared-channel route accepted")
	}
}
