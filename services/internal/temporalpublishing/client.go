package temporalpublishing

import (
	"context"
	"crypto/tls"
	"errors"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

type ConnectionConfig struct {
	APIKey    string
	Address   string
	Namespace string
	TLS       bool
}

type SchedulerConfig struct {
	ActivityTaskQueue string
	ActivityTimeout   time.Duration
	MaxAttempts       int
	RetryDelay        time.Duration
	WorkflowTaskQueue string
}

type Scheduler struct {
	client client.Client
	config SchedulerConfig
}

func Dial(ctx context.Context, cfg ConnectionConfig) (client.Client, error) {
	options := client.Options{HostPort: cfg.Address, Namespace: cfg.Namespace}
	if cfg.APIKey != "" {
		options.Credentials = client.NewAPIKeyStaticCredentials(cfg.APIKey)
	} else if cfg.TLS {
		options.ConnectionOptions.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return client.DialContext(ctx, options)
}

func NewScheduler(temporalClient client.Client, cfg SchedulerConfig) *Scheduler {
	return &Scheduler{client: temporalClient, config: cfg}
}

func (s *Scheduler) Start(ctx context.Context, input ScheduleInput) error {
	_, err := s.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                                       WorkflowID(input.PostID),
		TaskQueue:                                s.config.WorkflowTaskQueue,
		WorkflowIDConflictPolicy:                 enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
		WorkflowIDReusePolicy:                    enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowExecutionErrorWhenAlreadyStarted: false,
		Memo:                                     map[string]any{"organizationId": input.OrganizationID, "postId": input.PostID},
	}, WorkflowNameV1, WorkflowInput{
		ActivityTaskQueue: s.config.ActivityTaskQueue,
		ActivityTimeout:   s.config.ActivityTimeout,
		MaxAttempts:       s.config.MaxAttempts,
		OrganizationID:    input.OrganizationID,
		PostID:            input.PostID,
		RetryDelay:        s.config.RetryDelay,
		ScheduledFor:      input.ScheduledFor,
	})
	var alreadyStarted *serviceerror.WorkflowExecutionAlreadyStarted
	if errors.As(err, &alreadyStarted) {
		return nil
	}
	return err
}

func (s *Scheduler) Cancel(ctx context.Context, postID string) error {
	err := s.client.SignalWorkflow(ctx, WorkflowID(postID), "", CancelSignalName, CancelSignal{})
	var notFound *serviceerror.NotFound
	if errors.As(err, &notFound) {
		return nil
	}
	return err
}

func (s *Scheduler) Ping(ctx context.Context) error {
	_, err := s.client.CheckHealth(ctx, nil)
	return err
}
