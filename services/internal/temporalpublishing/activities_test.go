package temporalpublishing

import (
	"context"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type activityStore struct {
	retryAt *time.Time
}

func (s *activityStore) CancelIneligible(context.Context, *ent.ScheduledPost, string, string) error {
	return nil
}
func (s *activityStore) Claim(context.Context, string, string, time.Time) (bool, error) {
	return true, nil
}
func (s *activityStore) Complete(context.Context, *ent.ScheduledPost, publishing.Attempt, string, string) error {
	return nil
}
func (s *activityStore) Fail(_ context.Context, _ *ent.ScheduledPost, _ publishing.Attempt, _ string, retryAt *time.Time, _ string) error {
	s.retryAt = retryAt
	return nil
}
func (s *activityStore) FailUnknown(context.Context, string, string, int) error { return nil }
func (s *activityStore) LoadPublishJob(context.Context, string, string) (publishing.PublishJob, error) {
	return publishing.PublishJob{}, nil
}
func (s *activityStore) StartAttempt(context.Context, *ent.ScheduledPost, string, int) (publishing.Attempt, error) {
	return publishing.Attempt{ID: "attempt-1", Number: 1}, nil
}

type rateLimitedProvider struct{}

func (rateLimitedProvider) Publish(context.Context, postiz.PublishInput) (string, error) {
	return "", &postiz.Error{Status: 429}
}
func (rateLimitedProvider) Status(context.Context, postiz.StatusInput) (postiz.StatusResult, error) {
	return postiz.StatusResult{}, nil
}

func TestPublishActivityReturnsDurableRateLimitRetry(t *testing.T) {
	store := &activityStore{}
	activities := NewActivities(store, rateLimitedProvider{})
	fixed := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	activities.now = func() time.Time { return fixed }
	result, err := activities.Publish(context.Background(), PublishInput{
		AttemptNumber: 1, Job: PreparedPublication{PostID: "post-1", OrganizationID: "org-1"},
		MaxAttempts: 3, RetryDelay: time.Minute, RunID: "run-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != OutcomeRetry || result.NextAttempt != 2 || result.RetryAfter != time.Minute || store.retryAt == nil || !store.retryAt.Equal(fixed.Add(time.Minute)) {
		t.Fatalf("result=%#v retryAt=%v", result, store.retryAt)
	}
}

func TestSubmitActivityLeavesRateLimitRetryToWorkflow(t *testing.T) {
	activities := NewActivities(&activityStore{}, rateLimitedProvider{})
	result, err := activities.Submit(context.Background(), SubmitInput{Job: PreparedPublication{}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != OutcomeRetry || result.FailureCode != "429" {
		t.Fatalf("result=%#v", result)
	}
}
