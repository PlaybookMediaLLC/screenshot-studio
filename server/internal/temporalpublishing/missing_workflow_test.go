package temporalpublishing

import (
	"context"
	"testing"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

func TestMissingPostWorkflowRunsImmediatelyAndHourly(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	calls := 0
	env.RegisterActivityWithOptions(func(context.Context) (int, error) {
		calls++
		return 0, nil
	}, activity.RegisterOptions{Name: RecoverActivityName})
	env.RegisterDelayedCallback(env.CancelWorkflow, 2*time.Hour+time.Minute)
	env.ExecuteWorkflow(MissingPostWorkflow)
	if calls != 3 {
		t.Fatalf("recovery calls = %d, want 3", calls)
	}
}
