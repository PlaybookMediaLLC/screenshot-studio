package temporalpublishing

import (
	"context"
	"testing"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

func TestPostWorkflowV1PublishesAfterDurableRetry(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	publishCalls := 0
	env.RegisterActivityWithOptions(func(context.Context, PrepareInput) (PreparedPublication, error) {
		return PreparedPublication{PostID: "post-1", OrganizationID: "org-1", Ready: true}, nil
	}, activity.RegisterOptions{Name: PrepareActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input PublishInput) (PublishResult, error) {
		publishCalls++
		if publishCalls == 1 {
			return PublishResult{NextAttempt: input.AttemptNumber + 1, Outcome: OutcomeRetry, RetryAfter: time.Hour}, nil
		}
		return PublishResult{Outcome: OutcomePublished, ProviderID: "provider-post-1"}, nil
	}, activity.RegisterOptions{Name: PublishActivityName})
	env.ExecuteWorkflow(PostWorkflowV1, WorkflowInput{
		ActivityTaskQueue: DefaultActivityQueue, ActivityTimeout: time.Minute,
		MaxAttempts: 3, PostID: "post-1", RetryDelay: time.Hour,
		ScheduledFor: time.Now().Add(time.Hour),
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result WorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != OutcomePublished || result.ProviderID != "provider-post-1" || publishCalls != 2 {
		t.Fatalf("result=%#v publishCalls=%d", result, publishCalls)
	}
}

func TestPostWorkflowV1CancelsDuringDurableTimer(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(CancelSignalName, CancelSignal{})
	}, time.Minute)
	env.ExecuteWorkflow(PostWorkflowV1, WorkflowInput{
		ActivityTaskQueue: DefaultActivityQueue, ActivityTimeout: time.Minute,
		MaxAttempts: 3, PostID: "post-1", RetryDelay: time.Hour,
		ScheduledFor: time.Now().Add(time.Hour),
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result WorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != OutcomeCancelled {
		t.Fatalf("result=%#v", result)
	}
}
