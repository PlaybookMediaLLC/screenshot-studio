// Package workflows ports apps/orchestrator/src/workflows and signals. Every
// workflow is registered under its TypeScript function name and calls
// activities by their TypeScript names (see the activities contract), with
// the same options, timers, signals, child workflows and IDs.
//
// TypeScript `patched(id)` is workflow.GetVersion(ctx, id, DefaultVersion, 1)
// == 1: true for new runs, false when replaying a run recorded before it.
package workflows

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

// Signal names (defineSignal).
const (
	PokeSignal      = "poke"
	EmailSignal     = "email"
	SendEmailSignal = "sendEmail"
)

// Email is the digest signal item.
type Email struct {
	Message string  `json:"message"`
	Title   *string `json:"title,omitempty"`
	Type    string  `json:"type"` // success | fail | info
}

// SendEmail is the sendEmail signal / sendSingleEmailWorkflow argument.
type SendEmail struct {
	To      string  `json:"to"`
	Subject string  `json:"subject"`
	HTML    string  `json:"html"`
	ReplyTo *string `json:"replyTo,omitempty"`
	AddTo   string  `json:"addTo"` // top | bottom
}

// Register registers every workflow under its TypeScript name.
func Register(w worker.WorkflowRegistry) {
	for name, fn := range map[string]any{
		"postWorkflowV101":        PostWorkflowV101,
		"postWorkflowV102":        PostWorkflowV102,
		"postWorkflowV103":        PostWorkflowV103,
		"postWorkflowV104":        PostWorkflowV104,
		"postWorkflowV105":        PostWorkflowV105,
		"postWorkflowV106":        PostWorkflowV106,
		"postWorkflowV107":        PostWorkflowV107,
		"postWorkflowV108":        PostWorkflowV108,
		"postWorkflowV109":        PostWorkflowV109,
		"postWorkflowV110":        PostWorkflowV110,
		"postWorkflowV111":        PostWorkflowV111,
		"postWorkflowV112":        PostWorkflowV112,
		"autoPostWorkflow":        AutoPostWorkflow,
		"digestEmailWorkflow":     DigestEmailWorkflow,
		"missingPostWorkflow":     MissingPostWorkflow,
		"sendSingleEmailWorkflow": SendSingleEmailWorkflow,
		"sendEmailWorkflow":       SendEmailWorkflow,
		"refreshTokenWorkflow":    RefreshTokenWorkflow,
		"streakWorkflow":          StreakWorkflow,
		"streakWorkflowV2":        StreakWorkflowV2,
		"generateVideoWorkflow":   GenerateVideoWorkflow,
		"processMediaWorkflow":    ProcessMediaWorkflow,
		"clippingClipWorkflow":    ClippingClipWorkflow,
		"clippingWorkflow":        ClippingWorkflow,
	} {
		w.RegisterWorkflowWithOptions(fn, workflow.RegisterOptions{Name: name})
	}
}

// retry is a proxyActivities retry block.
func retry(attempts int32, backoff float64, initial time.Duration) *temporal.RetryPolicy {
	return &temporal.RetryPolicy{MaximumAttempts: attempts, BackoffCoefficient: backoff, InitialInterval: initial}
}

// Used by most proxies: { maximumAttempts: 3, backoffCoefficient: 1, initialInterval: '2 minutes' }.
var retry3x2m = retry(3, 1, 2*time.Minute)

// once is { maximumAttempts: 1 }.
var once = &temporal.RetryPolicy{MaximumAttempts: 1}

// activityCtx is proxyActivities: an empty taskQueue means the workflow's.
func activityCtx(ctx workflow.Context, taskQueue string, startToClose, heartbeat time.Duration, policy *temporal.RetryPolicy) workflow.Context {
	return workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           taskQueue,
		StartToCloseTimeout: startToClose,
		HeartbeatTimeout:    heartbeat,
		RetryPolicy:         policy,
	})
}

// call runs an activity by name and decodes its result into out (nil to
// ignore it).
func call(ctx workflow.Context, out any, name string, args ...any) error {
	return workflow.ExecuteActivity(ctx, name, args...).Get(ctx, out)
}

// sleep is the TypeScript SDK's sleep, which never schedules a timer shorter
// than 1ms.
func sleep(ctx workflow.Context, d time.Duration) error {
	return workflow.Sleep(ctx, max(d, time.Millisecond))
}

func ms(n float64) time.Duration {
	return time.Duration(n * float64(time.Millisecond))
}

func nowMs(ctx workflow.Context) int64 {
	return workflow.Now(ctx).UnixMilli()
}

// patched is TypeScript's patched(id).
func patched(ctx workflow.Context, id string) bool {
	return workflow.GetVersion(ctx, id, workflow.DefaultVersion, 1) == 1
}

// capitalize is lodash's: lower case, then the first character upper case.
func capitalize(s string) string {
	s = strings.ToLower(s)
	r, n := utf8.DecodeRuneInString(s)
	if n == 0 {
		return s
	}
	return strings.ToUpper(string(r)) + s[n:]
}

// activityCause is TypeScript's `err instanceof ActivityFailure ? err.cause`.
func activityCause(err error) (error, bool) {
	var act *temporal.ActivityError
	if !errors.As(err, &act) {
		return nil, false
	}
	return act.Unwrap(), true
}

// failureMessage is a TemporalFailure's message.
func failureMessage(err error) string {
	if m, ok := err.(interface{ Message() string }); ok {
		return m.Message()
	}
	if err == nil {
		return ""
	}
	return err.Error()
}

// errorValue is JSON.stringify of what the TypeScript workflows hand to
// changeState as `err`: strings as they are, an ActivityFailure as its own
// fields, its decoded cause, and the raw failure protos the SDK attaches to
// both (posts.repository curatedError reads cause.type + cause.failure.message
// or failure.cause.applicationFailureInfo.type + failure.cause.message). Any
// other error serializes like a JavaScript Error: {}.
func errorValue(reason any) any {
	err, ok := reason.(error)
	if !ok {
		return reason
	}
	var act *temporal.ActivityError
	if !errors.As(err, &act) {
		return struct{}{}
	}
	out := map[string]any{
		"activityType": act.ActivityType().GetName(),
		"activityId":   act.ActivityID(),
		"retryState":   strings.TrimPrefix(act.RetryState().String(), "RETRY_STATE_"),
		"identity":     act.Identity(),
		"failure":      failureProto(act),
	}
	if cause := act.Unwrap(); cause != nil {
		c := map[string]any{"failure": failureProto(cause)}
		switch e := cause.(type) {
		case *temporal.ApplicationError:
			c["type"] = e.Type()
			c["nonRetryable"] = e.NonRetryable()
			c["details"] = decodePayloads(temporal.GetDefaultFailureConverter().ErrorToFailure(e).GetApplicationFailureInfo().GetDetails().GetPayloads())
		case *temporal.TimeoutError:
			c["timeoutType"] = strings.TrimPrefix(e.TimeoutType().String(), "TIMEOUT_TYPE_")
			if e.HasLastHeartbeatDetails() {
				var d any
				if e.LastHeartbeatDetails(&d) == nil {
					c["lastHeartbeatDetails"] = d
				}
			}
		}
		out["cause"] = c
	}
	return out
}

func failureProto(err error) json.RawMessage {
	data, err := protojson.Marshal(temporal.GetDefaultFailureConverter().ErrorToFailure(err))
	if err != nil {
		return json.RawMessage("null")
	}
	return data
}

func decodePayloads(payloads []*commonpb.Payload) []any {
	out := []any{}
	for _, p := range payloads {
		var v any
		_ = converter.GetDefaultDataConverter().FromPayload(p, &v)
		out = append(out, v)
	}
	return out
}
