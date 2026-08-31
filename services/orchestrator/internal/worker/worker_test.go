package worker

import (
	"context"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type fakeStore struct {
	job       publishing.PublishJob
	attempt   publishing.Attempt
	completed bool
	failed    bool
	retryAt   *time.Time
	cancelled bool
	loadRunID string
}

func (f *fakeStore) Ping(context.Context) error                                { return nil }
func (f *fakeStore) RecoverStale(context.Context, time.Time, int) (int, error) { return 0, nil }
func (f *fakeStore) DuePostIDs(context.Context, time.Time, int) ([]string, error) {
	return []string{"post-1"}, nil
}
func (f *fakeStore) Claim(context.Context, string, string, time.Time) (bool, error) { return true, nil }
func (f *fakeStore) LoadPublishJob(_ context.Context, _, runID string) (publishing.PublishJob, error) {
	f.loadRunID = runID
	return f.job, nil
}
func (f *fakeStore) StartAttempt(context.Context, *ent.ScheduledPost, string) (publishing.Attempt, error) {
	return f.attempt, nil
}
func (f *fakeStore) Complete(context.Context, *ent.ScheduledPost, publishing.Attempt, string, string) error {
	f.completed = true
	return nil
}
func (f *fakeStore) Fail(_ context.Context, _ *ent.ScheduledPost, _ publishing.Attempt, _ string, retryAt *time.Time, _ string) error {
	f.failed, f.retryAt = true, retryAt
	return nil
}
func (f *fakeStore) CancelIneligible(context.Context, *ent.ScheduledPost, string, string) error {
	f.cancelled = true
	return nil
}

type fakeProvider struct{ err error }

func (f fakeProvider) Publish(context.Context, postiz.PublishInput) (string, error) {
	return "provider-post-1", f.err
}

func testJob(active bool) publishing.PublishJob {
	return publishing.PublishJob{
		AssetMediaType: "image/png", AssetObjectKey: "org/org-1/input/asset/1/file.png",
		WorkspaceActive: active,
		Post:            &ent.ScheduledPost{ID: "post-1", OrganizationID: "org-1", Caption: "hello"},
		Connection:      &ent.ChannelConnection{ExternalAccountID: "destination", Platform: "x", SecretReference: "POSTIZ_API_KEY", Status: channelconnection.StatusACTIVE},
	}
}

func TestTickCompletesSuccessfulPublication(t *testing.T) {
	store := &fakeStore{job: testJob(true), attempt: publishing.Attempt{ID: "attempt-1", Number: 1}}
	w := New(store, fakeProvider{}, Config{BatchSize: 10, MaxAttempts: 3, PollInterval: time.Second, RetryDelay: time.Minute, StaleAfter: time.Minute})
	if err := w.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !store.completed || store.failed {
		t.Fatalf("completed=%v failed=%v", store.completed, store.failed)
	}
	if store.loadRunID == "" {
		t.Fatal("claim run ID was not propagated to the publishing lease")
	}
}

func TestTickRetriesOnlyRateLimitsWithinBudget(t *testing.T) {
	store := &fakeStore{job: testJob(true), attempt: publishing.Attempt{ID: "attempt-1", Number: 2}}
	w := New(store, fakeProvider{err: &postiz.Error{Status: 429}}, Config{BatchSize: 10, MaxAttempts: 3, PollInterval: time.Second, RetryDelay: time.Minute, StaleAfter: time.Minute})
	fixed := time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC)
	w.now = func() time.Time { return fixed }
	if err := w.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !store.failed || store.retryAt == nil || !store.retryAt.Equal(fixed.Add(time.Minute)) {
		t.Fatalf("failed=%v retryAt=%v", store.failed, store.retryAt)
	}
}

func TestTickCancelsIneligiblePublication(t *testing.T) {
	store := &fakeStore{job: testJob(false), attempt: publishing.Attempt{ID: "attempt-1", Number: 1}}
	w := New(store, fakeProvider{}, Config{BatchSize: 10, MaxAttempts: 3, PollInterval: time.Second, RetryDelay: time.Minute, StaleAfter: time.Minute})
	if err := w.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !store.cancelled || store.completed || store.failed {
		t.Fatalf("cancelled=%v completed=%v failed=%v", store.cancelled, store.completed, store.failed)
	}
}
