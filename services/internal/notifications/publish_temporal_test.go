package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalmaintenance"
	"github.com/lucsky/cuid"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// Production dispatch through a real Temporal worker and PostgreSQL. Only Slack
// is an HTTP fixture; no live external message is sent by this test.
func TestPublishSlackRoutingThroughTemporal(t *testing.T) {
	address := os.Getenv("PUBLISHING_TEST_TEMPORAL_ADDRESS")
	if address == "" {
		t.Skip("PUBLISHING_TEST_TEMPORAL_ADDRESS is not set")
	}
	f := notificationFixture(t)
	connection := testSlackConnection(t, f)
	setID, draftID, eventID := queueDraftNotification(t, f, connection.ID)
	// Re-project with the brand route, rather than the workspace fallback.
	execFixture(t, f, `DELETE FROM platform_notification_delivery WHERE event_id=$1`, eventID)
	execFixture(t, f, `DELETE FROM platform_notification_inbox WHERE event_id=$1`, eventID)
	execFixture(t, f, `UPDATE outbox_event SET notification_fanned=false WHERE id=$1`, eventID)
	routes, _ := json.Marshal(map[string]SlackDestination{setID: {ChannelID: "C456", ChannelName: "brand"}})
	execFixture(t, f, `UPDATE platform_notification_policy SET social_set_slack_channels=$2 WHERE "organizationId"=$1`, f.owner.OrganizationID, routes)
	var sends atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/conversations.info":
			fmt.Fprint(w, `{"ok":true,"channel":{"id":"C456","name":"brand","is_member":true}}`)
		case "/api/chat.postMessage":
			var body struct {
				Channel string `json:"channel"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body.Channel != "C456" {
				t.Error("wrong Slack destination", body.Channel)
			}
			sends.Add(1)
			fmt.Fprint(w, `{"ok":true,"channel":"C456","ts":"123.456"}`)
		default:
			t.Error("unexpected provider request", r.URL.Path)
			w.WriteHeader(400)
		}
	}))
	defer provider.Close()
	f.s.SlackBase = provider.URL
	c, err := client.Dial(client.Options{HostPort: address})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	queue := "publish-notification-test-" + cuid.New()
	w := worker.New(c, queue, worker.Options{})
	temporalmaintenance.Register(w, temporalmaintenance.RunnerFunc(func(ctx context.Context, job string) (int, error) {
		if job != "notifications" {
			return 0, errors.New("unexpected fixture job")
		}
		err := f.s.Process(ctx)
		if err != nil {
			t.Logf("notification dispatch error: %v", err)
		}
		return 0, err
	}))
	if err := w.Start(); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()
	run := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		workflow, err := c.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: queue + "-" + cuid.New(), TaskQueue: queue}, "platform-maintenance-v1", "notifications")
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := workflow.Get(ctx, &count); err != nil {
			_ = c.TerminateWorkflow(context.Background(), workflow.GetID(), workflow.GetRunID(), "fixture cleanup")
			t.Fatal(err)
		}
	}
	run()
	run()
	if sends.Load() != 1 {
		t.Fatalf("duplicate or missing delivery: %d", sends.Load())
	}
	assertDeliveryOutcome(t, f, eventID, "slack", "SUCCEEDED", "", 1)
	// A later publish event with this draft's skip preference produces no Slack call.
	execFixture(t, f, `UPDATE content_draft SET "suppressSlackOnPublish"=true WHERE id=$1`, draftID)
	tx, err := f.s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := emitSQL(context.Background(), tx, f.owner.OrganizationID, "post.published", "content_draft", draftID, f.owner.UserID, nil); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	run()
	if sends.Load() != 1 {
		t.Fatal("skipped draft delivered to Slack")
	}
}
