package temporalpublishing

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func PostWorkflowV1(ctx workflow.Context, input WorkflowInput) (WorkflowResult, error) {
	cancelSignal := workflow.GetSignalChannel(ctx, CancelSignalName)
	if waitForCancel(ctx, cancelSignal, input.ScheduledFor.Sub(workflow.Now(ctx))) {
		return WorkflowResult{Outcome: OutcomeCancelled}, nil
	}

	prepareCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:              input.ActivityTaskQueue,
		StartToCloseTimeout:    2 * time.Minute,
		ScheduleToCloseTimeout: 10 * time.Minute,
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
	runID := workflow.GetInfo(ctx).WorkflowExecution.RunID
	attemptNumber := 1
	for attemptNumber <= input.MaxAttempts {
		if receiveCancel(cancelSignal) {
			return WorkflowResult{Outcome: OutcomeCancelled}, nil
		}
		var job PreparedPublication
		if err := workflow.ExecuteActivity(prepareCtx, PrepareActivityName, PrepareInput{
			PostID: input.PostID, RunID: runID,
		}).Get(ctx, &job); err != nil {
			return WorkflowResult{}, err
		}
		if !job.Ready {
			return WorkflowResult{Outcome: OutcomeSkipped}, nil
		}

		var result PublishResult
		err := workflow.ExecuteActivity(mutationCtx, PublishActivityName, PublishInput{
			AttemptNumber: attemptNumber,
			Job:           job,
			MaxAttempts:   input.MaxAttempts,
			RetryDelay:    input.RetryDelay,
			RunID:         runID,
		}).Get(ctx, &result)
		if err != nil {
			markErr := workflow.ExecuteActivity(prepareCtx, MarkUnknownActivityName, MarkUnknownInput{
				AttemptNumber: attemptNumber, PostID: input.PostID, RunID: runID,
			}).Get(ctx, nil)
			if markErr != nil {
				return WorkflowResult{}, markErr
			}
			return WorkflowResult{FailureCode: "UNKNOWN_DELIVERY", Outcome: OutcomeFailed}, nil
		}
		if result.Outcome != OutcomeRetry {
			return WorkflowResult{FailureCode: result.FailureCode, Outcome: result.Outcome, ProviderID: result.ProviderID}, nil
		}
		attemptNumber = result.NextAttempt
		if waitForCancel(ctx, cancelSignal, result.RetryAfter) {
			return WorkflowResult{Outcome: OutcomeCancelled}, nil
		}
	}
	return WorkflowResult{FailureCode: "MAX_ATTEMPTS", Outcome: OutcomeFailed}, nil
}

func waitForCancel(ctx workflow.Context, signal workflow.ReceiveChannel, delay time.Duration) bool {
	if receiveCancel(signal) {
		return true
	}
	if delay <= 0 {
		return false
	}
	timerCtx, cancelTimer := workflow.WithCancel(ctx)
	defer cancelTimer()
	cancelled := false
	selector := workflow.NewSelector(ctx)
	selector.AddFuture(workflow.NewTimer(timerCtx, delay), func(f workflow.Future) { _ = f.Get(ctx, nil) })
	selector.AddReceive(signal, func(channel workflow.ReceiveChannel, _ bool) {
		var value CancelSignal
		channel.Receive(ctx, &value)
		cancelled = true
		cancelTimer()
	})
	selector.Select(ctx)
	return cancelled
}

func receiveCancel(signal workflow.ReceiveChannel) bool {
	var value CancelSignal
	return signal.ReceiveAsync(&value)
}
