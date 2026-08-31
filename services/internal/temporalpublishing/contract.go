package temporalpublishing

import "time"

const (
	WorkflowNameV1          = "PostWorkflowV1"
	WorkflowNameV2          = "PostWorkflowV2"
	MissingWorkflowName     = "MissingPostWorkflow"
	MissingWorkflowID       = "missing-post-workflow"
	PrepareActivityName     = "PreparePostPublication"
	PublishActivityName     = "PublishPost"
	MarkUnknownActivityName = "MarkPostDeliveryUnknown"
	BeginActivityName       = "BeginPostPublication"
	SubmitActivityName      = "SubmitPost"
	CheckActivityName       = "CheckPostStatus"
	CompleteActivityName    = "CompletePostPublication"
	FailActivityName        = "FailPostPublication"
	RecoverActivityName     = "RecoverMissingPosts"
	CancelSignalName        = "cancel"
	PokeSignalName          = "poke"
	DefaultWorkflowQueue    = "main"
	DefaultActivityQueue    = "postiz"
)

const (
	OutcomePublished = "PUBLISHED"
	OutcomeRetry     = "RETRY"
	OutcomeFailed    = "FAILED"
	OutcomeCancelled = "CANCELLED"
	OutcomePending   = "PENDING"
	OutcomeSkipped   = "SKIPPED"
	OutcomeUnknown   = "UNKNOWN"
)

type WorkflowInput struct {
	ActivityTaskQueue string
	ActivityTimeout   time.Duration
	MaxAttempts       int
	MainTaskQueue     string
	OrganizationID    string
	PostID            string
	RetryDelay        time.Duration
	ScheduledFor      time.Time
}

type WorkflowResult struct {
	FailureCode string
	Outcome     string
	ProviderID  string
}

type CancelSignal struct{}

type PokeSignal struct{}

type PrepareInput struct {
	PostID string
	RunID  string
}

type PreparedPublication struct {
	AssetMediaType   string
	AssetObjectKey   string
	Caption          string
	DestinationID    string
	OrganizationID   string
	Platform         string
	PostID           string
	ProviderSettings map[string]any
	Ready            bool
	SecretReference  string
}

type PublishInput struct {
	AttemptNumber int
	Job           PreparedPublication
	MaxAttempts   int
	RetryDelay    time.Duration
	RunID         string
}

type PublishResult struct {
	FailureCode string
	NextAttempt int
	Outcome     string
	ProviderID  string
	RetryAfter  time.Duration
}

type BeginInput struct {
	AttemptNumber int
	Job           PreparedPublication
	RunID         string
}

type BeginResult struct {
	AttemptID     string
	AttemptNumber int
}

type SubmitInput struct {
	Job PreparedPublication
}

type CheckInput struct {
	Job        PreparedPublication
	ProviderID string
}

type CompleteInput struct {
	AttemptID  string
	Job        PreparedPublication
	ProviderID string
	RunID      string
}

type FailInput struct {
	AttemptID     string
	AttemptNumber int
	FailureCode   string
	Job           PreparedPublication
	RetryAt       time.Time
	RunID         string
}

type MarkUnknownInput struct {
	AttemptNumber int
	PostID        string
	RunID         string
}

type ScheduleInput struct {
	OrganizationID string
	PostID         string
	ScheduledFor   time.Time
}

func WorkflowID(postID string) string { return "post_" + postID }
