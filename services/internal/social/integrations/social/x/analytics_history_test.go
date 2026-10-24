package x

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestAnalyticsHistoryUsesObservedCountersAndOwnedThreadIdentity(t *testing.T) {
	calls, close := fakeX(t, func(r recorded) (int, string) {
		switch r.path {
		case "/2/users/owner":
			return 200, `{"data":{"public_metrics":{"followers_count":0}}}`
		case "/2/users/owner/tweets":
			if r.query.Get("pagination_token") == "second" {
				return 200, `{"data":[{"id":"root","text":"root","created_at":"2026-10-22T12:00:00Z","public_metrics":{"like_count":2}}]}`
			}
			return 200, `{"data":[{"id":"reply","text":"reply","created_at":"2026-10-22T12:01:00Z","conversation_id":"root","referenced_tweets":[{"type":"replied_to","id":"root"}],"public_metrics":{"impression_count":0}},{"id":"excluded","community_id":"community","created_at":"2026-10-22T12:00:00Z"}],"meta":{"next_token":"second"}}`
		}
		return 404, `{}`
	})
	defer close()
	provider := New()
	metrics, err := provider.CurrentMetrics(context.Background(), "owner", "token")
	if err != nil || metrics["followers"] != 0 || len(metrics) != 1 {
		t.Fatalf("metrics=%v %v", metrics, err)
	}
	posts, err := provider.PublishedMetrics(context.Background(), "owner", "token", time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC))
	if err != nil || len(posts) != 2 || posts[0].Position != -1 || posts[0].ThreadRootID != "root" || posts[1].ThreadRootID != "root" {
		t.Fatalf("posts=%+v %v", posts, err)
	}
	if _, exists := posts[0].Counters["likes"]; exists {
		t.Fatal("missing likes became zero")
	}
	if len(*calls) != 3 || (*calls)[1].query.Get("exclude") != "retweets" {
		t.Fatalf("calls=%+v", *calls)
	}
}

func TestAnalyticsPrivateClicksAndPublicPermissionFallback(t *testing.T) {
	for _, private := range []bool{true, false} {
		t.Run(map[bool]string{true: "authorized private counters", false: "public counters remain available"}[private], func(t *testing.T) {
			calls, close := fakeX(t, func(r recorded) (int, string) {
				if !private && strings.Contains(r.query.Get("tweet.fields"), "organic_metrics") {
					return 403, `{"detail":"Private counters unavailable"}`
				}
				if private {
					return 200, `{"data":{"id":"post","public_metrics":{"impression_count":100,"like_count":0},"non_public_metrics":{"user_profile_clicks":2,"url_link_clicks":0}}}`
				}
				return 200, `{"data":{"id":"post","public_metrics":{"impression_count":0}}}`
			})
			defer close()
			metrics, err := New().PostAnalytics(context.Background(), "owner", "token", "post", 0)
			if err != nil {
				t.Fatal(err)
			}
			labels := map[string]string{}
			for _, metric := range metrics {
				labels[metric.Label] = metric.Data[0].Total
			}
			if private && (labels["Profile clicks"] != "2" || labels["Link clicks"] != "0") {
				t.Fatalf("labels=%v", labels)
			}
			if !private && (len(*calls) != 2 || len(labels) != 1 || labels["Impressions"] != "0") {
				t.Fatalf("labels=%v calls=%d", labels, len(*calls))
			}
		})
	}
}

func TestAnalyticsErrorsRetainTypedProviderStatus(t *testing.T) {
	for _, status := range []int{401, 404, 429, 500} {
		calls, close := fakeX(t, func(r recorded) (int, string) { return status, `{"detail":"failed"}` })
		_, err := New().PostAnalytics(context.Background(), "owner", "token", "post", 0)
		var providerError interface{ HTTPStatus() int }
		if !errors.As(err, &providerError) || providerError.HTTPStatus() != status || len(*calls) != 1 {
			t.Fatalf("status=%d err=%v calls=%d", status, err, len(*calls))
		}
		close()
	}
}
