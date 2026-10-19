package temporalreleaseautomation

import (
	"context"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/githubapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/maintenance"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// TestBrowserFixtureWorker serves the browser fixture with the production
// interpreter, activities, and outbox dispatcher against real local services.
// It excludes unrelated newsletter/retention schedules and paid providers.
func TestBrowserFixtureWorker(t *testing.T) {
	if os.Getenv("RELEASE_AUTOMATION_E2E_WORKER") != "1" {
		t.Skip("browser fixture worker is opt-in")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var name string
	if err := db.SQL.QueryRowContext(ctx, "SELECT current_database()").Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatal("browser worker requires an isolated test database")
	}
	github, err := githubapp.FromEnvironment()
	if err != nil || github == nil {
		t.Fatal("fixture GitHub App is not configured")
	}
	objects, err := media.NewS3StoreFromEnvironment()
	if err != nil || objects == nil {
		t.Fatal("fixture storage is not configured")
	}
	temporalClient, err := client.Dial(client.Options{HostPort: os.Getenv("TEMPORAL_ADDRESS")})
	if err != nil {
		t.Fatal(err)
	}
	defer temporalClient.Close()
	store := product.NewConfiguration(db.Client).WithGitHubApp(github).WithObjectStore(objects).WithAutomationDispatcher(&Client{Temporal: temporalClient})
	w := worker.New(temporalClient, TaskQueue, worker.Options{MaxConcurrentActivityExecutionSize: 5})
	Register(w, &Activities{Store: store})
	if err := w.Start(); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()
	jobs := &maintenance.Store{DB: db.SQL, Events: store, Objects: media.NewTenantObjects(objects)}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := store.AdvertiseReleaseAutomationExecutor(ctx, "browser-fixture-worker"); err != nil && ctx.Err() == nil {
			t.Fatal(err)
		}
		if _, err := jobs.Outbox(ctx); err != nil && ctx.Err() == nil {
			t.Fatal(err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
