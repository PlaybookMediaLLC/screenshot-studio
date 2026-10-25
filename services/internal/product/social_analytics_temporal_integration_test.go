package product

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/maintenance"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalmaintenance"
	"github.com/lucsky/cuid"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// Exercises a real Temporal schedule, registered production workflow and activity,
// maintenance advisory lock, and PostgreSQL observations. Only the remote metrics
// provider is a fixture: this does not certify live provider permissions or data.
func TestSocialAnalyticsTemporalSchedule(t *testing.T) {
	address := os.Getenv("PUBLISHING_TEST_TEMPORAL_ADDRESS")
	if address == "" {
		t.Skip("PUBLISHING_TEST_TEMPORAL_ADDRESS is not set")
	}
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{PlainText: "Analytics schedule"})
	if err != nil {
		t.Fatal(err)
	}
	set, err := w.repo.defaultSocialSet(w.ctx, w.org)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := w.db.Client.ChannelConnection.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetExternalAccountID("analytics").SetPlatform("x").SetSecretReference("fixture").SetCreatedByUserID(w.owner.UserID).SetSocialSetID(set.ID).Save(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = w.db.Client.ScheduledPost.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetChannelConnectionID(connection.ID).SetContentDraftID(draft.ID).SetSocialSetID(set.ID).SetScheduledFor(time.Now().Add(-time.Hour)).SetPublishedAt(time.Now().Add(-time.Minute)).SetStatus(scheduledpost.StatusPUBLISHED).SetRemotePostID("remote").SetCaption("Analytics schedule").SetIdempotencyKey(cuid.New()).Save(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	provider := &analyticsFixture{}
	w.repo.WithPostMetrics(provider)
	temporalClient, err := client.Dial(client.Options{HostPort: address})
	if err != nil {
		t.Fatal(err)
	}
	defer temporalClient.Close()
	queue := "analytics-test-" + cuid.New()
	consumer := worker.New(temporalClient, queue, worker.Options{})
	temporalmaintenance.Register(consumer, &maintenance.Store{DB: w.db.SQL, Analytics: w.repo})
	if err := consumer.Start(); err != nil {
		t.Fatal(err)
	}
	defer consumer.Stop()
	options := temporalmaintenance.ScheduleOptions("social-analytics")
	options.ID = queue
	action := options.Action.(*client.ScheduleWorkflowAction)
	action.ID, action.TaskQueue = queue, queue
	// Paused hourly cadence, explicitly triggered twice, to keep the test bounded.
	options.Paused = true
	handle, err := temporalClient.ScheduleClient().Create(w.ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Delete(context.Background())
	lastRun := ""
	for attempt := range 2 {
		if err := handle.Trigger(w.ctx, client.ScheduleTriggerOptions{}); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(w.ctx, 40*time.Second)
		defer cancel()
		for {
			description, err := handle.Describe(ctx)
			if err != nil {
				t.Fatal(err)
			}
			finished := false
			for _, result := range description.Info.RecentActions {
				run := result.StartWorkflowResult
				if run == nil || run.FirstExecutionRunID == lastRun {
					continue
				}
				var count int
				if err := temporalClient.GetWorkflow(ctx, run.WorkflowID, run.FirstExecutionRunID).Get(ctx, &count); err != nil {
					t.Fatal(err)
				}
				if attempt == 0 && count < 2 {
					t.Fatalf("collected only %d observations", count)
				}
				lastRun, finished = run.FirstExecutionRunID, true
				break
			}
			if finished {
				break
			}
			select {
			case <-ctx.Done():
				t.Fatal("schedule did not execute", ctx.Err())
			case <-time.After(100 * time.Millisecond):
			}
		}
	}
	rows, err := w.repo.ListSocialObservations(w.ctx, w.owner, set.ID, time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
	if err != nil || len(rows) != 2 {
		t.Fatalf("retry duplicated observations: %d %v", len(rows), err)
	}
	for _, row := range rows {
		if row.Kind == "post" && (row.Status != "available" || row.Metrics["likes"] != 7) {
			t.Fatalf("missing persisted metrics: %+v", row)
		}
		if row.Kind == "account" && (row.Status != "unavailable" || len(row.Metrics) != 0) {
			t.Fatal("unsupported account metrics fabricated")
		}
	}
}
