package worker

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
)

type Store interface {
	Ping(context.Context) error
	RecoverStale(context.Context, time.Time, int) (int, error)
	DuePostIDs(context.Context, time.Time, int) ([]string, error)
	Claim(context.Context, string, string, time.Time) (bool, error)
	LoadPublishJob(context.Context, string, string) (publishing.PublishJob, error)
	StartAttempt(context.Context, *ent.ScheduledPost, string) (publishing.Attempt, error)
	Complete(context.Context, *ent.ScheduledPost, publishing.Attempt, string, string) error
	Fail(context.Context, *ent.ScheduledPost, publishing.Attempt, string, *time.Time, string) error
	CancelIneligible(context.Context, *ent.ScheduledPost, string, string) error
}

type Provider interface {
	Publish(context.Context, postiz.PublishInput) (string, error)
}

type Config struct {
	BatchSize    int
	MaxAttempts  int
	PollInterval time.Duration
	RetryDelay   time.Duration
	StaleAfter   time.Duration
}

type Worker struct {
	config   Config
	provider Provider
	store    Store
	now      func() time.Time
}

func New(store Store, provider Provider, cfg Config) *Worker {
	return &Worker{store: store, provider: provider, config: cfg, now: time.Now}
}

func (w *Worker) Run(ctx context.Context) error {
	if err := w.Tick(ctx); err != nil {
		slog.Error("initial publishing poll failed", "error", err)
	}
	ticker := time.NewTicker(w.config.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := w.Tick(ctx); err != nil {
				slog.Error("publishing poll failed", "error", err)
			}
		}
	}
}

func (w *Worker) Tick(ctx context.Context) error {
	now := w.now().UTC()
	if recovered, err := w.store.RecoverStale(ctx, now.Add(-w.config.StaleAfter), w.config.BatchSize); err != nil {
		return err
	} else if recovered > 0 {
		slog.Warn("recovered stale publishing jobs", "count", recovered)
	}
	ids, err := w.store.DuePostIDs(ctx, now, w.config.BatchSize)
	if err != nil {
		return err
	}
	for _, id := range ids {
		runID := uuid.NewString()
		claimed, err := w.store.Claim(ctx, id, runID, now)
		if err != nil {
			return err
		}
		if !claimed {
			continue
		}
		if err := w.process(ctx, id, runID); err != nil {
			slog.Error("publishing job failed", "post_id", id, "error", err)
		}
	}
	return nil
}

func (w *Worker) process(ctx context.Context, id, runID string) error {
	job, err := w.store.LoadPublishJob(ctx, id, runID)
	if err != nil {
		if errors.Is(err, publishing.ErrNotEligible) || errors.Is(err, publishing.ErrNotFound) {
			return nil
		}
		return err
	}
	if !job.WorkspaceActive {
		return w.store.CancelIneligible(ctx, job.Post, "workspace, connection, or approval is no longer eligible", runID)
	}
	attempt, err := w.store.StartAttempt(ctx, job.Post, runID)
	if err != nil {
		return err
	}
	providerPostID, publishErr := w.provider.Publish(ctx, postiz.PublishInput{
		AssetMediaType: job.AssetMediaType, AssetObjectKey: job.AssetObjectKey,
		Caption: job.Post.Caption, DestinationID: job.Connection.ExternalAccountID,
		OrganizationID: job.Post.OrganizationID, Platform: job.Connection.Platform,
		ProviderSettings: job.Connection.ProviderSettings, SecretReference: job.Connection.SecretReference,
	})
	if publishErr == nil {
		return w.store.Complete(ctx, job.Post, attempt, providerPostID, runID)
	}
	providerErr := &postiz.Error{}
	if !errors.As(publishErr, &providerErr) {
		return w.store.Fail(ctx, job.Post, attempt, "UNKNOWN", nil, runID)
	}
	failureCode := publishing.ProviderFailureCode(providerErr.Status, providerErr.UnknownDelivery)
	var retryAt *time.Time
	if providerErr.Status == 429 && !providerErr.UnknownDelivery && attempt.Number < w.config.MaxAttempts {
		retry := w.now().UTC().Add(w.config.RetryDelay)
		retryAt = &retry
	}
	return w.store.Fail(ctx, job.Post, attempt, failureCode, retryAt, runID)
}
