package posts

import (
	"context"
	"fmt"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// postWorkflowInput is postWorkflowV112's argument.
type postWorkflowInput struct {
	TaskQueue      string `json:"taskQueue"`
	PostID         string `json:"postId"`
	OrganizationID string `json:"organizationId"`
}

// terminateRunning terminates every running workflow of the post. Failures
// are ignored, like Postiz.
func (s *Service) terminateRunning(ctx context.Context, postID string) {
	if s.temporal == nil {
		return
	}
	var token []byte
	for {
		res, err := s.temporal.ListWorkflow(ctx, &workflowservice.ListWorkflowExecutionsRequest{
			Query:         fmt.Sprintf(`postId="%s" AND ExecutionStatus="Running"`, postID),
			NextPageToken: token,
		})
		if err != nil {
			return
		}
		for _, info := range res.GetExecutions() {
			workflowID := info.GetExecution().GetWorkflowId()
			described, err := s.temporal.DescribeWorkflowExecution(ctx, workflowID, "")
			if err != nil {
				continue
			}
			if described.GetWorkflowExecutionInfo().GetStatus() != enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED {
				_ = s.temporal.TerminateWorkflow(ctx, workflowID, "", "")
			}
		}
		token = res.GetNextPageToken()
		if len(token) == 0 {
			return
		}
	}
}

// StartWorkflow terminates the post's running workflows and, unless it is a
// draft, starts postWorkflowV112 on the main queue; taskQueue is the
// provider's activity queue. Failures are ignored, like Postiz.
func (s *Service) StartWorkflow(ctx context.Context, taskQueue, postID, orgID string, state post.State) {
	s.terminateRunning(ctx, postID)

	if state == post.StateDRAFT || s.temporal == nil {
		return
	}

	_, _ = s.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                       "post_" + postID,
		TaskQueue:                temporalx.MainQueue,
		WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_TERMINATE_EXISTING,
		TypedSearchAttributes: temporal.NewSearchAttributes(
			temporalx.PostID.ValueSet(postID),
			temporalx.OrganizationID.ValueSet(orgID),
		),
	}, "postWorkflowV112", postWorkflowInput{TaskQueue: taskQueue, PostID: postID, OrganizationID: orgID})
}
