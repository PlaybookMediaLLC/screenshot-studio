package temporalonboarding

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/getsentry/sentry-go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/temporal"
)

// InitSentry reports errors to PLATFORM_SENTRY_DSN when it is set; without
// it every capture below is a no-op. Traces go to OpenTelemetry
// (internal/telemetry), not Sentry.
func InitSentry(service string) {
	dsn := os.Getenv("PLATFORM_SENTRY_DSN")
	if dsn == "" {
		return
	}
	if err := sentry.Init(sentry.ClientOptions{Dsn: dsn, ServerName: service, Environment: os.Getenv("NODE_ENV")}); err != nil {
		slog.Error("Sentry unavailable", "error", err)
	}
}

// Observer adds the workspace and run to every onboarding activity's span,
// logs the activity with its workflow, workspace, run, and request IDs, and
// reports failures to Sentry with a safe message: never page text or a model
// reply.
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
	// The Temporal tracing interceptor started this span and records the error.
	span := trace.SpanFromContext(ctx)
	span.SetAttributes(attribute.String("organization.id", run.OrganizationID), attribute.String("onboarding.run_id", run.RunID))
	started := time.Now()
	result, err := a.Next.ExecuteActivity(ctx, in)
	fields := []any{"activity", info.ActivityType.Name, "workflowId", info.WorkflowExecution.ID, "organizationId", run.OrganizationID,
		"runId", run.RunID, "requestId", run.StartedBy.RequestID, "attempt", info.Attempt, "durationMs", time.Since(started).Milliseconds()}
	if err == nil || temporal.IsCanceledError(err) {
		slog.Info("onboarding activity", fields...)
		return result, err
	}
	slog.Error("onboarding activity failed", append(fields, "error", err.Error())...)
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetTags(map[string]string{"activity": info.ActivityType.Name, "workflowId": info.WorkflowExecution.ID,
			"organizationId": run.OrganizationID, "runId": run.RunID, "requestId": run.StartedBy.RequestID,
			"traceId": span.SpanContext().TraceID().String()})
		sentry.CaptureException(err)
	})
	return result, err
}
