// Command orchestrator is Postiz's apps/orchestrator: the Temporal workers
// (getTemporalModule(true)) and the health check.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/app"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/sentryx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/orchestrator/activities"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/orchestrator/worker"
)

func main() {
	time.Local = time.UTC
	if sentryx.Initialize("screenshot-studio-orchestrator") {
		defer sentry.Flush(2 * time.Second)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	a, err := app.New(ctx)
	if err != nil {
		slog.Error("Orchestrator failed to start", "error", err)
		os.Exit(1)
	}
	defer a.Close()

	err = worker.Run(ctx, worker.Deps{
		Client:  a.Temporal,
		Manager: a.Manager,
		Post: activities.NewPostActivities(a.Posts, a.Notifications, a.Manager, a.Integrations, a.Refresh, a.Webhooks,
			a.Temporal, a.Subscriptions),
		Autopost:     activities.NewAutopostActivities(a.Autopost),
		Email:        activities.NewEmailActivities(a.Email, a.Organizations),
		Integrations: activities.NewIntegrationsActivities(a.Integrations),
		Video:        activities.NewVideoActivities(a.Media, a.Organizations),
		Media:        activities.NewMediaActivities(a.Media),
		Clipping:     activities.NewClippingActivities(a.Clipping, a.ClippingRepo),
	})
	if err != nil {
		slog.Error("Orchestrator stopped", "error", err)
		os.Exit(1)
	}
}
