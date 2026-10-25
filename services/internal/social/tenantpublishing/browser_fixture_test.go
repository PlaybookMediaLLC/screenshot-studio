//go:build e2e

package tenantpublishing

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/config"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/maintenance"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/e2eprovider"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalmaintenance"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// The production publisher retains account lookup, verification, media signing,
// immutable commands, receipts and authorization. Only its final provider peer
// is replaced in this opt-in test binary; no production resolver can use it.
type browserFixtureProvider struct{ *e2eprovider.Provider }

var _ integrations.PostAnalytics = browserFixtureProvider{}

func (p browserFixtureProvider) PostAnalytics(ctx context.Context, id, token, postID string, _ int64) ([]integrations.AnalyticsData, error) {
	likes, reposts, err := p.PostEngagement(ctx, &socialent.Integration{Token: token}, postID)
	if err != nil {
		return nil, err
	}
	date := time.Now().UTC().Format(time.DateOnly)
	return []integrations.AnalyticsData{
		{Label: "likes", Data: []integrations.AnalyticsItem{{Date: date, Total: fmt.Sprint(likes)}}},
		{Label: "reposts", Data: []integrations.AnalyticsItem{{Date: date, Total: fmt.Sprint(reposts)}}},
	}, nil
}

func TestTypefullyBrowserWorker(t *testing.T) {
	if os.Getenv("TYPEFULLY_E2E_WORKER") != "1" {
		t.Skip("isolated browser worker is opt-in")
	}
	cfg, err := config.LoadOrchestrator()
	if err != nil {
		t.Fatal(err)
	}
	dbURL, err := url.Parse(cfg.DatabaseURL)
	if err != nil || !strings.Contains(dbURL.Path, "test") || net.ParseIP(dbURL.Hostname()) == nil || !net.ParseIP(dbURL.Hostname()).IsLoopback() {
		t.Fatal("worker requires an isolated local test database")
	}
	endpoint, err := url.Parse(os.Getenv("SOCIAL_E2E_URL"))
	if err != nil || endpoint.Scheme != "http" || net.ParseIP(endpoint.Hostname()) == nil || !net.ParseIP(endpoint.Hostname()).IsLoopback() {
		t.Fatal("worker requires a loopback HTTP provider fixture")
	}
	host, _, err := net.SplitHostPort(cfg.Address)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() || !strings.HasPrefix(cfg.WorkflowTaskQueue, "typefully-e2e-") || !strings.HasPrefix(cfg.ActivityTaskQueue, "typefully-e2e-") {
		t.Fatal("worker requires isolated local Temporal queues")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tc, err := client.Dial(client.Options{HostPort: cfg.Address, Namespace: cfg.Namespace})
	if err != nil {
		t.Fatal(err)
	}
	defer tc.Close()
	if err := temporalpublishing.RegisterSearchAttributes(ctx, tc, cfg.Namespace); err != nil {
		t.Fatal(err)
	}
	objects, err := media.NewS3StoreFromEnvironment()
	if err != nil || objects == nil {
		t.Fatal("object storage unavailable", err)
	}
	repository := publishing.NewRepository(db.Client)
	provider, closeShared, err := OpenShared(ctx, cfg.DatabaseURL, repository, media.NewTenantObjects(objects))
	if err != nil {
		t.Fatal(err)
	}
	defer closeShared()
	provider.resolve = func(platform string) poster {
		if platform != "x" {
			return nil
		}
		return browserFixtureProvider{e2eprovider.New(endpoint.String())}
	}
	a := temporalpublishing.NewActivities(repository, provider)
	ww := worker.New(tc, cfg.WorkflowTaskQueue, worker.Options{})
	ww.RegisterWorkflowWithOptions(temporalpublishing.PostWorkflowV2, workflow.RegisterOptions{Name: temporalpublishing.WorkflowNameV2})
	ww.RegisterWorkflowWithOptions(temporalpublishing.MissingPostWorkflow, workflow.RegisterOptions{Name: temporalpublishing.MissingWorkflowName})
	ww.RegisterActivityWithOptions(a.Prepare, activity.RegisterOptions{Name: temporalpublishing.PrepareActivityName})
	ww.RegisterActivityWithOptions(a.Begin, activity.RegisterOptions{Name: temporalpublishing.BeginActivityName})
	ww.RegisterActivityWithOptions(a.CompleteV2, activity.RegisterOptions{Name: temporalpublishing.CompleteActivityName})
	ww.RegisterActivityWithOptions(a.FailV2, activity.RegisterOptions{Name: temporalpublishing.FailActivityName})
	ww.RegisterActivityWithOptions(a.MarkUnknown, activity.RegisterOptions{Name: temporalpublishing.MarkUnknownActivityName})
	ww.RegisterActivityWithOptions(a.PlanAutomations, activity.RegisterOptions{Name: temporalpublishing.PlanAutomationsActivityName})
	aw := worker.New(tc, cfg.ActivityTaskQueue, worker.Options{DisableWorkflowWorker: true})
	aw.RegisterActivityWithOptions(a.Submit, activity.RegisterOptions{Name: temporalpublishing.SubmitActivityName})
	aw.RegisterActivityWithOptions(a.RunAutoActions, activity.RegisterOptions{Name: temporalpublishing.AutoActionsActivityName})
	aw.RegisterActivityWithOptions(a.RunAutomation, activity.RegisterOptions{Name: temporalpublishing.RunAutomationActivityName})
	aw.RegisterActivityWithOptions(a.Check, activity.RegisterOptions{Name: temporalpublishing.CheckActivityName})
	store := product.NewConfiguration(db.Client).WithPostMetrics(provider)
	mw := worker.New(tc, "typefully-e2e-maintenance", worker.Options{})
	temporalmaintenance.Register(mw, &maintenance.Store{DB: db.SQL, Analytics: store, Activity: notifications.New(db.SQL, db.Client)})
	for _, w := range []worker.Worker{ww, aw, mw} {
		if err := w.Start(); err != nil {
			t.Fatal(err)
		}
		defer w.Stop()
	}
	t.Log("Typefully browser worker ready")
	// Exercise the registered maintenance workflow, not a direct metric-table seed.
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, job := range []string{"social-analytics", "notifications"} {
				run, err := tc.ExecuteWorkflow(ctx, client.StartWorkflowOptions{TaskQueue: "typefully-e2e-maintenance"}, temporalmaintenance.WorkflowName, job)
				if err != nil {
					t.Fatal(err)
				}
				if err = run.Get(ctx, nil); err != nil && ctx.Err() == nil {
					t.Fatal(err)
				}
			}
		}
	}
}
