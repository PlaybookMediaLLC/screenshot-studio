package temporalpublishing

import (
	"context"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
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
		return PublishResult{Outcome: OutcomePending, ProviderID: "social-post-1"}, nil
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

func TestPostWorkflowV2CompletesDirectReceiptWithoutSecondPostPoll(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	submissions := 0
	completedID := ""
	env.RegisterActivityWithOptions(func(context.Context, PrepareInput) (PreparedPublication, error) {
		return PreparedPublication{PostID: "post-1", OrganizationID: "org-1", Ready: true}, nil
	}, activity.RegisterOptions{Name: PrepareActivityName})
	env.RegisterActivityWithOptions(func(context.Context, BeginInput) (BeginResult, error) {
		return BeginResult{AttemptID: "attempt-1", AttemptNumber: 1}, nil
	}, activity.RegisterOptions{Name: BeginActivityName})
	env.RegisterActivityWithOptions(func(context.Context, SubmitInput) (PublishResult, error) {
		submissions++
		return PublishResult{Outcome: OutcomePublished, ProviderID: "remote-post-1"}, nil
	}, activity.RegisterOptions{Name: SubmitActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input CompleteInput) error {
		completedID = input.ProviderID
		return nil
	}, activity.RegisterOptions{Name: CompleteActivityName})
	env.ExecuteWorkflow(PostWorkflowV2, WorkflowInput{
		ActivityTaskQueue: DefaultActivityQueue, ActivityTimeout: time.Minute,
		MainTaskQueue: DefaultWorkflowQueue, MaxAttempts: 3, PostID: "post-1",
		RetryDelay: time.Hour, ScheduledFor: time.Now(),
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	var result WorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil || result.Outcome != OutcomePublished || result.ProviderID != "remote-post-1" || submissions != 1 || completedID != "remote-post-1" {
		t.Fatalf("result=%#v submit=%d completed=%q err=%v", result, submissions, completedID, err)
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

// A live post's follow-ups run on schedule: the like-gated repost is tried
// until it is done, and the quote goes out once, after its delay.
func TestPostWorkflowV2RunsAutoActionsAfterPublishing(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	var calls []AutoActionsInput
	env.RegisterActivityWithOptions(func(context.Context, PrepareInput) (PreparedPublication, error) {
		return PreparedPublication{PostID: "post-1", OrganizationID: "org-1", Ready: true,
			AutoActions: &postoptions.AutoActions{RepostAtLikes: 10, QuoteAfterHours: 12, QuoteText: "Still true"}}, nil
	}, activity.RegisterOptions{Name: PrepareActivityName})
	env.RegisterActivityWithOptions(func(context.Context, BeginInput) (BeginResult, error) {
		return BeginResult{AttemptID: "attempt-1", AttemptNumber: 1}, nil
	}, activity.RegisterOptions{Name: BeginActivityName})
	env.RegisterActivityWithOptions(func(context.Context, SubmitInput) (PublishResult, error) {
		return PublishResult{Outcome: OutcomePublished, ProviderID: "remote-post-1"}, nil
	}, activity.RegisterOptions{Name: SubmitActivityName})
	env.RegisterActivityWithOptions(func(context.Context, CompleteInput) error { return nil },
		activity.RegisterOptions{Name: CompleteActivityName})
	env.RegisterActivityWithOptions(func(_ context.Context, input AutoActionsInput) (AutoActionsResult, error) {
		calls = append(calls, input)
		// The repost reaches its likes on the second check.
		return AutoActionsResult{Quoted: input.Quote, Reposted: len(calls) >= 2}, nil
	}, activity.RegisterOptions{Name: AutoActionsActivityName})
	env.ExecuteWorkflow(PostWorkflowV2, WorkflowInput{
		ActivityTaskQueue: DefaultActivityQueue, ActivityTimeout: time.Minute,
		MainTaskQueue: DefaultWorkflowQueue, MaxAttempts: 3, PostID: "post-1",
		RetryDelay: time.Hour, ScheduledFor: time.Now(),
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	// 6h: repost only; 12h: repost (done) and the quote; then nothing is left.
	if len(calls) != 2 || !calls[0].Repost || calls[0].Quote || !calls[1].Repost || !calls[1].Quote ||
		calls[1].ProviderID != "remote-post-1" {
		t.Fatalf("calls=%+v", calls)
	}
}
