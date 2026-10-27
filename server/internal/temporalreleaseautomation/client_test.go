package temporalreleaseautomation

import (
	"context"
	"errors"
	"testing"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

type startFixture struct {
	client.Client
	starts []client.StartWorkflowOptions
	closed bool
	fail   error
}
type runFixture struct{ client.WorkflowRun }

func (runFixture) GetRunID() string { return "existing-execution" }
func (f *startFixture) ExecuteWorkflow(_ context.Context, options client.StartWorkflowOptions, _ interface{}, _ ...interface{}) (client.WorkflowRun, error) {
	f.starts = append(f.starts, options)
	if f.fail != nil {
		return nil, f.fail
	}
	if f.closed {
		return nil, &serviceerror.WorkflowExecutionAlreadyStarted{RunId: "existing-execution"}
	}
	return runFixture{}, nil
}

func TestDispatchRecoversLostAcknowledgement(t *testing.T) {
	f := &startFixture{}
	c := &Client{Temporal: f}
	for _, closed := range []bool{false, false, true} {
		f.closed = closed
		id, err := c.Start(context.Background(), "org", "logical-run", 0)
		if err != nil || id != "existing-execution" {
			t.Fatalf("recovery %q: %v", id, err)
		}
	}
	for _, options := range f.starts {
		if options.ID != "release-automation-logical-run" || options.WorkflowIDConflictPolicy != enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING || options.WorkflowIDReusePolicy != enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE {
			t.Fatalf("unsafe start: %+v", options)
		}
	}
	if StartOptions("logical-run", 1).ID != "release-automation-logical-run-recovery-1" {
		t.Fatal("explicit recovery needs a distinct execution, not a new logical action")
	}
	f.fail = errors.New("Temporal unavailable")
	if _, err := c.Start(context.Background(), "org", "logical-run", 0); err == nil {
		t.Fatal("dispatch outage acknowledged")
	}
}
