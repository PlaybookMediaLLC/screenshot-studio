package telemetry

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	colmetricpb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	metricpb "go.opentelemetry.io/proto/otlp/metrics/v1"
	"google.golang.org/protobuf/proto"
)

func newProvider(t *testing.T, cfg config.Telemetry) (*sdktrace.TracerProvider, *tracetest.InMemoryExporter) {
	exporter := tracetest.NewInMemoryExporter()
	provider := tracerProvider(cfg, resource.Empty(), exporter)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	return provider, exporter
}

func exported(t *testing.T, provider *sdktrace.TracerProvider, exporter *tracetest.InMemoryExporter) tracetest.SpanStubs {
	t.Helper()
	if err := provider.ForceFlush(context.Background()); err != nil {
		t.Fatal(err)
	}
	return exporter.GetSpans()
}

func TestSamplesOnePercentOfNewTraces(t *testing.T) {
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 0.01})
	tracer := provider.Tracer("test")
	for range 20000 {
		_, span := tracer.Start(context.Background(), "request")
		span.End()
	}
	// About 200 are expected; the bounds are about six standard deviations.
	if n := len(exported(t, provider, exporter)); n < 120 || n > 280 {
		t.Fatalf("kept %d of 20000 traces, want about 200", n)
	}
}

func TestChildSpansFollowTheirTrace(t *testing.T) {
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 0.5})
	tracer := provider.Tracer("test")
	for range 200 {
		ctx, parent := tracer.Start(context.Background(), "parent")
		_, child := tracer.Start(ctx, "child")
		child.End()
		parent.End()
	}
	traces := map[trace.TraceID]int{}
	for _, span := range exported(t, provider, exporter) {
		traces[span.SpanContext.TraceID()]++
	}
	if len(traces) == 0 || len(traces) == 200 {
		t.Fatalf("sampled %d of 200 traces at 0.5", len(traces))
	}
	for id, n := range traces {
		if n != 2 {
			t.Fatalf("trace %s kept %d of its 2 spans", id, n)
		}
	}
}

func TestRemoteParentDecisionIsFollowed(t *testing.T) {
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 0})
	tracer := provider.Tracer("test")
	for i, flags := range []trace.TraceFlags{trace.FlagsSampled, 0} {
		remote := trace.NewSpanContext(trace.SpanContextConfig{TraceID: trace.TraceID{byte(i + 1)}, SpanID: trace.SpanID{1},
			TraceFlags: flags, Remote: true})
		_, span := tracer.Start(trace.ContextWithRemoteSpanContext(context.Background(), remote), "server")
		span.End()
	}
	spans := exported(t, provider, exporter)
	if len(spans) != 1 || spans[0].SpanContext.TraceID() != (trace.TraceID{1}) || spans[0].Parent.SpanID() != (trace.SpanID{1}) {
		t.Fatalf("want only the sampled caller's trace, got %v", spans)
	}
}

func TestKeepsFailedAndSlowSpansOfUnsampledTraces(t *testing.T) {
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 0, SlowSpan: time.Second, PromotedSpansPerSecond: 100})
	tracer := provider.Tracer("test")
	start := time.Now()
	// A RunWorkflow span lasts as long as its workflow, so being slow does not keep it.
	for name, duration := range map[string]time.Duration{"fast": time.Millisecond, "slow": 2 * time.Second,
		"RunWorkflow:PostWorkflowV2": 72 * time.Hour} {
		_, span := tracer.Start(context.Background(), name, trace.WithTimestamp(start))
		span.End(trace.WithTimestamp(start.Add(duration)))
	}
	_, failed := tracer.Start(context.Background(), "failed")
	failed.SetStatus(codes.Error, "boom")
	failed.End()
	var names []string
	for _, span := range exported(t, provider, exporter) {
		names = append(names, span.Name)
		if !span.SpanContext.IsSampled() || !slices.Contains(span.Attributes, attribute.Bool("sampling.promoted", true)) {
			t.Fatalf("%s is not marked as promoted: %v", span.Name, span.Attributes)
		}
	}
	slices.Sort(names)
	if strings.Join(names, ",") != "failed,slow" {
		t.Fatalf("kept %v, want the failed and the slow span", names)
	}
}

func TestPromotionIsRateLimited(t *testing.T) {
	// One a second allows a burst of ten.
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 0, PromotedSpansPerSecond: 1})
	tracer := provider.Tracer("test")
	for range 100 {
		_, span := tracer.Start(context.Background(), "failed")
		span.SetStatus(codes.Error, "boom")
		span.End()
	}
	if n := len(exported(t, provider, exporter)); n < 10 || n > 11 {
		t.Fatalf("kept %d failed spans, want the burst of 10", n)
	}
}

func TestRedactsCredentialsAndPersonalData(t *testing.T) {
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 1})
	_, span := provider.Tracer("test").Start(context.Background(), "HTTP GET", trace.WithAttributes(
		attribute.String("url.full", "https://graph.facebook.com/v19.0/me?access_token=EAAB-s3cr3t"),
		attribute.String("client.address", "203.0.113.7"), attribute.String("user_agent.original", "Mozilla/5.0 s3cr3t-agent"),
		attribute.String("url.query", "code=s3cr3t-code"), attribute.String("db.connection_string", "redis://:s3cr3t@redis:6379"),
		attribute.String("http.request.method", "GET")))
	span.RecordError(errors.New(`Post "https://api.x.com/2/tweets?sig=s3cr3t-sig": dial postgres://app:s3cr3t-password@db:5432/shots ` +
		`with Authorization: Bearer s3cr3t-bearer; body client_secret=s3cr3t-client`))
	span.SetStatus(codes.Error, "refresh failed: token=s3cr3t-status")
	span.End()
	spans := exported(t, provider, exporter)
	if len(spans) != 1 {
		t.Fatalf("want one span, got %d", len(spans))
	}
	var text []string
	keys := map[attribute.Key]bool{}
	for _, kv := range spans[0].Attributes {
		keys[kv.Key] = true
		text = append(text, kv.Value.Emit())
	}
	for _, event := range spans[0].Events {
		for _, kv := range event.Attributes {
			text = append(text, kv.Value.Emit())
		}
	}
	all := strings.Join(append(text, spans[0].Status.Description), "\n")
	if strings.Contains(all, "s3cr3t") || strings.Contains(all, "203.0.113.7") {
		t.Fatalf("a secret was exported:\n%s", all)
	}
	for _, want := range []string{"https://graph.facebook.com/v19.0/me?REDACTED", "postgres://REDACTED@db:5432", "Bearer REDACTED", "token=REDACTED"} {
		if !strings.Contains(all, want) {
			t.Fatalf("missing %q in:\n%s", want, all)
		}
	}
	if keys["client.address"] || keys["user_agent.original"] || keys["url.query"] || keys["db.connection_string"] || !keys["http.request.method"] {
		t.Fatalf("unexpected attribute keys: %v", keys)
	}
}

func TestHandlerJoinsInternalTracesAndSkipsHealthChecks(t *testing.T) {
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 1})
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/items/{id}", func(http.ResponseWriter, *http.Request) {})
	mux.HandleFunc("GET /healthz", func(http.ResponseWriter, *http.Request) {})
	const caller = "0af7651916cd43dd8448eb211c80319c"
	for _, public := range []bool{false, true} {
		handler := Handler(mux, public)
		for _, path := range []string{"/healthz", "/v1/items/42"} {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			request.Header.Set("traceparent", "00-"+caller+"-b7ad6b7169203331-01")
			handler.ServeHTTP(httptest.NewRecorder(), request)
		}
	}
	spans := exported(t, provider, exporter)
	if len(spans) != 2 {
		t.Fatalf("want one span per handler and none for /healthz, got %d", len(spans))
	}
	internal, public := spans[0], spans[1]
	if internal.Name != "GET /v1/items/{id}" || internal.SpanContext.TraceID().String() != caller {
		t.Fatalf("internal span %q in trace %s", internal.Name, internal.SpanContext.TraceID())
	}
	if public.SpanContext.TraceID().String() == caller || len(public.Links) != 1 || public.Links[0].SpanContext.TraceID().String() != caller {
		t.Fatalf("the public span must start its own trace and link the caller's: %v", public)
	}
}

func TestHandlerAnswersPanicsWithA500(t *testing.T) {
	provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 1})
	otel.SetTracerProvider(provider)
	handler := Handler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("nil map") }), false)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "internal server error") {
		t.Fatalf("want a JSON 500, got %d %q", response.Code, response.Body.String())
	}
	spans := exported(t, provider, exporter)
	if len(spans) != 1 || spans[0].Status.Code != codes.Error || len(spans[0].Events) != 1 ||
		!slices.Contains(spans[0].Events[0].Attributes, attribute.String("exception.message", "panic: nil map")) ||
		!slices.Contains(spans[0].Attributes, attribute.Int("http.response.status_code", 500)) {
		t.Fatalf("want one failed span with the exception and status 500, got %v", spans)
	}
}

func TestHandlerAbortsAPanicAfterTheResponseStarted(t *testing.T) {
	for name, start := range map[string]func(http.ResponseWriter){
		"body":   func(w http.ResponseWriter) { _, _ = w.Write([]byte(`{"items":[`)) },
		"header": func(w http.ResponseWriter) { w.WriteHeader(http.StatusOK) },
	} {
		t.Run(name, func(t *testing.T) {
			provider, exporter := newProvider(t, config.Telemetry{SamplingRate: 1})
			otel.SetTracerProvider(provider)
			handler := Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				start(w)
				panic("nil map")
			}), false)
			func() {
				defer func() {
					if value := recover(); value != http.ErrAbortHandler {
						t.Errorf("want http.ErrAbortHandler, so the server drops the started response; got %v", value)
					}
				}()
				handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
			}()
			if spans := exported(t, provider, exporter); len(spans) != 1 || spans[0].Status.Code != codes.Error {
				t.Fatalf("want one failed span, got %v", spans)
			}
		})
	}
}

// endsWithin fails the test when ending count spans takes longer than limit,
// instead of hanging until the test binary times out.
func endsWithin(t *testing.T, tracer trace.Tracer, count int, limit time.Duration) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range count {
			_, span := tracer.Start(context.Background(), "request")
			span.End()
		}
	}()
	select {
	case <-done:
	case <-time.After(limit):
		t.Fatalf("ending %d spans blocked for more than %s", count, limit)
	}
}

// blockingExporter holds every export until release is closed.
type blockingExporter struct {
	release chan struct{}
	mu      sync.Mutex
	spans   int
}

func (e *blockingExporter) ExportSpans(_ context.Context, spans []sdktrace.ReadOnlySpan) error {
	<-e.release
	e.mu.Lock()
	defer e.mu.Unlock()
	e.spans += len(spans)
	return nil
}

func (e *blockingExporter) Shutdown(context.Context) error { return nil }

func TestAFullQueueDropsSpansWithoutBlocking(t *testing.T) {
	t.Setenv("OTEL_BSP_MAX_QUEUE_SIZE", "10")
	exporter := &blockingExporter{release: make(chan struct{})}
	provider := tracerProvider(config.Telemetry{SamplingRate: 1}, resource.Empty(), exporter)
	endsWithin(t, provider.Tracer("test"), 1000, time.Second)
	close(exporter.release)
	if err := provider.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	// The queue holds 10 and one batch can be in flight: everything else is dropped.
	if exporter.spans == 0 || exporter.spans > 30 {
		t.Fatalf("exported %d of 1000 spans through a queue of 10", exporter.spans)
	}
}

type received struct {
	header http.Header
	body   []byte
}

// otlpReceiver records each OTLP/HTTP request by path, unzipped.
func otlpReceiver(t *testing.T) (*httptest.Server, func(path string) []received) {
	var mu sync.Mutex
	requests := map[string][]received{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body io.Reader = r.Body
		if r.Header.Get("Content-Encoding") == "gzip" {
			unzipped, err := gzip.NewReader(r.Body)
			if err != nil {
				t.Error(err)
				return
			}
			body = unzipped
		}
		data, _ := io.ReadAll(body)
		mu.Lock()
		requests[r.URL.Path] = append(requests[r.URL.Path], received{r.Header.Clone(), data})
		mu.Unlock()
	}))
	t.Cleanup(server.Close)
	return server, func(path string) []received {
		mu.Lock()
		defer mu.Unlock()
		return requests[path]
	}
}

func keepDefaultTransport(t *testing.T) {
	transport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = transport })
}

func TestStartExportsToTheOTLPEndpointAndFlushesOnShutdown(t *testing.T) {
	keepDefaultTransport(t)
	server, requests := otlpReceiver(t)
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("OTEL_SAMPLING_RATE", "0")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", server.URL)
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "authorization=Bearer xaat-test,x-axiom-dataset=shots-traces")
	t.Setenv("OTEL_EXPORTER_OTLP_METRICS_HEADERS", "authorization=Bearer xaat-test,x-axiom-metrics-dataset=shots-metrics")
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment.name=test")
	t.Setenv("SERVICE_VERSION", "abc123")
	shutdown := Start(context.Background(), "publishing-backend")
	if http.DefaultTransport == http.RoundTripper(UntracedTransport) {
		t.Fatal("Start must trace the default transport and leave UntracedTransport alone")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/items/{id}", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) })
	// Sampling is 0: the trace is kept only because the request failed.
	Handler(mux, false).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/items/42", nil))
	shutdown()

	traces := requests("/v1/traces")
	if len(traces) == 0 {
		t.Fatal("no traces reached the endpoint")
	}
	if h := traces[0].header; h.Get("Authorization") != "Bearer xaat-test" || h.Get("X-Axiom-Dataset") != "shots-traces" ||
		h.Get("Content-Encoding") != "gzip" {
		t.Fatalf("unexpected trace headers: %v", h)
	}
	var export coltracepb.ExportTraceServiceRequest
	if err := proto.Unmarshal(traces[0].body, &export); err != nil {
		t.Fatal(err)
	}
	resource := map[string]string{}
	for _, kv := range export.ResourceSpans[0].Resource.Attributes {
		resource[kv.Key] = kv.Value.GetStringValue()
	}
	if resource["service.name"] != "publishing-backend" || resource["service.version"] != "abc123" || resource["deployment.environment.name"] != "test" {
		t.Fatalf("unexpected resource: %v", resource)
	}
	span := export.ResourceSpans[0].ScopeSpans[0].Spans[0]
	if span.Name != "GET /v1/items/{id}" || len(span.TraceId) != 16 {
		t.Fatalf("unexpected span %q", span.Name)
	}

	metrics := requests("/v1/metrics")
	if len(metrics) == 0 || metrics[0].header.Get("X-Axiom-Metrics-Dataset") != "shots-metrics" {
		t.Fatalf("metrics did not reach the endpoint with their dataset: %d", len(metrics))
	}
	var names []string
	for _, request := range metrics {
		var export colmetricpb.ExportMetricsServiceRequest
		if err := proto.Unmarshal(request.body, &export); err != nil {
			t.Fatal(err)
		}
		for _, resourceMetrics := range export.ResourceMetrics {
			for _, scope := range resourceMetrics.ScopeMetrics {
				for _, metric := range scope.Metrics {
					names = append(names, metric.Name)
					// Axiom's monitors here sum deltas over a window. (The runtime's own
					// go.schedule.duration stays cumulative.)
					if histogram := metric.GetHistogram(); metric.Name == "http.server.request.duration" &&
						histogram.AggregationTemporality != metricpb.AggregationTemporality_AGGREGATION_TEMPORALITY_DELTA {
						t.Fatalf("%s is exported as %s, want delta", metric.Name, histogram.AggregationTemporality)
					}
				}
			}
		}
	}
	for _, want := range []string{"http.server.request.duration", "go.goroutine.count"} {
		if !slices.Contains(names, want) {
			t.Fatalf("metrics lack %s: %v", want, names)
		}
	}
	if slices.Contains(names, "http.server.request.body.size") {
		t.Fatalf("body sizes must not be exported: %v", names)
	}
}

func TestStartSurvivesAHangingEndpoint(t *testing.T) {
	keepDefaultTransport(t)
	hung := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-hung }))
	t.Cleanup(func() { close(hung); server.Close() })
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("OTEL_SAMPLING_RATE", "1")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", server.URL)
	t.Setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "200")
	shutdown := Start(context.Background(), "publishing-backend")
	// A full queue drops spans instead of blocking the request path.
	endsWithin(t, otel.Tracer("test"), 10000, time.Second)
	// Exports retry until the shutdown budget of 5 seconds ends, never longer.
	started := time.Now()
	shutdown()
	if elapsed := time.Since(started); elapsed > 6*time.Second {
		t.Fatalf("shutdown took %s", elapsed)
	}
}

func TestShutdownFlushesMetricsWhileTracesRetry(t *testing.T) {
	keepDefaultTransport(t)
	var mu sync.Mutex
	metrics := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/traces" {
			w.WriteHeader(http.StatusServiceUnavailable) // Axiom throttling during a deploy.
			return
		}
		mu.Lock()
		metrics++
		mu.Unlock()
	}))
	t.Cleanup(server.Close)
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("OTEL_SAMPLING_RATE", "1")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", server.URL)
	shutdown := Start(context.Background(), "publishing-backend")
	_, span := otel.Tracer("test").Start(context.Background(), "request")
	span.End()
	started := time.Now()
	shutdown()
	mu.Lock()
	defer mu.Unlock()
	if metrics == 0 {
		t.Fatal("the final metrics must be sent while the trace export retries")
	}
	if elapsed := time.Since(started); elapsed > 6*time.Second {
		t.Fatalf("shutdown took %s", elapsed)
	}
}

func TestStartWithInvalidSettingsLeavesTheProcessAlone(t *testing.T) {
	keepDefaultTransport(t)
	transport := http.DefaultTransport
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("OTEL_SAMPLING_RATE", "2")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1")
	Start(context.Background(), "publishing-backend")()
	if http.DefaultTransport != transport {
		t.Fatal("invalid settings must not install telemetry")
	}
}

func TestPoolNamesStayUnique(t *testing.T) {
	name := fmt.Sprintf("pool-%d", time.Now().UnixNano())
	if first, second := uniqueName(name), uniqueName(name); first != name || second != name+"-2" {
		t.Fatalf("got %q and %q", first, second)
	}
}
