package product

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalmaintenance"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"os"
	"testing"
	"time"
)

// Optional real-Temporal verification. All provider and external notification
// transports are isolated; it creates no provider deployments or schedules.
func TestFrontendRealTemporalMaintenanceAndNotificationReceipt(t *testing.T) {
	address := os.Getenv("FRONTEND_TEMPORAL_TEST_ADDRESS")
	if address == "" {
		t.Skip("FRONTEND_TEMPORAL_TEST_ADDRESS is not set")
	}
	w, s := frontendTestSource(t)
	temporalClient, err := client.Dial(client.Options{HostPort: address})
	if err != nil {
		t.Fatal(err)
	}
	defer temporalClient.Close()
	notifier := notifications.New(w.db.SQL, w.db.Client)
	notifier.Send = func(context.Context, notifications.Delivery, notifications.Envelope) (notifications.Outcome, error) {
		t.Error("unexpected external notification")
		return notifications.Outcome{Status: "FAILED", Code: "TEST_BLOCKED"}, nil
	}
	queue := "frontend-test-" + w.id
	runtime := worker.New(temporalClient, queue, worker.Options{})
	temporalmaintenance.Register(runtime, temporalmaintenance.RunnerFunc(func(ctx context.Context, job string) (int, error) {
		if job == "frontend-deployments" {
			return w.repo.PollFrontends(ctx)
		}
		return 0, notifier.Process(ctx)
	}))
	if err := runtime.Start(); err != nil {
		t.Fatal(err)
	}
	defer runtime.Stop()
	run := func(job string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(w.ctx, 30*time.Second)
		defer cancel()
		execution, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: queue + "-" + job, TaskQueue: queue}, temporalmaintenance.WorkflowName, job)
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := execution.Get(ctx, &count); err != nil {
			t.Fatal(err)
		}
	}
	run("frontend-deployments")
	raw := frontendVercel("deployment.promoted", "native-temporal-event", "native-temporal-deployment", time.Now())
	if err := w.repo.AcceptFrontendWebhook(w.ctx, s.ID, frontendSignature(raw), raw); err != nil {
		t.Fatal(err)
	}
	run("notifications")
	var count int
	if err := w.db.SQL.QueryRowContext(w.ctx, `SELECT count(*) FROM platform_notification_inbox WHERE "organizationId"=$1 AND kind='frontend.succeeded'`, w.org).Scan(&count); err != nil || count != 1 {
		t.Fatalf("inbox receipts %d %v", count, err)
	}
}
