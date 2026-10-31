package temporalonboarding

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.temporal.io/sdk/activity"
	temporalotel "go.temporal.io/sdk/contrib/opentelemetry"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/worker"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
)

// The observer passes results and errors through untouched, logs each
// activity with its workflow, workspace, run, and request IDs, and puts the
// workspace and run on the span the Temporal tracing interceptor starts.
func TestObserverLogsEveryActivityWithItsRun(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	spans := tracetest.NewSpanRecorder()
	tracing, err := temporalotel.NewTracingInterceptor(temporalotel.TracerOptions{
		Tracer: sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(spans)).Tracer("test")})
	if err != nil {
		t.Fatal(err)
	}
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestActivityEnvironment()
	env.SetWorkerOptions(worker.Options{Interceptors: []interceptor.WorkerInterceptor{tracing, &Observer{}}})
	env.RegisterActivityWithOptions(func(_ context.Context, run Input) (string, error) {
		if run.RunID == "bad" {
			return "", errors.New("the page answered 500")
		}
		return "ok", nil
	}, activity.RegisterOptions{Name: "observed"})
	run := Input{OrganizationID: "org-1", RunID: "run-1", StartedBy: StartedBy{RequestID: "request-1"}}
	value, err := env.ExecuteActivity("observed", run)
	var result string
	if err != nil || value.Get(&result) != nil || result != "ok" {
		t.Fatalf("result %q err=%v", result, err)
	}
	run.RunID = "bad"
	if _, err := env.ExecuteActivity("observed", run); err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("error not passed through: %v", err)
	}
	for _, want := range []string{`msg="onboarding activity" activity=observed`, "organizationId=org-1 runId=run-1 requestId=request-1",
		`msg="onboarding activity failed"`, "runId=bad"} {
		if !strings.Contains(logs.String(), want) {
			t.Fatalf("logs lack %q:\n%s", want, logs.String())
		}
	}
	ended := spans.Ended()
	if len(ended) != 2 || ended[0].Name() != "RunActivity:observed" || ended[1].Status().Description != "the page answered 500" {
		t.Fatalf("unexpected spans: %v", ended)
	}
	attributes := map[string]string{}
	for _, kv := range ended[0].Attributes() {
		attributes[string(kv.Key)] = kv.Value.Emit()
	}
	if attributes["organization.id"] != "org-1" || attributes["onboarding.run_id"] != "run-1" {
		t.Fatalf("span lacks the run: %v", attributes)
	}
}

// List fields from different pages add up, deduplicated and capped; a field
// a person edited is left for the upsert to skip.
func TestUnionListsMergesPagesButNotEditedFields(t *testing.T) {
	current := &product.ProductProfileRecord{Capabilities: []string{"Recurring invoices"}, Competitors: []string{"Ledgerly"},
		ProofPoints: []profile.ProofPoint{{Claim: "2,000 agencies"}},
		Provenance:  map[string]profile.FieldProvenance{"competitors": {EditedByUser: true}}}
	capabilities, competitors := []string{"recurring invoices", "Smart retries"}, []string{"Invoicely"}
	points := []profile.ProofPoint{{Claim: "Rated 4.8"}}
	draft := product.UpsertProductProfileInput{Capabilities: &capabilities, Competitors: &competitors, ProofPoints: &points}
	unionLists(&draft, current)
	if strings.Join(*draft.Capabilities, "|") != "Recurring invoices|Smart retries" || (*draft.Competitors)[0] != "Invoicely" || len(*draft.ProofPoints) != 2 {
		t.Fatalf("draft %v %v %v", *draft.Capabilities, *draft.Competitors, *draft.ProofPoints)
	}
}
