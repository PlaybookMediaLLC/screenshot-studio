package temporalpublishing

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

const (
	recoveryBatchSize = 100
	recoveryLookback  = 48 * time.Hour
)

type RecoveryActivities struct {
	scheduler *Scheduler
	store     *publishing.Repository
}

func NewRecoveryActivities(store *publishing.Repository, scheduler *Scheduler) *RecoveryActivities {
	return &RecoveryActivities{scheduler: scheduler, store: store}
}

func (a *RecoveryActivities) Recover(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	return a.dispatch(ctx, now.Add(-recoveryLookback), now)
}

// DispatchDue replaces the former minute TypeScript publisher. It only starts
// stable post workflows; all provider sends remain in the publishing worker.
func (a *RecoveryActivities) DispatchDue(ctx context.Context) (int, error) {
	return a.dispatch(ctx, time.Time{}, time.Now().UTC())
}

func (a *RecoveryActivities) dispatch(ctx context.Context, since, now time.Time) (int, error) {
	posts, err := a.store.ListRecoverablePosts(ctx, since, now, recoveryBatchSize)
	if err != nil {
		return 0, err
	}
	for index, post := range posts {
		if err := a.scheduler.Start(ctx, ScheduleInput{
			OrganizationID: post.OrganizationID, PostID: post.ID, ScheduledFor: post.ScheduledFor,
		}); err != nil {
			return index, err
		}
	}
	return len(posts), nil
}
