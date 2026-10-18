package sentryx

import (
	"testing"

	"github.com/getsentry/sentry-go"
)

func TestTracesSampler(t *testing.T) {
	span := func(name string) sentry.SamplingContext {
		return sentry.SamplingContext{Span: &sentry.Span{Name: name}}
	}
	cases := map[string]float64{
		"GET /mcp":                     0,
		"GET /mcp/abc":                 0,
		"GET /mcp-oauth/token":         0,
		"POST /mcp":                    0.1,
		"GET /mcpx":                    0.1,
		"GET /public/v1/analytics/abc": 0.01,
		"GET /posts":                   0.1,
	}
	for name, want := range cases {
		if got := tracesSampler(span(name)); got != want {
			t.Errorf("%s: %v", name, got)
		}
	}
	parent := span("GET /posts")
	parent.ParentSampled = sentry.SampledTrue
	if tracesSampler(parent) != 1 {
		t.Error("inherits the parent decision")
	}
	if capitalize("orchestrator") != "Orchestrator" {
		t.Error("capitalize")
	}
}
