package temporalpublishing_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/temporalpublishing"
	"github.com/lucsky/cuid"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// A workflow started inside a request's trace runs, with its activity, in
// that trace: the client Dial builds sends the trace through Temporal, and
// the worker continues it. The task queue is unique, so no other worker
// takes the run.
func TestWorkflowsContinueTheCallersTrace(t *testing.T) {
	address := os.Getenv("PUBLISHING_TEST_TEMPORAL_ADDRESS")
	if address == "" {
		t.Skip("PUBLISHING_TEST_TEMPORAL_ADDRESS is not set")
	}
	spans := tracetest.NewSpanRecorder()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans)))
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	temporal, err := temporalpublishing.Dial(ctx, temporalpublishing.ConnectionConfig{Address: address, Namespace: "default"})
	if err != nil {
		t.Fatal(err)
	}
	defer temporal.Close()
	queue := "tracing-" + cuid.New()
	w := worker.New(temporal, queue, worker.Options{})
	w.RegisterActivityWithOptions(func(context.Context) error { return nil }, activity.RegisterOptions{Name: "tracedActivity"})
	w.RegisterWorkflowWithOptions(func(ctx workflow.Context) error {
		ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{StartToCloseTimeout: 10 * time.Second})
		return workflow.ExecuteActivity(ctx, "tracedActivity").Get(ctx, nil)
	}, workflow.RegisterOptions{Name: "tracedWorkflow"})
	if err := w.Start(); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()

	requestCtx, request := otel.Tracer("test").Start(ctx, "POST /v1/scheduled-posts")
	run, err := temporal.ExecuteWorkflow(requestCtx, client.StartWorkflowOptions{ID: queue, TaskQueue: queue}, "tracedWorkflow")
	if err != nil {
		t.Fatal(err)
	}
	if err := run.Get(ctx, nil); err != nil {
		t.Fatal(err)
	}
	request.End()

	traceID := request.SpanContext().TraceID()
	seen := map[string]bool{}
	for _, span := range spans.Ended() {
		operation, _, _ := strings.Cut(span.Name(), ":")
		if span.SpanContext().TraceID() == traceID {
			seen[operation] = true
		}
	}
	for _, operation := range []string{"StartWorkflow", "RunWorkflow", "StartActivity", "RunActivity"} {
		if !seen[operation] {
			t.Errorf("no %s span in the request's trace; saw %v", operation, seen)
		}
	}
}
