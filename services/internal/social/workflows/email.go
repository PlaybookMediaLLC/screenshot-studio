package workflows

import (
	"strings"
	"time"

	"go.temporal.io/sdk/workflow"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/activities"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

// The email workflows' proxies run on "main" with cancellationType ABANDON;
// the Go SDK has no ABANDON, so a cancelled run requests the activity's
// cancellation instead.

// DigestEmailInput is digestEmailWorkflow's argument.
type DigestEmailInput struct {
	OrganizationID string  `json:"organizationId"`
	Queue          []Email `json:"queue,omitempty"`
}

// DigestEmailWorkflow collects email signals for an
// hour, sends one digest per user, then continues as new with whatever
// arrived meanwhile.
func DigestEmailWorkflow(ctx workflow.Context, in DigestEmailInput) error {
	act := activityCtx(ctx, temporalx.MainQueue, 10*time.Minute, 0, retry3x2m)

	queue := in.Queue
	signals := workflow.GetSignalChannel(ctx, EmailSignal)
	workflow.Go(ctx, func(ctx workflow.Context) {
		for {
			var data []Email
			signals.Receive(ctx, &data)
			queue = append(queue, data...)
		}
	})

	if err := workflow.Await(ctx, func() bool { return len(queue) > 0 }); err != nil {
		return err
	}
	if err := sleep(ctx, time.Hour); err != nil {
		return err
	}

	// Take a snapshot batch and immediately clear queue.
	batch := queue
	queue = []Email{}

	var org activities.Team
	if err := call(act, &org, activities.GetUserOrgs, in.OrganizationID); err != nil {
		return err
	}

	for _, user := range org.Users {
		var toSend []Email
		for _, email := range batch {
			if (email.Type == "fail" && user.User.SendFailureEmails) ||
				(email.Type == "success" && user.User.SendSuccessEmails) ||
				email.Type == "info" {
				toSend = append(toSend, email)
			}
		}
		if len(toSend) == 0 {
			continue
		}

		var subject any = "[Postiz] Your latest notifications"
		if len(toSend) == 1 {
			subject = toSend[0].Title
		}
		messages := make([]string, len(toSend))
		for i, email := range toSend {
			messages[i] = email.Message
		}
		if err := call(act, nil, activities.SendEmailAsync, user.User.Email, subject, strings.Join(messages, "<br/>"), "bottom"); err != nil {
			return err
		}
	}

	queue = append(queue, drain[Email](signals)...)
	return workflow.NewContinueAsNewError(ctx, "digestEmailWorkflow", DigestEmailInput{OrganizationID: in.OrganizationID, Queue: queue})
}

// drain returns the signals delivered but not yet received, so a
// continue-as-new carries them over like a TypeScript signal handler would.
func drain[T any](ch workflow.ReceiveChannel) []T {
	var out []T
	for {
		var data []T
		if !ch.ReceiveAsync(&data) {
			return out
		}
		out = append(out, data...)
	}
}

// SendSingleEmailWorkflow: one workflow per email,
// the Resend rate limit is enforced on the email task queues.
func SendSingleEmailWorkflow(ctx workflow.Context, email SendEmail) error {
	queue := temporalx.EmailQueues.Bulk.TaskQueue
	if email.AddTo == "top" {
		queue = temporalx.EmailQueues.Priority.TaskQueue
	}
	act := activityCtx(ctx, queue, 10*time.Minute, 0, nil)
	return call(act, nil, activities.SendEmail, email.To, email.Subject, email.HTML, email.ReplyTo)
}

// SendEmailQueue is sendEmailWorkflow's argument.
type SendEmailQueue struct {
	Queue []SendEmail `json:"queue,omitempty"`
}

const rateLimit = 700 * time.Millisecond

// SendEmailWorkflow is deprecated: no longer started, kept registered so the
// running `send_email` can drain its queue.
func SendEmailWorkflow(ctx workflow.Context, in SendEmailQueue) error {
	act := activityCtx(ctx, temporalx.MainQueue, 10*time.Minute, 0, nil)

	queue := in.Queue
	if queue == nil {
		queue = []SendEmail{}
	}
	processedThisRun := 0

	// Handle incoming email signals
	add := func(email SendEmail) {
		if email.To == "" || email.Subject == "" {
			return
		}
		if email.AddTo == "top" {
			queue = append([]SendEmail{email}, queue...)
		} else {
			queue = append(queue, email)
		}
	}
	signals := workflow.GetSignalChannel(ctx, SendEmailSignal)
	workflow.Go(ctx, func(ctx workflow.Context) {
		for {
			var email SendEmail
			signals.Receive(ctx, &email)
			add(email)
		}
	})

	// Process emails with rate limiting
	for {
		if err := workflow.Await(ctx, func() bool { return len(queue) > 0 }); err != nil {
			return err
		}

		email := queue[0]
		queue = queue[1:]
		if err := call(act, nil, activities.SendEmail, email.To, email.Subject, email.HTML, email.ReplyTo); err != nil {
			workflow.GetLogger(ctx).Error("sendEmail failed", "error", err)
		} else {
			processedThisRun++
		}

		if err := sleep(ctx, rateLimit); err != nil {
			return err
		}

		if processedThisRun >= 30 {
			for {
				var email SendEmail
				if !signals.ReceiveAsync(&email) {
					break
				}
				add(email)
			}
			return workflow.NewContinueAsNewError(ctx, "sendEmailWorkflow", SendEmailQueue{Queue: queue})
		}
	}
}

// StreakInput is the argument of both streak workflows.
type StreakInput struct {
	OrganizationID string `json:"organizationId"`
	LastPost       *int64 `json:"lastPost,omitempty"`
}

const day = 86400000

const streakEnded = "<p>Your streak has ended! You didn't post anything in the last 24 hours. Schedule a post now to start a new streak!</p>"

func streakCtx(ctx workflow.Context) workflow.Context {
	return activityCtx(ctx, temporalx.MainQueue, 10*time.Minute, 0, nil)
}

func sendStreakEmails(act workflow.Context, team activities.Team, subject, html string) error {
	for _, user := range team.Users {
		if !user.User.SendStreakEmails {
			continue
		}
		if err := call(act, nil, activities.SendEmailAsync, user.User.Email, subject, html, "bottom"); err != nil {
			return err
		}
	}
	return nil
}

// StreakWorkflow is the first streak version; runs hand
// over to streakWorkflowV2 when the organization posted since they started.
func StreakWorkflow(ctx workflow.Context, in StreakInput) error {
	act := streakCtx(ctx)
	if err := call(act, nil, activities.SetStreak, in.OrganizationID, "start"); err != nil {
		return err
	}
	if err := sleep(ctx, 79200000*time.Millisecond); err != nil {
		return err
	}
	var team activities.Team
	if err := call(act, &team, activities.GetUserOrgs, in.OrganizationID); err != nil {
		return err
	}

	if !patched(ctx, "reminder") {
		if err := sendStreakEmails(act, team, "Streak Reminder", "<p>You are about to lose your streak in two hours! schedule a post now to keep it!</p>"); err != nil {
			return err
		}
	}

	if err := sleep(ctx, 7200000*time.Millisecond); err != nil {
		return err
	}

	// Posts no longer restart this workflow, hand the streak over to
	// streakWorkflowV2 if the organization posted since it started
	if patched(ctx, "streak-last-post") {
		var lastPost *int64
		if err := call(act, &lastPost, activities.GetLastPublishDate, in.OrganizationID); err != nil {
			return err
		}
		if lastPost != nil && *lastPost != 0 && *lastPost+day > nowMs(ctx) {
			return workflow.NewContinueAsNewError(ctx, "streakWorkflowV2", StreakInput{OrganizationID: in.OrganizationID, LastPost: lastPost})
		}
	}

	if patched(ctx, "reminder") {
		if err := sendStreakEmails(act, team, "Streak Ended", streakEnded); err != nil {
			return err
		}
	}
	return call(act, nil, activities.SetStreak, in.OrganizationID, "end")
}

// StreakWorkflowV2 is one run per organization that posts don't restart: it
// wakes up when the last post is a day old and ends the streak if nothing
// newer was published.
func StreakWorkflowV2(ctx workflow.Context, in StreakInput) error {
	act := streakCtx(ctx)

	var lastPost int64
	if in.LastPost == nil {
		// Started by a publish
		if err := call(act, nil, activities.SetStreak, in.OrganizationID, "start"); err != nil {
			return err
		}
		lastPost = nowMs(ctx)
	} else {
		lastPost = *in.LastPost
	}

	for range 30 {
		if err := sleep(ctx, ms(float64(max(1000, lastPost+day-nowMs(ctx))))); err != nil {
			return err
		}
		var latest *int64
		if err := call(act, &latest, activities.GetLastPublishDate, in.OrganizationID); err != nil {
			return err
		}
		if latest != nil {
			lastPost = max(lastPost, *latest)
		}

		if lastPost+day > nowMs(ctx) {
			continue
		}

		var team activities.Team
		if err := call(act, &team, activities.GetUserOrgs, in.OrganizationID); err != nil {
			return err
		}
		if err := sendStreakEmails(act, team, "Streak Ended", streakEnded); err != nil {
			return err
		}
		return call(act, nil, activities.SetStreak, in.OrganizationID, "end")
	}

	// Keep the history small for organizations that post every day
	return workflow.NewContinueAsNewError(ctx, "streakWorkflowV2", StreakInput{OrganizationID: in.OrganizationID, LastPost: &lastPost})
}
