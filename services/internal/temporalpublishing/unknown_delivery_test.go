package temporalpublishing

import (
	"context"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func TestLegacyAutoActionsStopUnknownDelivery(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.OnGetVersion("post-auto-actions", workflow.DefaultVersion, 2).Return(workflow.Version(1))
	calls := 0
	env.RegisterActivityWithOptions(func(context.Context, AutoActionsInput) (AutoActionsResult, error) {
		calls++
		return AutoActionsResult{}, temporal.NewNonRetryableApplicationError("Uncertain reply", FailureUnknownDelivery, nil)
	}, activity.RegisterOptions{Name: AutoActionsActivityName})
	env.ExecuteWorkflow(func(ctx workflow.Context) error {
		runAutoActions(ctx, WorkflowInput{ActivityTaskQueue: "social"}, PreparedPublication{PostID: "p", AutoActions: &postoptions.AutoActions{PlugAtLikes: 1, PlugText: "reply"}}, "42")
		return nil
	})
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("uncertain follow-up retried %d times", calls)
	}
	err := temporal.NewNonRetryableApplicationError("private content", FailureUnknownDelivery, nil)
	if automationFailureCode(err) != "UNKNOWN_DELIVERY" {
		t.Fatal("uncertainty lost from automation receipt")
	}
}
