//go:build e2e

package notifications

import (
	"context"
	"errors"
	"net"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalmaintenance"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// TestBrowserFixtureWorker runs production notification dispatch on real local
// Temporal and Postgres, with provider HTTP handled by the E2E fixture only.
func TestBrowserFixtureWorker(t *testing.T) {
	if os.Getenv("NOTIFICATIONS_E2E_WORKER") != "1" {
		t.Skip("browser fixture worker is opt-in")
	}
	uri, err := url.Parse(os.Getenv("DATABASE_URL"))
	if err != nil || uri.Hostname() != "127.0.0.1" || !strings.Contains(uri.Path, "test") || os.Getenv("NOTIFICATIONS_E2E_PROVIDER_URL") == "" {
		t.Fatal("notification fixture requires local test resources")
	}
	host, _, err := net.SplitHostPort(os.Getenv("TEMPORAL_ADDRESS"))
	if err != nil || host != "127.0.0.1" {
		t.Fatal("Temporal fixture must be local")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := database.Open(ctx, uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	c, err := client.Dial(client.Options{HostPort: os.Getenv("TEMPORAL_ADDRESS")})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	s := New(db.SQL, db.Client)
	w := worker.New(c, temporalmaintenance.TaskQueue, worker.Options{})
	temporalmaintenance.Register(w, temporalmaintenance.RunnerFunc(func(ctx context.Context, job string) (int, error) {
		if job != "notifications" {
			return 0, errors.New("fixture only dispatches notifications")
		}
		return 0, s.Process(ctx)
	}))
	if err := w.Start(); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()
	<-ctx.Done()
}
