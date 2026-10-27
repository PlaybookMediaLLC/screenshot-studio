package temporalpublishing

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func MissingPostWorkflow(ctx workflow.Context) error {
	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           workflow.GetInfo(ctx).TaskQueueName,
		StartToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Minute,
			BackoffCoefficient: 1,
			MaximumAttempts:    3,
		},
	})
	for {
		if err := workflow.ExecuteActivity(activityCtx, RecoverActivityName).Get(ctx, nil); err != nil {
			return err
		}
		if err := workflow.Sleep(ctx, time.Hour); err != nil {
			return err
		}
	}
}
