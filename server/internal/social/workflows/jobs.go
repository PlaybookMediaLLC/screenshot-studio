package workflows

import (
	"encoding/json"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/activities"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

// RefreshTokenInput is refreshTokenWorkflow's argument.
type RefreshTokenInput struct {
	IntegrationID  string `json:"integrationId"`
	OrganizationID string `json:"organizationId"`
}

// RefreshTokenWorkflow refreshes a channel's
// token when it expires, for as long as the channel is usable.
func RefreshTokenWorkflow(ctx workflow.Context, in RefreshTokenInput) (bool, error) {
	act := activityCtx(ctx, "", 10*time.Minute, 0, retry3x2m)
	load := func() (*activities.Integration, bool, error) {
		var integration *activities.Integration
		if err := call(act, &integration, activities.GetIntegrationsByID, in.IntegrationID, in.OrganizationID); err != nil {
			return nil, false, err
		}
		usable := integration != nil && integration.DeletedAt == nil && !integration.InBetweenSteps && !integration.RefreshNeeded
		return integration, usable, nil
	}

	for {
		integration, usable, err := load()
		if err != nil || !usable {
			return false, err
		}

		// new Date(null) is the epoch
		var end int64
		if integration.TokenExpiration != nil {
			end = integration.TokenExpiration.UnixMilli()
		}
		minMax := max(0, end-nowMs(ctx))
		if minMax == 0 {
			return false, nil
		}

		if err := sleep(ctx, ms(float64(minMax))); err != nil {
			return false, err
		}

		// while we were sleeping, the integration might have been deleted
		integration, usable, err = load()
		if err != nil || !usable {
			return false, err
		}

		if err := call(act, nil, activities.RefreshToken, integration); err != nil {
			return false, err
		}
	}
}

// MissingPostWorkflow sweeps for missed posts every
// hour.
func MissingPostWorkflow(ctx workflow.Context) error {
	act := activityCtx(ctx, "", 10*time.Minute, 0, retry3x2m)
	loops := 0
	if err := call(act, nil, activities.SearchForMissingThreeHoursPosts); err != nil {
		return err
	}
	for {
		if err := sleep(ctx, time.Hour); err != nil {
			return err
		}

		// Keep the history small, the new run searches immediately so the
		// hourly cadence is kept
		if patched(ctx, "missing-post-continue-as-new") {
			loops++
			if loops >= 24 || workflow.GetInfo(ctx).GetCurrentHistoryLength() > 1000 {
				return workflow.NewContinueAsNewError(ctx, "missingPostWorkflow")
			}
		}

		if err := call(act, nil, activities.SearchForMissingThreeHoursPosts); err != nil {
			return err
		}
	}
}

// AutoPostInput is autoPostWorkflow's argument.
type AutoPostInput struct {
	ID          string `json:"id"`
	Immediately bool   `json:"immediately"`
}

// AutoPostWorkflow checks an RSS autopost every hour.
func AutoPostWorkflow(ctx workflow.Context, in AutoPostInput) error {
	act := activityCtx(ctx, temporalx.MainQueue, 10*time.Minute, 0, retry3x2m)
	immediately := in.Immediately
	loops := 0
	for {
		if immediately {
			_ = call(act, nil, activities.AutoPost, in.ID)
		}
		immediately = true
		if err := sleep(ctx, time.Hour); err != nil {
			return err
		}

		// Keep the history small, runs started before this patch
		// continue-as-new on their first live loop
		if patched(ctx, "autopost-continue-as-new") {
			loops++
			if loops >= 24 || workflow.GetInfo(ctx).GetCurrentHistoryLength() > 1000 {
				return workflow.NewContinueAsNewError(ctx, "autoPostWorkflow", AutoPostInput{ID: in.ID, Immediately: true})
			}
		}
	}
}

// GenerateVideoInput is generateVideoWorkflow's argument.
type GenerateVideoInput struct {
	OrganizationID string               `json:"organizationId"`
	Body           activities.VideoBody `json:"body"`
}

// GenerateVideoWorkflow returns the saved media.
// Generating a video consumes a credit, so a failed attempt is never retried.
func GenerateVideoWorkflow(ctx workflow.Context, in GenerateVideoInput) (json.RawMessage, error) {
	act := activityCtx(ctx, temporalx.MainQueue, 40*time.Minute, 0, once)
	var media json.RawMessage
	err := call(act, &media, activities.GenerateVideo, in.OrganizationID, in.Body)
	return media, err
}

// pollRetry is { maximumAttempts: 10, backoffCoefficient: 2,
// initialInterval: '10 seconds', maximumInterval: '2 minutes' }.
var pollRetry = &temporal.RetryPolicy{MaximumAttempts: 10, BackoffCoefficient: 2, InitialInterval: 10 * time.Second, MaximumInterval: 2 * time.Minute}

// ProcessMediaInput is processMediaWorkflow's argument.
type ProcessMediaInput struct {
	MediaID string `json:"mediaId"`
}

// Polls a job on the media normalization service; the service has no
// callbacks, and the RunPod job TTL is one hour so polling past it is
// pointless.
const (
	mediaPollInterval = 5 * time.Second
	mediaMaxPolls     = int(time.Hour / mediaPollInterval)
)

// ProcessMediaWorkflow is the media processing workflow.
func ProcessMediaWorkflow(ctx workflow.Context, in ProcessMediaInput) error {
	// Submitting is a plain POST with no idempotency key, so a retry after the
	// queue accepted the job would run it twice; one attempt, and a failure
	// releases the media instead
	submitCtx := activityCtx(ctx, temporalx.MainQueue, 2*time.Minute, 0, once)
	// Polling is idempotent: ride out a queue API outage of a few minutes.
	// Terminal answers are recorded by the activity itself and never throw
	pollCtx := activityCtx(ctx, temporalx.MainQueue, 2*time.Minute, 0, pollRetry)

	fail := func(message string) error {
		return call(pollCtx, nil, activities.FailMediaProcessing, in.MediaID, message)
	}

	var jobID *string
	if err := call(submitCtx, &jobID, activities.SubmitMediaProcessing, in.MediaID); err != nil {
		return fail(mediaReason(err, "Could not submit job"))
	}

	// nothing to run: the activity already released the media as ready
	if jobID == nil || *jobID == "" {
		return nil
	}

	for range mediaMaxPolls {
		if err := sleep(ctx, mediaPollInterval); err != nil {
			return err
		}
		var done bool
		if err := call(pollCtx, &done, activities.CheckMediaProcessing, in.MediaID, *jobID); err != nil {
			return fail(mediaReason(err, "Could not check job"))
		}
		if done {
			return nil
		}
	}

	return fail("Processing timed out")
}

// mediaReason: the workflow only sees the activity failure wrapper; the
// reason is its cause.
func mediaReason(err error, fallback string) string {
	message := ""
	if cause, ok := activityCause(err); ok {
		if cause != nil {
			message = failureMessage(cause)
		}
	} else {
		message = failureMessage(err)
	}
	if message == "" {
		return fallback
	}
	return message
}

// The media service has no callbacks, and the RunPod job TTL is one hour so
// polling past it is pointless. Most jobs answer within a minute; one that
// waits on a cold endpoint is polled slower so it does not fill the history.
const (
	clipFastPolls    = 12
	clipFastInterval = 5000
	clipSlowInterval = 15000
	clipMaxPolls     = clipFastPolls + (60*60*1000-clipFastPolls*clipFastInterval)/clipSlowInterval
	// how many times a job the media service called retryable is submitted
	clipMaxSubmits = 3
)

// clippingContexts are the clipping proxies, all on "main".
func clippingContexts(ctx workflow.Context) (submit, poll, ai workflow.Context) {
	// Submitting is a plain POST with no idempotency key. A retry after the
	// queue accepted the job runs it twice, which only costs the second job.
	submit = activityCtx(ctx, temporalx.MainQueue, 2*time.Minute, 0, retry(3, 2, 10*time.Second))
	// Polling and bookkeeping are idempotent: ride out an outage of a few
	// minutes. A reason that can't change is thrown as non retryable.
	poll = activityCtx(ctx, temporalx.MainQueue, 2*time.Minute, 0, pollRetry)
	// Transcribing and picking wait on an AI provider for the whole call.
	ai = activityCtx(ctx, temporalx.MainQueue, 15*time.Minute, 0, retry(3, 1, time.Minute))
	return submit, poll, ai
}

// clippingReason: only a "clipping_stop" was written for the customer,
// anything else (a provider's answer, a timeout) is for the logs.
func clippingReason(err error, fallback string) (string, bool) {
	cause := err
	if c, ok := activityCause(err); ok {
		cause = c
	}
	message := ""
	if cause != nil {
		message = failureMessage(cause)
	}
	if message == "" {
		message = fallback
	}
	app, ok := cause.(*temporal.ApplicationError)
	return message, ok && app.Type() == activities.TypeClippingStop
}

// runJob runs one job to its end. Only a "retry" answer submits it again; a
// job that never answered is failed, its twin could still be sitting in the
// queue.
func runJob(ctx workflow.Context, submit func() (string, error), check func(jobID string) (activities.ClippingJobResult, error)) (activities.ClippingJobResult, error) {
	failed := activities.ClippingJobResult{State: activities.JobFailed}
	for range clipMaxSubmits {
		jobID, err := submit()
		if err != nil {
			return failed, err
		}
		var answer *activities.ClippingJobResult
		for i := range clipMaxPolls {
			interval := clipSlowInterval
			if i < clipFastPolls {
				interval = clipFastInterval
			}
			if err := sleep(ctx, ms(float64(interval))); err != nil {
				return failed, err
			}
			result, err := check(jobID)
			if err != nil {
				return failed, err
			}
			answer = &result
			if result.State != activities.JobPending {
				break
			}
		}

		if answer == nil || answer.State != activities.JobRetry {
			if answer == nil || answer.State == activities.JobPending {
				return failed, nil
			}
			return *answer, nil
		}
	}
	return failed, nil
}

// ClippingClipWorkflow renders one clip, in a workflow of its own so ten
// clips polling side by side never share one history. A clip that fails is
// recorded on the clip and never throws, the other clips of the video go on.
func ClippingClipWorkflow(ctx workflow.Context, in activities.ClipRef) error {
	submitCtx, pollCtx, aiCtx := clippingContexts(ctx)
	failClip := func(ctx workflow.Context, message string, customer bool) error {
		return call(ctx, nil, activities.FailClip, activities.FailClipInput{ClipID: in.ClipID, Error: message, Customer: customer})
	}

	err := func() error {
		fetched, err := runJob(ctx,
			func() (string, error) {
				var jobID string
				return jobID, call(submitCtx, &jobID, activities.SubmitClipFetch, in)
			},
			func(jobID string) (activities.ClippingJobResult, error) {
				var result activities.ClippingJobResult
				return result, call(pollCtx, &result, activities.CheckClipFetch, activities.ClipJobRef{ClipID: in.ClipID, JobID: jobID})
			})
		if err != nil {
			return err
		}
		if fetched.State != activities.JobDone {
			return failClip(pollCtx, "The clip could not be downloaded", true)
		}

		if err := call(aiCtx, nil, activities.CaptionClip, in); err != nil {
			return err
		}

		rendered, err := runJob(ctx,
			func() (string, error) {
				var jobID string
				return jobID, call(submitCtx, &jobID, activities.SubmitClipRender, in)
			},
			func(jobID string) (activities.ClippingJobResult, error) {
				var result activities.ClippingJobResult
				return result, call(pollCtx, &result, activities.CheckClipRender, activities.ClipJobRef{ClipID: in.ClipID, JobID: jobID})
			})
		if err != nil {
			return err
		}
		if rendered.State != activities.JobDone {
			return failClip(pollCtx, "The clip could not be rendered", true)
		}
		return nil
	}()
	if err != nil {
		// a cancelled workflow still has to say what happened to its clip;
		// if that fails too the clip stays pending and the finish of the
		// clipping closes it
		message, customer := clippingReason(err, "The clip could not be rendered")
		disconnected, _ := workflow.NewDisconnectedContext(pollCtx)
		_ = failClip(disconnected, message, customer)
	}
	return nil
}

// ClippingWorkflow analyses a video, renders its clips
// in child workflows and creates the draft posts. It returns the clipping row
// finishClipping / failClipping answered.
func ClippingWorkflow(ctx workflow.Context, in activities.ClippingRef) (json.RawMessage, error) {
	submitCtx, pollCtx, aiCtx := clippingContexts(ctx)
	failClipping := func(ctx workflow.Context, message string, customer bool) (json.RawMessage, error) {
		var out json.RawMessage
		err := call(ctx, &out, activities.FailClipping, activities.FailClippingInput{ClippingID: in.ClippingID, Error: message, Customer: customer})
		return out, err
	}

	notAnalysed := false
	err := func() error {
		analysed, err := runJob(ctx,
			func() (string, error) {
				var jobID string
				return jobID, call(submitCtx, &jobID, activities.SubmitClippingAnalyse, in)
			},
			func(jobID string) (activities.ClippingJobResult, error) {
				var result activities.ClippingJobResult
				return result, call(pollCtx, &result, activities.CheckClippingAnalyse, activities.ClippingJobRef{ClippingID: in.ClippingID, JobID: jobID})
			})
		if err != nil {
			return err
		}
		if analysed.State != activities.JobDone {
			notAnalysed = true
			return nil
		}

		if analysed.Transcribe != nil && *analysed.Transcribe {
			if err := call(aiCtx, nil, activities.TranscribeClipping, in); err != nil {
				return err
			}
		}

		var clips []string
		if err := call(aiCtx, &clips, activities.PickClippingClips, in); err != nil {
			return err
		}

		// a clip workflow that died still leaves its clip unrendered, which
		// the finish below reads from the records
		children := make([]workflow.ChildWorkflowFuture, len(clips))
		for i, clipID := range clips {
			childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{WorkflowID: "clipping_clip_" + clipID})
			children[i] = workflow.ExecuteChildWorkflow(childCtx, "clippingClipWorkflow", activities.ClipRef{ClipID: clipID})
		}
		for _, child := range children {
			_ = child.Get(ctx, nil)
		}
		return nil
	}()

	// returned (not awaited) inside the TypeScript try: its failure is not caught
	if notAnalysed {
		return failClipping(pollCtx, "The video could not be analysed", true)
	}
	if err != nil {
		// a cancelled clipping is still closed and refunded
		message, customer := clippingReason(err, "Clipping failed")
		disconnected, _ := workflow.NewDisconnectedContext(pollCtx)
		return failClipping(disconnected, message, customer)
	}

	// the clips are in the media library by now; a draft that could not be
	// created is reported on the clipping and never takes them away
	if err := call(pollCtx, nil, activities.CreateClippingDrafts, in); err != nil {
		message, customer := clippingReason(err, "The draft posts could not be created")
		disconnected, _ := workflow.NewDisconnectedContext(pollCtx)
		return failClipping(disconnected, message, customer)
	}

	var out json.RawMessage
	err = call(pollCtx, &out, activities.FinishClipping, in)
	return out, err
}
