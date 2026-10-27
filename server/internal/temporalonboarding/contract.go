// Package temporalonboarding runs the onboarding agent's background read on
// Temporal (docs/rfcs/034-background-onboarding-agent.md). A parent workflow
// per workspace owns the run's outcome; its child pipeline crawls, enriches,
// and seeds within a 15-minute execution timeout. Workflow code only decides;
// every fetch, model call, write, and clock read is an activity.
package temporalonboarding

import (
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
)

// Names Temporal knows the onboarding workflows, signals, and queue by.
const (
	TaskQueue            = "platform-onboarding"
	WorkflowName         = "platform-onboarding-v1"
	PipelineWorkflowName = "platform-onboarding-pipeline-v1"
	// CancelSignal stops a run; ProgressSignal carries the child's progress to the parent.
	CancelSignal   = "cancel"
	ProgressSignal = "progress"
	// ProgressQuery answers the parent's current Progress.
	ProgressQuery = "progress"
)

// Activity names.
const (
	CrawlPageActivity      = "platform-onboarding-crawl-page-v1"
	EnrichProfileActivity  = "platform-onboarding-enrich-profile-v1"
	EnrichActivity         = "platform-onboarding-enrich-v1"
	DeriveICPActivity      = "platform-onboarding-derive-icp-v1"
	SeedBrandActivity      = "platform-onboarding-seed-brand-v1"
	SeedSurfacesActivity   = "platform-onboarding-seed-surfaces-v1"
	ReportProgressActivity = "platform-onboarding-report-progress-v1"
	FinishRunActivity      = "platform-onboarding-finish-run-v1"
)

const (
	// Deadline is the child pipeline's execution timeout; reaching it ends the run partial.
	Deadline = 15 * time.Minute
	// ParentTimeout leaves the parent time to record the outcome after the child times out.
	ParentTimeout = 20 * time.Minute
	// hostInterval paces fetches to one request per second per host.
	hostInterval = time.Second
	// batchChars bounds the page text one extraction call reads.
	batchChars = 40_000
	// draftTokenEstimate is what a call is assumed to cost before it runs.
	draftTokenEstimate = 15_000
)

// StartedBy is who started the run, captured from the authenticated request.
// Activities re-check it before every write; nothing a page says changes it.
type StartedBy struct {
	Kind      string `json:"kind"`
	KeyID     string `json:"keyId,omitempty"`
	RequestID string `json:"requestId,omitempty"`
	UserID    string `json:"userId,omitempty"`
}

// Input starts a run. Pages is fixed at the fast path's discovery: it is the
// progress denominator, and late discoveries wait for the next run.
type Input struct {
	Brief string `json:"brief,omitempty"`
	// ModelCostMicros is what the fast path's model call cost; the run adds to it.
	ModelCostMicros int64     `json:"modelCostMicros"`
	OrganizationID  string    `json:"organizationId"`
	PageLimit       int       `json:"pageLimit"`
	Pages           []string  `json:"pages"`
	RunID           string    `json:"runId"`
	SeedSurfaces    bool      `json:"seedSurfaces"`
	StartedBy       StartedBy `json:"startedBy"`
	TokenBudget     int       `json:"tokenBudget"`
	TokensUsed      int       `json:"tokensUsed"`
	URL             string    `json:"url"`
}

// Progress is a run's state as the progress query and the run row report it.
type Progress = onboarding.Progress

// PageOutcome is one crawled page.
type PageOutcome struct {
	// Changed is new or changed content, which the extraction must read.
	Changed bool `json:"changed"`
	// Fetched is a network request; cached and failed pages make none to pace.
	Fetched bool   `json:"fetched"`
	Flagged bool   `json:"flagged"`
	Skipped bool   `json:"skipped"`
	URL     string `json:"url"`
}

// BatchInput is pages for one extraction call; the activity reads their text.
type BatchInput struct {
	Run  Input    `json:"run"`
	URLs []string `json:"urls"`
}

// ModelOutcome is what a model-calling activity spent and whether it changed anything.
type ModelOutcome struct {
	Applied    bool  `json:"applied"`
	CostMicros int64 `json:"costMicros"`
	Tokens     int   `json:"tokens"`
}

// EnrichOutcome is the enrichment stage's result.
type EnrichOutcome struct {
	Changed    bool  `json:"changed"`
	CostMicros int64 `json:"costMicros"`
}

// Outcome is how the pipeline ended. Partial with a Reason is a budget stop.
type Outcome struct {
	Partial bool   `json:"partial"`
	Reason  string `json:"reason,omitempty"`
}

// Finish records a run's terminal state on its row.
type Finish struct {
	ErrorCode string   `json:"errorCode,omitempty"`
	Message   string   `json:"message,omitempty"`
	Progress  Progress `json:"progress"`
	RunID     string   `json:"runId"`
	Status    string   `json:"status"`
}

// PipelineID is the child workflow's ID, unique per run.
func PipelineID(parentID, runID string) string { return parentID + "-pipeline-" + runID }
