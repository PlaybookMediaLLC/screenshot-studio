package temporalpublishing

import (
	"context"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
)

type activityStore struct {
	retryAt *time.Time
	unknown bool
}

type quoteReceiptStore struct {
	activityStore
	progress postoptions.ThreadProgress
}

func (s *quoteReceiptStore) RecordThread(_ context.Context, _ string, progress postoptions.ThreadProgress) error {
	s.progress = progress
	return nil
}

type quoteReceiptProvider struct{ directProvider }

func (quoteReceiptProvider) PublishThread(context.Context, socialapi.PublishInput) (socialapi.Receipt, error) {
	return socialapi.Receipt{PostID: "published-quote", Thread: postoptions.ThreadProgress{Quotes: []postoptions.QuoteReceipt{{PostID: "published-quote", State: "pending"}}}}, nil
}
func TestSinglePostQuoteReceiptIsRecordedWithoutRetryingPublication(t *testing.T) {
	store := &quoteReceiptStore{}
	result, err := NewActivities(store, quoteReceiptProvider{}).Submit(context.Background(), SubmitInput{Job: PreparedPublication{}})
	if err != nil || result.Outcome != OutcomePublished || result.ProviderID != "published-quote" || len(store.progress.Quotes) != 1 || store.progress.Quotes[0].State != "pending" {
		t.Fatalf("result=%#v progress=%#v err=%v", result, store.progress, err)
	}
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
func (s *activityStore) FailUnknown(context.Context, string, string, int) error {
	s.unknown = true
	return nil
}
func (s *activityStore) LoadPublishJob(context.Context, string, string) (publishing.PublishJob, error) {
	return publishing.PublishJob{}, nil
}
func (s *activityStore) StartAttempt(context.Context, *ent.ScheduledPost, string, int) (publishing.Attempt, error) {
	return publishing.Attempt{ID: "attempt-1", Number: 1}, nil
}

type rateLimitedProvider struct{}

func (rateLimitedProvider) Publish(context.Context, socialapi.PublishInput) (string, error) {
	return "", &socialapi.Error{Status: 429}
}

type uncertainProvider struct{}

type directProvider struct{}

func (directProvider) PublishesSynchronously() bool { return true }
func (directProvider) Publish(context.Context, socialapi.PublishInput) (string, error) {
	return "remote-post-1", nil
}
func (directProvider) Status(context.Context, socialapi.StatusInput) (socialapi.StatusResult, error) {
	panic("direct provider receipt must not be polled")
}

func TestSubmitActivityUsesDirectRemoteReceipt(t *testing.T) {
	activities := NewActivities(&activityStore{}, directProvider{})
	result, err := activities.Submit(context.Background(), SubmitInput{Job: PreparedPublication{}})
	if err != nil || result.Outcome != OutcomePublished || result.ProviderID != "remote-post-1" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func (uncertainProvider) Publish(context.Context, socialapi.PublishInput) (string, error) {
	return "", &socialapi.Error{Status: 500, UnknownDelivery: true}
}
func (uncertainProvider) Status(context.Context, socialapi.StatusInput) (socialapi.StatusResult, error) {
	return socialapi.StatusResult{}, nil
}

func TestPublishActivityMarksUncertainDeliveryWithoutRetry(t *testing.T) {
	store := &activityStore{}
	activities := NewActivities(store, uncertainProvider{})
	result, err := activities.Publish(context.Background(), PublishInput{
		AttemptNumber: 1, Job: PreparedPublication{PostID: "post-1", OrganizationID: "org-1"},
		MaxAttempts: 3, RunID: "run-1",
	})
	if err != nil || !store.unknown || result.Outcome != OutcomeFailed || result.FailureCode != "UNKNOWN_DELIVERY" || store.retryAt != nil {
		t.Fatalf("result=%#v unknown=%v retryAt=%v err=%v", result, store.unknown, store.retryAt, err)
	}
}
func (rateLimitedProvider) Status(context.Context, socialapi.StatusInput) (socialapi.StatusResult, error) {
	return socialapi.StatusResult{}, nil
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
