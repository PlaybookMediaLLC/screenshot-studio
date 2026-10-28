package temporalpublishing

import (
	"path/filepath"
	"testing"

	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// Histories recorded on a real Temporal server with the PostWorkflowV2 code
// that ran before outcome writes got their own retry policy. Workflows in
// flight at deploy time must replay on the current code without a
// nondeterminism error.
func TestPostWorkflowV2ReplaysHistoriesFromBeforeRecordRetries(t *testing.T) {
	files, err := filepath.Glob("testdata/post_workflow_v2_*.json")
	if err != nil || len(files) != 4 {
		t.Fatalf("histories=%v err=%v", files, err)
	}
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflowWithOptions(PostWorkflowV2, workflow.RegisterOptions{Name: WorkflowNameV2})
	for _, file := range files {
		if err := replayer.ReplayWorkflowHistoryFromJSONFile(nil, file); err != nil {
			t.Errorf("%s: %v", file, err)
		}
	}
}
