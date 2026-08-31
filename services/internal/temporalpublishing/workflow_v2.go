package temporalpublishing

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	maxPendingChecks       = 90
	maxStatusCheckFailures = 5
	pendingCheckInterval   = 20 * time.Second
)

func PostWorkflowV2(ctx workflow.Context, input WorkflowInput) (WorkflowResult, error) {
	cancelSignal := workflow.GetSignalChannel(ctx, CancelSignalName)
	pokeSignal := workflow.GetSignalChannel(ctx, PokeSignalName)
	if waitForCancelAndDrainPoke(ctx, cancelSignal, pokeSignal, input.ScheduledFor.Sub(workflow.Now(ctx))) {
		return WorkflowResult{Outcome: OutcomeCancelled}, nil
	}

	mainCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           input.MainTaskQueue,
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Minute,
			BackoffCoefficient: 1,
			MaximumAttempts:    3,
		},
	})
	mutationCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           input.ActivityTaskQueue,
		StartToCloseTimeout: input.ActivityTimeout,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 1},
	})
	checkCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           input.ActivityTaskQueue,
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    10 * time.Second,
			BackoffCoefficient: 1,
			MaximumAttempts:    3,
		},
	})

	runID := workflow.GetInfo(ctx).WorkflowExecution.RunID
	for attemptNumber := 1; attemptNumber <= input.MaxAttempts; attemptNumber++ {
		drainPoke(pokeSignal)
		if receiveCancel(cancelSignal) {
			return WorkflowResult{Outcome: OutcomeCancelled}, nil
		}
		var job PreparedPublication
		if err := workflow.ExecuteActivity(mainCtx, PrepareActivityName, PrepareInput{
			PostID: input.PostID, RunID: runID,
		}).Get(ctx, &job); err != nil {
			return WorkflowResult{}, err
		}
		if !job.Ready {
			return WorkflowResult{Outcome: OutcomeSkipped}, nil
		}

		var attempt BeginResult
		if err := workflow.ExecuteActivity(mainCtx, BeginActivityName, BeginInput{
			AttemptNumber: attemptNumber, Job: job, RunID: runID,
		}).Get(ctx, &attempt); err != nil {
			return WorkflowResult{}, err
		}

		var submitted PublishResult
		if err := workflow.ExecuteActivity(mutationCtx, SubmitActivityName, SubmitInput{Job: job}).Get(ctx, &submitted); err != nil {
			return markUnknown(ctx, mainCtx, job.PostID, runID, attemptNumber)
		}
		switch submitted.Outcome {
		case OutcomeRetry:
			if attemptNumber >= input.MaxAttempts {
				if err := failAttempt(ctx, mainCtx, attempt, job, runID, submitted.FailureCode, time.Time{}); err != nil {
					return WorkflowResult{}, err
				}
				return WorkflowResult{FailureCode: submitted.FailureCode, Outcome: OutcomeFailed}, nil
			}
			retryAt := workflow.Now(ctx).Add(input.RetryDelay)
			if err := failAttempt(ctx, mainCtx, attempt, job, runID, submitted.FailureCode, retryAt); err != nil {
				return WorkflowResult{}, err
			}
			if waitForCancelAndDrainPoke(ctx, cancelSignal, pokeSignal, input.RetryDelay) {
				return WorkflowResult{Outcome: OutcomeCancelled}, nil
			}
			continue
		case OutcomeFailed:
			if err := failAttempt(ctx, mainCtx, attempt, job, runID, submitted.FailureCode, time.Time{}); err != nil {
				return WorkflowResult{}, err
			}
			return WorkflowResult{FailureCode: submitted.FailureCode, Outcome: OutcomeFailed}, nil
		case OutcomeUnknown:
			return markUnknown(ctx, mainCtx, job.PostID, runID, attemptNumber)
		case OutcomePublished:
			if err := completeAttempt(ctx, mainCtx, attempt, job, runID, submitted.ProviderID); err != nil {
				return WorkflowResult{}, err
			}
			return WorkflowResult{Outcome: OutcomePublished, ProviderID: submitted.ProviderID}, nil
		}

		result, err := awaitPostizConfirmation(ctx, checkCtx, mainCtx, attempt, job, runID, submitted.ProviderID)
		if err != nil {
			return WorkflowResult{}, err
		}
		return result, nil
	}
	return WorkflowResult{FailureCode: "MAX_ATTEMPTS", Outcome: OutcomeFailed}, nil
}

func awaitPostizConfirmation(
	ctx workflow.Context,
	checkCtx workflow.Context,
	mainCtx workflow.Context,
	attempt BeginResult,
	job PreparedPublication,
	runID string,
	postizPostID string,
) (WorkflowResult, error) {
	consecutiveFailures := 0
	for check := 0; check < maxPendingChecks; check++ {
		var status PublishResult
		err := workflow.ExecuteActivity(checkCtx, CheckActivityName, CheckInput{
			Job: job, ProviderID: postizPostID,
		}).Get(ctx, &status)
		if err != nil {
			consecutiveFailures++
			if consecutiveFailures >= maxStatusCheckFailures {
				return markUnknown(ctx, mainCtx, job.PostID, runID, attempt.AttemptNumber)
			}
		} else {
			consecutiveFailures = 0
			switch status.Outcome {
			case OutcomePublished:
				providerID := status.ProviderID
				if providerID == "" {
					providerID = postizPostID
				}
				if err := completeAttempt(ctx, mainCtx, attempt, job, runID, providerID); err != nil {
					return WorkflowResult{}, err
				}
				return WorkflowResult{Outcome: OutcomePublished, ProviderID: providerID}, nil
			case OutcomeFailed:
				if err := failAttempt(ctx, mainCtx, attempt, job, runID, status.FailureCode, time.Time{}); err != nil {
					return WorkflowResult{}, err
				}
				return WorkflowResult{FailureCode: status.FailureCode, Outcome: OutcomeFailed}, nil
			}
		}
		if check+1 < maxPendingChecks {
			if err := workflow.Sleep(ctx, pendingCheckInterval); err != nil {
				return WorkflowResult{}, err
			}
		}
	}
	return markUnknown(ctx, mainCtx, job.PostID, runID, attempt.AttemptNumber)
}

func completeAttempt(ctx, activityCtx workflow.Context, attempt BeginResult, job PreparedPublication, runID, providerID string) error {
	return workflow.ExecuteActivity(activityCtx, CompleteActivityName, CompleteInput{
		AttemptID: attempt.AttemptID, Job: job, ProviderID: providerID, RunID: runID,
	}).Get(ctx, nil)
}

func failAttempt(ctx, activityCtx workflow.Context, attempt BeginResult, job PreparedPublication, runID, failureCode string, retryAt time.Time) error {
	return workflow.ExecuteActivity(activityCtx, FailActivityName, FailInput{
		AttemptID: attempt.AttemptID, AttemptNumber: attempt.AttemptNumber,
		FailureCode: failureCode, Job: job, RetryAt: retryAt, RunID: runID,
	}).Get(ctx, nil)
}

func markUnknown(ctx, activityCtx workflow.Context, postID, runID string, attemptNumber int) (WorkflowResult, error) {
	err := workflow.ExecuteActivity(activityCtx, MarkUnknownActivityName, MarkUnknownInput{
		AttemptNumber: attemptNumber, PostID: postID, RunID: runID,
	}).Get(ctx, nil)
	if err != nil {
		return WorkflowResult{}, err
	}
	return WorkflowResult{FailureCode: "UNKNOWN_DELIVERY", Outcome: OutcomeFailed}, nil
}

func drainPoke(signal workflow.ReceiveChannel) {
	var value PokeSignal
	for signal.ReceiveAsync(&value) {
	}
}

func waitForCancelAndDrainPoke(ctx workflow.Context, cancelSignal, pokeSignal workflow.ReceiveChannel, delay time.Duration) bool {
	if receiveCancel(cancelSignal) {
		return true
	}
	drainPoke(pokeSignal)
	if delay <= 0 {
		return false
	}
	timerCtx, cancelTimer := workflow.WithCancel(ctx)
	defer cancelTimer()
	timer := workflow.NewTimer(timerCtx, delay)
	for {
		cancelled := false
		finished := false
		selector := workflow.NewSelector(ctx)
		selector.AddFuture(timer, func(f workflow.Future) {
			_ = f.Get(ctx, nil)
			finished = true
		})
		selector.AddReceive(cancelSignal, func(channel workflow.ReceiveChannel, _ bool) {
			var value CancelSignal
			channel.Receive(ctx, &value)
			cancelled = true
			cancelTimer()
		})
		selector.AddReceive(pokeSignal, func(channel workflow.ReceiveChannel, _ bool) {
			var value PokeSignal
			channel.Receive(ctx, &value)
		})
		selector.Select(ctx)
		if cancelled || finished {
			return cancelled
		}
	}
}
