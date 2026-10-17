package temporalonboarding

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/getsentry/sentry-go"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/temporal"
)

// InitSentry reports errors and traces to PLATFORM_SENTRY_DSN when it is set.
// Without it every span and capture below is a no-op.
func InitSentry(service string) {
	dsn := os.Getenv("PLATFORM_SENTRY_DSN")
	if dsn == "" {
		return
	}
	if err := sentry.Init(sentry.ClientOptions{Dsn: dsn, EnableTracing: true, TracesSampleRate: 0.2, ServerName: service,
		Environment: os.Getenv("NODE_ENV")}); err != nil {
		slog.Error("Sentry unavailable", "error", err)
	}
}

// Observer traces every onboarding activity in a Sentry span, logs it with
// its workflow, workspace, run, and request IDs, and reports failures with
// a safe message: never page text or a model reply.
type Observer struct {
	interceptor.WorkerInterceptorBase
}

// InterceptActivity wraps each activity.
func (*Observer) InterceptActivity(_ context.Context, next interceptor.ActivityInboundInterceptor) interceptor.ActivityInboundInterceptor {
	observer := &activityObserver{}
	observer.Next = next
	return observer
}

type activityObserver struct {
	interceptor.ActivityInboundInterceptorBase
}

func runOf(args []any) (Input, bool) {
	for _, arg := range args {
		switch value := arg.(type) {
		case Input:
			return value, true
		case BatchInput:
			return value.Run, true
		}
	}
	return Input{}, false
}

func (a *activityObserver) ExecuteActivity(ctx context.Context, in *interceptor.ExecuteActivityInput) (any, error) {
	info := activity.GetInfo(ctx)
	run, _ := runOf(in.Args)
	span := sentry.StartSpan(ctx, "onboarding.activity", sentry.WithDescription(info.ActivityType.Name))
	span.SetTag("organizationId", run.OrganizationID)
	span.SetTag("runId", run.RunID)
	defer span.Finish()
	started := time.Now()
	result, err := a.Next.ExecuteActivity(span.Context(), in)
	fields := []any{"activity", info.ActivityType.Name, "workflowId", info.WorkflowExecution.ID, "organizationId", run.OrganizationID,
		"runId", run.RunID, "requestId", run.StartedBy.RequestID, "attempt", info.Attempt, "durationMs", time.Since(started).Milliseconds()}
	if err == nil || temporal.IsCanceledError(err) {
		slog.Info("onboarding activity", fields...)
		return result, err
	}
	slog.Error("onboarding activity failed", append(fields, "error", err.Error())...)
	span.Status = sentry.SpanStatusInternalError
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetTags(map[string]string{"activity": info.ActivityType.Name, "workflowId": info.WorkflowExecution.ID,
			"organizationId": run.OrganizationID, "runId": run.RunID, "requestId": run.StartedBy.RequestID})
		sentry.CaptureException(err)
	})
	return result, err
}
