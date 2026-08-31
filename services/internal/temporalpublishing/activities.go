package temporalpublishing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type ActivityStore interface {
	CancelIneligible(context.Context, *ent.ScheduledPost, string, string) error
	Claim(context.Context, string, string, time.Time) (bool, error)
	Complete(context.Context, *ent.ScheduledPost, publishing.Attempt, string, string) error
	Fail(context.Context, *ent.ScheduledPost, publishing.Attempt, string, *time.Time, string) error
	FailUnknown(context.Context, string, string, int) error
	LoadPublishJob(context.Context, string, string) (publishing.PublishJob, error)
	StartAttempt(context.Context, *ent.ScheduledPost, string, int) (publishing.Attempt, error)
}

type Provider interface {
	Publish(context.Context, postiz.PublishInput) (string, error)
	Status(context.Context, postiz.StatusInput) (postiz.StatusResult, error)
}

type Activities struct {
	provider Provider
	store    ActivityStore
	now      func() time.Time
}

func NewActivities(store ActivityStore, provider Provider) *Activities {
	return &Activities{provider: provider, store: store, now: time.Now}
}

func (a *Activities) Prepare(ctx context.Context, input PrepareInput) (PreparedPublication, error) {
	claimed, err := a.store.Claim(ctx, input.PostID, input.RunID, a.now().UTC())
	if err != nil || !claimed {
		return PreparedPublication{}, err
	}
	job, err := a.store.LoadPublishJob(ctx, input.PostID, input.RunID)
	if err != nil {
		if errors.Is(err, publishing.ErrNotFound) || errors.Is(err, publishing.ErrNotEligible) {
			return PreparedPublication{}, nil
		}
		return PreparedPublication{}, err
	}
	if !job.WorkspaceActive {
		if err := a.store.CancelIneligible(ctx, job.Post, "workspace, connection, or approval is no longer eligible", input.RunID); err != nil {
			return PreparedPublication{}, err
		}
		return PreparedPublication{}, nil
	}
	return PreparedPublication{
		AssetMediaType: job.AssetMediaType, AssetObjectKey: job.AssetObjectKey,
		Caption: job.Post.Caption, DestinationID: job.Connection.ExternalAccountID,
		OrganizationID: job.Post.OrganizationID, Platform: job.Connection.Platform,
		PostID: job.Post.ID, ProviderSettings: job.Connection.ProviderSettings,
		Ready: true, SecretReference: job.Connection.SecretReference,
	}, nil
}

func (a *Activities) Publish(ctx context.Context, input PublishInput) (PublishResult, error) {
	runID := input.RunID
	post := &ent.ScheduledPost{ID: input.Job.PostID, OrganizationID: input.Job.OrganizationID, Caption: input.Job.Caption, TriggerRunID: &runID}
	attempt, err := a.store.StartAttempt(ctx, post, input.RunID, input.AttemptNumber)
	if err != nil {
		return PublishResult{NextAttempt: input.AttemptNumber, Outcome: OutcomeRetry, RetryAfter: time.Second}, nil
	}
	providerID, publishErr := a.provider.Publish(ctx, postiz.PublishInput{
		AssetMediaType: input.Job.AssetMediaType, AssetObjectKey: input.Job.AssetObjectKey,
		Caption: input.Job.Caption, DestinationID: input.Job.DestinationID,
		OrganizationID: input.Job.OrganizationID, Platform: input.Job.Platform,
		ProviderSettings: input.Job.ProviderSettings, SecretReference: input.Job.SecretReference,
	})
	if publishErr == nil {
		if err := a.store.Complete(ctx, post, attempt, providerID, input.RunID); err != nil {
			return PublishResult{}, err
		}
		return PublishResult{Outcome: OutcomePublished, ProviderID: providerID}, nil
	}

	providerErr := &postiz.Error{}
	failureCode := "UNKNOWN"
	if errors.As(publishErr, &providerErr) {
		failureCode = publishing.ProviderFailureCode(providerErr.Status, providerErr.UnknownDelivery)
	}
	if providerErr.Status == 429 && !providerErr.UnknownDelivery && input.AttemptNumber < input.MaxAttempts {
		retryAt := a.now().UTC().Add(input.RetryDelay)
		if err := a.store.Fail(ctx, post, attempt, failureCode, &retryAt, input.RunID); err != nil {
			return PublishResult{}, err
		}
		return PublishResult{
			FailureCode: failureCode, NextAttempt: input.AttemptNumber + 1,
			Outcome: OutcomeRetry, RetryAfter: input.RetryDelay,
		}, nil
	}
	if err := a.store.Fail(ctx, post, attempt, failureCode, nil, input.RunID); err != nil {
		return PublishResult{}, err
	}
	return PublishResult{FailureCode: failureCode, Outcome: OutcomeFailed}, nil
}

func (a *Activities) MarkUnknown(ctx context.Context, input MarkUnknownInput) error {
	return a.store.FailUnknown(ctx, input.PostID, input.RunID, input.AttemptNumber)
}

func (a *Activities) Begin(ctx context.Context, input BeginInput) (BeginResult, error) {
	runID := input.RunID
	post := &ent.ScheduledPost{
		ID: input.Job.PostID, OrganizationID: input.Job.OrganizationID,
		Caption: input.Job.Caption, TriggerRunID: &runID,
	}
	attempt, err := a.store.StartAttempt(ctx, post, input.RunID, input.AttemptNumber)
	if err != nil {
		return BeginResult{}, err
	}
	return BeginResult{AttemptID: attempt.ID, AttemptNumber: attempt.Number}, nil
}

func (a *Activities) Submit(ctx context.Context, input SubmitInput) (PublishResult, error) {
	providerID, err := a.provider.Publish(ctx, postiz.PublishInput{
		AssetMediaType: input.Job.AssetMediaType, AssetObjectKey: input.Job.AssetObjectKey,
		Caption: input.Job.Caption, DestinationID: input.Job.DestinationID,
		OrganizationID: input.Job.OrganizationID, Platform: input.Job.Platform,
		ProviderSettings: input.Job.ProviderSettings, SecretReference: input.Job.SecretReference,
	})
	if err == nil {
		return PublishResult{Outcome: OutcomePending, ProviderID: providerID}, nil
	}
	providerErr := &postiz.Error{}
	if !errors.As(err, &providerErr) {
		return PublishResult{FailureCode: "UNKNOWN", Outcome: OutcomeFailed}, nil
	}
	failureCode := publishing.ProviderFailureCode(providerErr.Status, providerErr.UnknownDelivery)
	if providerErr.UnknownDelivery {
		return PublishResult{FailureCode: failureCode, Outcome: OutcomeUnknown}, nil
	}
	if providerErr.Status == 429 {
		return PublishResult{FailureCode: failureCode, Outcome: OutcomeRetry}, nil
	}
	return PublishResult{FailureCode: failureCode, Outcome: OutcomeFailed}, nil
}

func (a *Activities) Check(ctx context.Context, input CheckInput) (PublishResult, error) {
	status, err := a.provider.Status(ctx, postiz.StatusInput{
		PostID: input.ProviderID, SecretReference: input.Job.SecretReference,
	})
	if err != nil {
		return PublishResult{}, err
	}
	switch status.State {
	case "PUBLISHED":
		return PublishResult{Outcome: OutcomePublished, ProviderID: status.ProviderPostID}, nil
	case "ERROR":
		return PublishResult{FailureCode: "POSTIZ_ERROR", Outcome: OutcomeFailed}, nil
	case "QUEUE":
		return PublishResult{Outcome: OutcomePending, ProviderID: input.ProviderID}, nil
	default:
		return PublishResult{}, fmt.Errorf("unexpected Postiz post state %q", status.State)
	}
}

func (a *Activities) CompleteV2(ctx context.Context, input CompleteInput) error {
	runID := input.RunID
	post := &ent.ScheduledPost{
		ID: input.Job.PostID, OrganizationID: input.Job.OrganizationID,
		Caption: input.Job.Caption, TriggerRunID: &runID,
	}
	return a.store.Complete(ctx, post, publishing.Attempt{ID: input.AttemptID}, input.ProviderID, input.RunID)
}

func (a *Activities) FailV2(ctx context.Context, input FailInput) error {
	runID := input.RunID
	post := &ent.ScheduledPost{
		ID: input.Job.PostID, OrganizationID: input.Job.OrganizationID,
		Caption: input.Job.Caption, TriggerRunID: &runID,
	}
	var retryAt *time.Time
	if !input.RetryAt.IsZero() {
		retryAt = &input.RetryAt
	}
	return a.store.Fail(ctx, post, publishing.Attempt{ID: input.AttemptID, Number: input.AttemptNumber}, input.FailureCode, retryAt, input.RunID)
}
