package temporalonboarding

import (
	"context"
	"errors"
	"fmt"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// ErrBusy is a start that found the workspace's previous run still finishing.
var ErrBusy = errors.New("the workspace's previous onboarding run is still finishing")

// Client starts, cancels, and queries onboarding workflows; it is the
// onboarding service's Background.
type Client struct {
	// SeedSurfaces seeds product surfaces (PLATFORM_ONBOARDING_SURFACES=enabled).
	SeedSurfaces bool
	Temporal     client.Client
}

// StartOptions are a run's workflow options: one workflow ID per workspace,
// so a second start while one runs returns that run (USE_EXISTING), and a
// later run may reuse the ID (ALLOW_DUPLICATE). The memo names the run.
func StartOptions(run *product.OnboardingRunRecord) client.StartWorkflowOptions {
	return client.StartWorkflowOptions{
		ID: run.WorkflowID, TaskQueue: TaskQueue, WorkflowExecutionTimeout: ParentTimeout,
		WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
		WorkflowIDReusePolicy:    enumspb.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE,
		Memo:                     map[string]any{"runId": run.ID},
	}
}

// InputFor is a run's workflow input: identifiers and budgets from the run
// row and the authenticated starter, never anything a page said.
func InputFor(run *product.OnboardingRunRecord, started product.Actor, seedSurfaces bool) Input {
	return Input{OrganizationID: started.OrganizationID, PageLimit: run.PageLimit, Pages: run.DiscoveredURLs, RunID: run.ID, SeedSurfaces: seedSurfaces,
		StartedBy:   StartedBy{Kind: started.Kind, KeyID: started.KeyID, RequestID: started.RequestID, UserID: started.UserID},
		TokenBudget: run.TokenBudget, TokensUsed: run.TokensUsed, ModelCostMicros: run.ModelCostMicros, URL: run.URL}
}

// Start starts the workflow for a run that just finished its fast path.
func (c *Client) Start(ctx context.Context, run *product.OnboardingRunRecord, started product.Actor) error {
	handle, err := c.Temporal.ExecuteWorkflow(ctx, StartOptions(run), WorkflowName, InputFor(run, started, c.SeedSurfaces))
	if err != nil {
		return err
	}
	// USE_EXISTING may have returned a previous run's workflow that is still
	// recording its outcome; this run then cannot start yet.
	described, err := c.Temporal.DescribeWorkflowExecution(ctx, run.WorkflowID, handle.GetRunID())
	if err != nil {
		return err
	}
	var owner string
	if payload := described.GetWorkflowExecutionInfo().GetMemo().GetFields()["runId"]; payload != nil {
		if err := converter.GetDefaultDataConverter().FromPayload(payload, &owner); err != nil {
			return err
		}
	}
	if owner != run.ID {
		return ErrBusy
	}
	return nil
}

// Cancel signals the workspace's running workflow to stop.
func (c *Client) Cancel(ctx context.Context, organizationID string) error {
	err := c.Temporal.SignalWorkflow(ctx, product.OnboardingWorkflowID(organizationID), "", CancelSignal, nil)
	var notFound *serviceerror.NotFound
	if errors.As(err, &notFound) {
		return nil
	}
	return err
}

// Progress asks the run's workflow for its progress.
func (c *Client) Progress(ctx context.Context, run *product.OnboardingRunRecord) (*onboarding.Progress, error) {
	value, err := c.Temporal.QueryWorkflow(ctx, run.WorkflowID, "", ProgressQuery)
	if err != nil {
		return nil, err
	}
	var progress onboarding.Progress
	if err := value.Get(&progress); err != nil {
		return nil, fmt.Errorf("decode onboarding progress: %w", err)
	}
	return &progress, nil
}

// Register adds the onboarding workflows and activities to a worker on TaskQueue.
func Register(w worker.Worker, activities *Activities) {
	w.RegisterWorkflowWithOptions(Workflow, workflow.RegisterOptions{Name: WorkflowName})
	w.RegisterWorkflowWithOptions(Pipeline, workflow.RegisterOptions{Name: PipelineWorkflowName})
	for name, fn := range map[string]any{
		CrawlPageActivity: activities.CrawlPage, EnrichProfileActivity: activities.EnrichProfile, EnrichActivity: activities.Enrich,
		DeriveICPActivity: activities.DeriveICP, SeedBrandActivity: activities.SeedBrand, SeedSurfacesActivity: activities.SeedSurfaces,
		ReportProgressActivity: activities.ReportProgress, FinishRunActivity: activities.FinishRun,
	} {
		w.RegisterActivityWithOptions(fn, activity.RegisterOptions{Name: name})
	}
}
