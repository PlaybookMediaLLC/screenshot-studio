package temporalpublishing

import (
	"context"
	"testing"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

func TestPostWorkflowV2ConfirmsAcceptedPostWithoutRepeatingMutation(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	submitCalls := 0
	checkCalls := 0
	completedProviderID := ""
	env.RegisterActivityWithOptions(func(context.Context, PrepareInput) (PreparedPublication, error) {
		return PreparedPublication{PostID: "post-1", OrganizationID: "org-1", Ready: true}, nil
	}, activity.RegisterOptions{Name: PrepareActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input BeginInput) (BeginResult, error) {
		return BeginResult{AttemptID: "attempt-1", AttemptNumber: input.AttemptNumber}, nil
	}, activity.RegisterOptions{Name: BeginActivityName})
	env.RegisterActivityWithOptions(func(context.Context, SubmitInput) (PublishResult, error) {
		submitCalls++
		return PublishResult{Outcome: OutcomePending, ProviderID: "postiz-post-1"}, nil
	}, activity.RegisterOptions{Name: SubmitActivityName})
	env.RegisterActivityWithOptions(func(context.Context, CheckInput) (PublishResult, error) {
		checkCalls++
		if checkCalls == 1 {
			return PublishResult{Outcome: OutcomePending}, nil
		}
		return PublishResult{Outcome: OutcomePublished, ProviderID: "provider-post-1"}, nil
	}, activity.RegisterOptions{Name: CheckActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input CompleteInput) error {
		completedProviderID = input.ProviderID
		return nil
	}, activity.RegisterOptions{Name: CompleteActivityName})
	env.ExecuteWorkflow(PostWorkflowV2, WorkflowInput{
		ActivityTaskQueue: DefaultActivityQueue, ActivityTimeout: time.Minute,
		MainTaskQueue: DefaultWorkflowQueue, MaxAttempts: 3, PostID: "post-1",
		RetryDelay: time.Hour, ScheduledFor: time.Now().Add(time.Hour),
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result WorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != OutcomePublished || result.ProviderID != "provider-post-1" || submitCalls != 1 || checkCalls != 2 || completedProviderID != "provider-post-1" {
		t.Fatalf("result=%#v submit=%d checks=%d completed=%q", result, submitCalls, checkCalls, completedProviderID)
	}
}

func TestPostWorkflowV2MarksTimedOutMutationUnknown(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	markedUnknown := false
	env.RegisterActivityWithOptions(func(context.Context, PrepareInput) (PreparedPublication, error) {
		return PreparedPublication{PostID: "post-1", OrganizationID: "org-1", Ready: true}, nil
	}, activity.RegisterOptions{Name: PrepareActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input BeginInput) (BeginResult, error) {
		return BeginResult{AttemptID: "attempt-1", AttemptNumber: input.AttemptNumber}, nil
	}, activity.RegisterOptions{Name: BeginActivityName})
	env.RegisterActivityWithOptions(func(context.Context, SubmitInput) (PublishResult, error) {
		return PublishResult{}, context.DeadlineExceeded
	}, activity.RegisterOptions{Name: SubmitActivityName})
	env.RegisterActivityWithOptions(func(context.Context, MarkUnknownInput) error {
		markedUnknown = true
		return nil
	}, activity.RegisterOptions{Name: MarkUnknownActivityName})
	env.ExecuteWorkflow(PostWorkflowV2, WorkflowInput{
		ActivityTaskQueue: DefaultActivityQueue, ActivityTimeout: time.Minute,
		MainTaskQueue: DefaultWorkflowQueue, MaxAttempts: 3, PostID: "post-1",
		RetryDelay: time.Hour, ScheduledFor: time.Now(),
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result WorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if !markedUnknown || result.Outcome != OutcomeFailed || result.FailureCode != "UNKNOWN_DELIVERY" {
		t.Fatalf("result=%#v markedUnknown=%v", result, markedUnknown)
	}
}

func TestPostWorkflowV2StopsAfterLastRateLimitAttempt(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	submitCalls := 0
	failures := make([]FailInput, 0, 3)
	env.RegisterActivityWithOptions(func(context.Context, PrepareInput) (PreparedPublication, error) {
		return PreparedPublication{PostID: "post-1", OrganizationID: "org-1", Ready: true}, nil
	}, activity.RegisterOptions{Name: PrepareActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input BeginInput) (BeginResult, error) {
		return BeginResult{AttemptID: "attempt", AttemptNumber: input.AttemptNumber}, nil
	}, activity.RegisterOptions{Name: BeginActivityName})
	env.RegisterActivityWithOptions(func(context.Context, SubmitInput) (PublishResult, error) {
		submitCalls++
		return PublishResult{FailureCode: "429", Outcome: OutcomeRetry}, nil
	}, activity.RegisterOptions{Name: SubmitActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input FailInput) error {
		failures = append(failures, input)
		return nil
	}, activity.RegisterOptions{Name: FailActivityName})
	env.ExecuteWorkflow(PostWorkflowV2, WorkflowInput{
		ActivityTaskQueue: DefaultActivityQueue, ActivityTimeout: time.Minute,
		MainTaskQueue: DefaultWorkflowQueue, MaxAttempts: 3, PostID: "post-1",
		RetryDelay: time.Hour, ScheduledFor: time.Now(),
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result WorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if submitCalls != 3 || len(failures) != 3 || !failures[2].RetryAt.IsZero() || result.Outcome != OutcomeFailed || result.FailureCode != "429" {
		t.Fatalf("result=%#v submit=%d failures=%#v", result, submitCalls, failures)
	}
}
