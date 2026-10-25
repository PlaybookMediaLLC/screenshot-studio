package temporalpublishing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
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
	Publish(context.Context, socialapi.PublishInput) (string, error)
	Status(context.Context, socialapi.StatusInput) (socialapi.StatusResult, error)
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
		AssetMediaType: job.AssetMediaType, AssetObjectKey: job.AssetObjectKey, Assets: job.Assets, Replies: job.Replies, ReplyTo: job.ReplyTo,
		AutoActions: optionalActions(job.AutoActions), Poll: optionalPoll(job.Poll), Options: optionalOptions(job.Options),
		Document: job.Document, Cover: job.Cover,
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
	providerID, publishErr := a.publish(ctx, socialapi.PublishInput{
		AssetMediaType: input.Job.AssetMediaType, AssetObjectKey: input.Job.AssetObjectKey, Assets: input.Job.Assets, Replies: input.Job.Replies, ReplyTo: input.Job.ReplyTo, Poll: input.Job.Poll,
		Options: input.Job.Options, Document: input.Job.Document, Cover: input.Job.Cover,
		Caption: input.Job.Caption, DestinationID: input.Job.DestinationID,
		OrganizationID: input.Job.OrganizationID, Platform: input.Job.Platform,
		PostID:           input.Job.PostID,
		ProviderSettings: input.Job.ProviderSettings, SecretReference: input.Job.SecretReference,
	})
	if publishErr == nil {
		if err := a.store.Complete(ctx, post, attempt, providerID, input.RunID); err != nil {
			return PublishResult{}, err
		}
		return PublishResult{Outcome: OutcomePublished, ProviderID: providerID}, nil
	}

	providerErr := &socialapi.Error{}
	failureCode := "UNKNOWN"
	if errors.As(publishErr, &providerErr) {
		failureCode = publishing.ProviderFailureCode(providerErr.Status, providerErr.UnknownDelivery)
	}
	if providerErr.UnknownDelivery {
		if err := a.store.FailUnknown(ctx, post.ID, input.RunID, input.AttemptNumber); err != nil {
			return PublishResult{}, err
		}
		return PublishResult{FailureCode: failureCode, Outcome: OutcomeFailed}, nil
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

func optionalActions(actions postoptions.AutoActions) *postoptions.AutoActions {
	if actions.Empty() {
		return nil
	}
	return &actions
}

func optionalOptions(options postoptions.PublishOptions) *postoptions.PublishOptions {
	if options.Empty() {
		return nil
	}
	return &options
}

func optionalPoll(poll postoptions.Poll) *postoptions.Poll {
	if len(poll.Options) == 0 {
		return nil
	}
	return &poll
}

// threadPublisher publishes and reports how far a thread got.
type threadPublisher interface {
	PublishThread(context.Context, socialapi.PublishInput) (socialapi.Receipt, error)
}

// threadRecorder keeps a thread's progress on its post.
type threadRecorder interface {
	RecordThread(context.Context, string, postoptions.ThreadProgress) error
}

// publish uses the provider's thread-aware call when it has one, and keeps
// the thread's progress; a progress that cannot be kept is logged, since
// the post is live either way.
func (a *Activities) publish(ctx context.Context, input socialapi.PublishInput) (string, error) {
	threads, ok := a.provider.(threadPublisher)
	if !ok {
		return a.provider.Publish(ctx, input)
	}
	receipt, err := threads.PublishThread(ctx, input)
	if err != nil {
		return "", err
	}
	if recorder, ok := a.store.(threadRecorder); ok {
		if err := recorder.RecordThread(ctx, input.PostID, receipt.Thread); err != nil {
			slog.ErrorContext(ctx, "thread progress was not recorded", "post", input.PostID, "error", err)
		}
	}
	return receipt.PostID, nil
}

// autoActor runs a live post's follow-ups (repost, plug, quote).
type autoActor interface {
	AutoAct(context.Context, socialapi.AutoActionInput) (socialapi.AutoActionResult, error)
}

// autoActionRecorder records a follow-up that went out (RFC 024).
type autoActionRecorder interface {
	RecordAutoAction(context.Context, string, string) error
}

// connectionChecker reports whether a post's account may still act.
type connectionChecker interface {
	PostConnectionActive(context.Context, string) (bool, error)
}

// RunAutoActions runs the follow-ups due now; a provider without them has
// nothing to do, so every one reports done. An account removed from its
// social set since the post went out (RFC 024) takes no further action.
func (a *Activities) RunAutoActions(ctx context.Context, input AutoActionsInput) (AutoActionsResult, error) {
	actor, ok := a.provider.(autoActor)
	actions := input.Job.AutoActions
	if !ok || actions == nil {
		return AutoActionsResult{Plugged: true, Quoted: true, Reposted: true}, nil
	}
	if checker, ok := a.store.(connectionChecker); ok {
		active, err := checker.PostConnectionActive(ctx, input.Job.PostID)
		if err != nil {
			return AutoActionsResult{}, err
		}
		if !active {
			return AutoActionsResult{Plugged: true, Quoted: true, Reposted: true}, nil
		}
	}
	result, err := actor.AutoAct(ctx, socialapi.AutoActionInput{
		DestinationID: input.Job.DestinationID, OrganizationID: input.Job.OrganizationID,
		Platform: input.Job.Platform, SecretReference: input.Job.SecretReference, RemotePostID: input.ProviderID,
		Repost: input.Repost, RepostAtLikes: actions.RepostAtLikes,
		Plug: input.Plug, PlugAtLikes: actions.PlugAtLikes, PlugText: actions.PlugText,
		Quote: input.Quote, QuoteText: actions.QuoteText,
	})
	// A follow-up that went out on X is activity people can be told about.
	if recorder, ok := a.store.(autoActionRecorder); ok && err == nil && input.Job.Platform == "x" {
		for kind, done := range map[string]bool{
			"post.auto_repost_published": input.Repost && result.Reposted && actions.RepostAtLikes > 0,
			"post.auto_plug_published":   input.Plug && result.Plugged && actions.PlugAtLikes > 0,
		} {
			if done {
				if recordErr := recorder.RecordAutoAction(ctx, input.Job.PostID, kind); recordErr != nil {
					return AutoActionsResult{}, recordErr
				}
			}
		}
	}
	return AutoActionsResult{Plugged: result.Plugged, Quoted: result.Quoted, Reposted: result.Reposted}, err
}

func (a *Activities) Submit(ctx context.Context, input SubmitInput) (PublishResult, error) {
	providerID, err := a.publish(ctx, socialapi.PublishInput{
		AssetMediaType: input.Job.AssetMediaType, AssetObjectKey: input.Job.AssetObjectKey, Assets: input.Job.Assets, Replies: input.Job.Replies, ReplyTo: input.Job.ReplyTo, Poll: input.Job.Poll,
		Options: input.Job.Options, Document: input.Job.Document, Cover: input.Job.Cover,
		Caption: input.Job.Caption, DestinationID: input.Job.DestinationID,
		OrganizationID: input.Job.OrganizationID, Platform: input.Job.Platform,
		PostID:           input.Job.PostID,
		ProviderSettings: input.Job.ProviderSettings, SecretReference: input.Job.SecretReference,
	})
	if err == nil {
		if direct, ok := a.provider.(interface{ PublishesSynchronously() bool }); ok && direct.PublishesSynchronously() {
			return PublishResult{Outcome: OutcomePublished, ProviderID: providerID}, nil
		}
		return PublishResult{Outcome: OutcomePending, ProviderID: providerID}, nil
	}
	providerErr := &socialapi.Error{}
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
	status, err := a.provider.Status(ctx, socialapi.StatusInput{
		PostID: input.ProviderID, SecretReference: input.Job.SecretReference,
	})
	if err != nil {
		return PublishResult{}, err
	}
	switch status.State {
	case "PUBLISHED":
		return PublishResult{Outcome: OutcomePublished, ProviderID: status.ProviderPostID}, nil
	case "ERROR":
		return PublishResult{FailureCode: "SOCIAL_ERROR", Outcome: OutcomeFailed}, nil
	case "QUEUE":
		return PublishResult{Outcome: OutcomePending, ProviderID: input.ProviderID}, nil
	default:
		return PublishResult{}, fmt.Errorf("unexpected social post state %q", status.State)
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
