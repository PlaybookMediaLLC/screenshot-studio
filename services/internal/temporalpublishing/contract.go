package temporalpublishing

import "time"

const (
	WorkflowNameV1          = "PostWorkflowV1"
	PrepareActivityName     = "PreparePostPublication"
	PublishActivityName     = "PublishPost"
	MarkUnknownActivityName = "MarkPostDeliveryUnknown"
	CancelSignalName        = "cancel"
	DefaultWorkflowQueue    = "main"
	DefaultActivityQueue    = "postiz"
)

const (
	OutcomePublished = "PUBLISHED"
	OutcomeRetry     = "RETRY"
	OutcomeFailed    = "FAILED"
	OutcomeCancelled = "CANCELLED"
	OutcomeSkipped   = "SKIPPED"
)

type WorkflowInput struct {
	ActivityTaskQueue string
	ActivityTimeout   time.Duration
	MaxAttempts       int
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
