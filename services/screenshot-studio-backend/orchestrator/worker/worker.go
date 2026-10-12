// Package worker runs the orchestrator (apps/orchestrator): the Temporal
// workers of getTemporalModule(true) and the health check server.
package worker

import (
	"context"
	"errors"
	"log"
	"math"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/orchestrator/activities"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/orchestrator/workflows"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

// Deps are the orchestrator's activity classes, the Temporal client and the
// provider list (socialIntegrationList).
type Deps struct {
	Client       client.Client
	Manager      *integrations.Manager
	Post         activities.PostActivity
	Autopost     activities.AutopostActivity
	Email        activities.EmailActivity
	Integrations activities.IntegrationsActivity
	Video        activities.VideoActivity
	Media        activities.MediaActivity
	Clipping     activities.ClippingActivity
}

// Run starts every worker and the health server on ORCHESTRATOR_PORT
// (default 3002), and blocks until ctx is done.
func Run(ctx context.Context, d Deps) error {
	var running []worker.Worker
	defer func() {
		for _, w := range running {
			w.Stop()
		}
	}()
	for _, q := range queues(d.Manager.Providers()) {
		w := worker.New(d.Client, q.taskQueue, q.options)
		if q.workflows {
			workflows.Register(w)
		}
		registerActivities(w, d)
		if err := w.Start(); err != nil {
			return err
		}
		running = append(running, w)
	}

	port := os.Getenv("ORCHESTRATOR_PORT")
	if port == "" {
		port = "3002"
	}
	srv := &http.Server{Addr: ":" + port, Handler: healthRouter()}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Printf("screenshot-studio-orchestrator health check listening on port %s", port)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

type queue struct {
	taskQueue string
	workflows bool
	options   worker.Options
}

// queues is getTemporalModule's worker list: `main` (every workflow) and one
// activity-only worker per provider queue, then the rate limited email
// queues.
func queues(providers []integrations.Provider) []queue {
	// Queues this worker server should NOT run, comma-separated
	// (e.g. EXCLUDE_QUEUE="reddit,x,twitch"). Use it to pin a queue to a single
	// server: exclude it on every server except the one that should own it.
	// Meant for the providers whose concurrency is too low to split (limit 1).
	var exclude []string
	for _, s := range strings.Split(os.Getenv("EXCLUDE_QUEUE"), ",") {
		if s = strings.TrimSpace(s); s != "" {
			exclude = append(exclude, s)
		}
	}

	// How many worker servers share each (non-excluded) queue. Per-server
	// concurrency is divided by this so the GLOBAL concurrency stays correct.
	// 1 server => 1 (full), 2 servers => 2 (half each), 3 servers => 3, etc.
	divider, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv("WORKER_CONCURRENCY_DIVIDER")), 64)
	if err != nil || divider == 0 || math.IsNaN(divider) {
		divider = 1
	}
	divider = math.Max(1, divider)

	type entry struct {
		identifier       string
		maxConcurrentJob int // 0 = undefined
	}
	list := []entry{{identifier: temporalx.MainQueue}}
	for _, p := range providers {
		info := p.Info()
		// SocialAbstract.maxConcurrentJob defaults to 1
		limit := max(info.MaxConcurrentJob, 1)
		list = append(list, entry{identifier: info.Identifier, maxConcurrentJob: limit})
	}

	var out []queue
	for _, e := range list {
		if strings.Contains(e.identifier, "-") {
			continue
		}
		taskQueue := strings.Split(e.identifier, "-")[0]
		if slices.Contains(exclude, taskQueue) {
			continue
		}

		// Split the per-provider cap across the servers sharing this queue.
		// Floor (never below 1) so the global total never exceeds the
		// provider's limit. Providers whose limit is smaller than the server
		// count must be pinned via EXCLUDE_QUEUE instead.
		concurrency := 1000000
		if e.maxConcurrentJob != 0 {
			concurrency = int(math.Max(1, math.Floor(float64(e.maxConcurrentJob)/divider)))
		}

		// Workflows only ever run on the `main` queue; the other workers are
		// activity-only.
		isMain := taskQueue == temporalx.MainQueue
		out = append(out, queue{taskQueue: taskQueue, workflows: isMain, options: worker.Options{
			MaxConcurrentActivityExecutionSize: concurrency,
			// By default the SDK throttles heartbeat sends to 60s, so against
			// the workflow's heartbeatTimeout one dropped send or a minute of
			// lag eats most of the margin. Sending every 15s keeps the
			// recorded heartbeat fresh even when individual sends fail or
			// fire late.
			MaxHeartbeatThrottleInterval: 15 * time.Second,
			DisableWorkflowWorker:        !isMain,
		}})
	}

	// Activity-only workers for emails, rate limited server side across all
	// workers to stay under the Resend limit
	for _, e := range []temporalx.EmailQueue{temporalx.EmailQueues.Priority, temporalx.EmailQueues.Bulk} {
		if slices.Contains(exclude, e.TaskQueue) {
			continue
		}
		out = append(out, queue{taskQueue: e.TaskQueue, options: worker.Options{
			MaxConcurrentActivityExecutionSize: 10,
			TaskQueueActivitiesPerSecond:       e.PerSecond,
			DisableWorkflowWorker:              true,
		}})
	}
	return out
}

// registerActivities registers every activity class on w under its
// TypeScript method name, as each TS worker gets all activityClasses.
func registerActivities(w worker.ActivityRegistry, d Deps) {
	for name, fn := range map[string]any{
		activities.GetIntegrationByID:              d.Post.GetIntegrationByID,
		activities.SearchForMissingThreeHoursPosts: d.Post.SearchForMissingThreeHoursPosts,
		activities.UpdatePost:                      d.Post.UpdatePost,
		activities.GetPost:                         d.Post.GetPost,
		activities.GetPostsList:                    d.Post.GetPostsList,
		activities.IsCommentable:                   d.Post.IsCommentable,
		activities.PostComment:                     d.Post.PostComment,
		activities.PostSocial:                      d.Post.PostSocial,
		activities.PostSocialPending:               d.Post.PostSocialPending,
		activities.CheckPostStatus:                 d.Post.CheckPostStatus,
		activities.FinalizePost:                    d.Post.FinalizePost,
		activities.InAppNotification:               d.Post.InAppNotification,
		activities.GlobalPlugs:                     d.Post.GlobalPlugs,
		activities.ChangeState:                     d.Post.ChangeState,
		activities.InternalPlugs:                   d.Post.InternalPlugs,
		activities.SendWebhooks:                    d.Post.SendWebhooks,
		activities.ProcessPlug:                     d.Post.ProcessPlug,
		activities.ProcessInternalPlug:             d.Post.ProcessInternalPlug,
		activities.RefreshToken:                    d.Post.RefreshToken,
		activities.RefreshTokenWithCause:           d.Post.RefreshTokenWithCause,

		activities.AutoPost: d.Autopost.AutoPost,

		activities.SendEmail:          d.Email.SendEmail,
		activities.SendEmailAsync:     d.Email.SendEmailAsync,
		activities.GetUserOrgs:        d.Email.GetUserOrgs,
		activities.SetStreak:          d.Email.SetStreak,
		activities.GetLastPublishDate: d.Email.GetLastPublishDate,

		activities.GetIntegrationsByID: d.Integrations.GetIntegrationsByID,

		activities.GenerateVideo: d.Video.GenerateVideo,

		activities.SubmitMediaProcessing: d.Media.SubmitMediaProcessing,
		activities.CheckMediaProcessing:  d.Media.CheckMediaProcessing,
		activities.FailMediaProcessing:   d.Media.FailMediaProcessing,

		activities.SubmitClippingAnalyse: d.Clipping.SubmitClippingAnalyse,
		activities.CheckClippingAnalyse:  d.Clipping.CheckClippingAnalyse,
		activities.TranscribeClipping:    d.Clipping.TranscribeClipping,
		activities.PickClippingClips:     d.Clipping.PickClippingClips,
		activities.SubmitClipFetch:       d.Clipping.SubmitClipFetch,
		activities.CheckClipFetch:        d.Clipping.CheckClipFetch,
		activities.CaptionClip:           d.Clipping.CaptionClip,
		activities.SubmitClipRender:      d.Clipping.SubmitClipRender,
		activities.CheckClipRender:       d.Clipping.CheckClipRender,
		activities.FailClip:              d.Clipping.FailClip,
		activities.CreateClippingDrafts:  d.Clipping.CreateClippingDrafts,
		activities.FinishClipping:        d.Clipping.FinishClipping,
		activities.FailClipping:          d.Clipping.FailClipping,
	} {
		w.RegisterActivityWithOptions(fn, activity.RegisterOptions{Name: name})
	}
}

// healthRouter is health.controller.ts: GET /health/status opens a new
// Temporal connection and describes the namespace within 10 seconds.
func healthRouter() http.Handler {
	r := httpx.NewRouter()
	r.Group("/health").Get("/status", func(c *httpx.Ctx) (any, error) {
		ctx, cancel := context.WithTimeout(c.R.Context(), 10*time.Second)
		defer cancel()
		conn, err := temporalx.Dial(ctx)
		if err == nil {
			_, err = conn.WorkflowService().DescribeNamespace(ctx, &workflowservice.DescribeNamespaceRequest{Namespace: temporalx.Namespace()})
			conn.Close()
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, map[string]string{"status": "error"})
			return nil, nil
		}
		c.JSON(http.StatusOK, map[string]string{"status": "ok"})
		return nil, nil
	}, httpx.Raw())
	return r
}

// StartMissingPostWorkflow is InfiniteWorkflowRegister (backend module init):
// with RUN_CRON set it starts the missing-posts sweep, ignoring errors (it
// is usually already running).
func StartMissingPostWorkflow(ctx context.Context, c client.Client) {
	if os.Getenv("RUN_CRON") == "" || c == nil {
		return
	}
	_, _ = c.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        "missing-post-workflow",
		TaskQueue: temporalx.MainQueue,
	}, "missingPostWorkflow")
}
