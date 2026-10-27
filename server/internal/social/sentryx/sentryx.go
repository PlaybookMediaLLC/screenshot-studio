// Package sentryx initializes Sentry and holds the
// error capture rule.
package sentryx

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"regexp"
	"strings"

	"github.com/getsentry/sentry-go"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// MCP stream GETs are declined with 405; never trace them.
var mcpPath = regexp.MustCompile(`^(https?://[^/]+)?/mcp(/|-oauth|\?|$)`)

// capitalize is lodash's capitalize.
func capitalize(s string) string {
	if s == "" {
		return s
	}
	lower := strings.ToLower(s)
	return strings.ToUpper(lower[:1]) + lower[1:]
}

// tracesSampler drops MCP stream GETs, keeps 1% of public analytics calls
// and 10% of the rest, inheriting the parent's decision when there is one.
func tracesSampler(ctx sentry.SamplingContext) float64 {
	path, method := "", ""
	if span := ctx.Span; span != nil {
		for _, key := range []string{"url.full", "http.target", "url.path"} {
			if v, ok := span.Data[key].(string); ok && v != "" && path == "" {
				path = v
			}
		}
		for _, key := range []string{"http.request.method", "http.method"} {
			if v, ok := span.Data[key].(string); ok && v != "" && method == "" {
				method = v
			}
		}
		name := span.Name
		// sentryhttp names transactions "METHOD /path"
		if m, p, found := strings.Cut(name, " "); found && strings.HasPrefix(p, "/") {
			if method == "" {
				method = m
			}
			name = p
		}
		if path == "" {
			path = name
		}
	}
	if method == "GET" && mcpPath.MatchString(path) {
		return 0
	}

	// inheritOrSampleWith
	if ctx.ParentSampleRate != nil {
		return *ctx.ParentSampleRate
	}
	switch ctx.ParentSampled {
	case sentry.SampledTrue:
		return 1
	case sentry.SampledFalse:
		return 0
	}
	if strings.Contains(path, "/public/v1/analytics/") {
		return 0.01
	}
	return 0.1
}

// Initialize is initializeSentry: it does nothing without
// NEXT_PUBLIC_SENTRY_DSN and reports whether Sentry was set up.
func Initialize(appName string) bool {
	dsn := os.Getenv("NEXT_PUBLIC_SENTRY_DSN")
	if dsn == "" {
		return false
	}
	environment := os.Getenv("NODE_ENV")
	if environment == "" {
		environment = "development"
	}
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:           dsn,
		Environment:   environment,
		EnableTracing: true,
		TracesSampler: tracesSampler,
	}); err != nil {
		slog.Error("sentry init failed", "error", err)
		return true
	}
	sentry.ConfigureScope(func(scope *sentry.Scope) {
		scope.SetTag("service", appName)
		scope.SetTag("component", "nestjs")
		scope.SetContext("app", sentry.Context{"name": "Social " + capitalize(appName)})
	})
	return true
}

// UserContext is setSentryUserContext's params.
type UserContext struct {
	UserID    string
	Email     string
	OrgID     string
	PaymentID string
}

func hub(ctx context.Context) *sentry.Hub {
	if h := sentry.GetHubFromContext(ctx); h != nil {
		return h
	}
	return sentry.CurrentHub()
}

// SetUserContext tags the request's scope with the user, organization and
// Stripe customer. Telemetry never breaks a request.
func SetUserContext(ctx context.Context, params UserContext) {
	hub(ctx).ConfigureScope(func(scope *sentry.Scope) {
		if params.UserID != "" {
			scope.SetUser(sentry.User{ID: params.UserID, Email: params.Email})
		} else {
			scope.SetUser(sentry.User{})
		}
		if params.OrgID != "" {
			scope.SetTag("organization.id", params.OrgID)
		}
		if strings.HasPrefix(params.PaymentID, "cus_") {
			scope.SetTag("stripe.customer_id", params.PaymentID)
		}
	})
}

// CaptureException is SentryGlobalFilter: expected errors (HTTP exceptions)
// are not reported, everything else is.
func CaptureException(ctx context.Context, err error) {
	var httpErr *httpx.Error
	if err == nil || errors.As(err, &httpErr) {
		return
	}
	hub(ctx).CaptureException(err)
}
