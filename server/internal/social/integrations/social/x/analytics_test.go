package x

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestAnalyticsUsesOnlyObservedValues(t *testing.T) {
	_, close := fakeX(t, func(r recorded) (int, string) {
		if strings.HasPrefix(r.path, "/2/users/42/tweets") {
			return 200, `{"data":[{"id":"1","public_metrics":{"like_count":0}},{"id":"2","public_metrics":{"like_count":3}}]}`
		}
		return 200, `{"data":{"public_metrics":{"followers_count":120}}}`
	})
	defer close()
	rows, err := New().Analytics(context.Background(), "42", "token:secret", 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Label != "Followers" || rows[0].Data[0].Total != "120" || rows[1].Data[0].Total != "3" {
		t.Fatalf("unexpected observations: %+v", rows)
	}
	for _, row := range rows {
		if row.PercentageChange != 0 || len(row.Data) != 1 {
			t.Fatal("fabricated starting value or change", row)
		}
	}
}

func TestAnalyticsDoesNotTurnProviderErrorsIntoEmptySuccess(t *testing.T) {
	_, close := fakeX(t, func(r recorded) (int, string) { return http.StatusTooManyRequests, `{"title":"Rate limited"}` })
	defer close()
	if _, err := New().Analytics(context.Background(), "42", "token:secret", 30); err == nil {
		t.Fatal("account read error lost")
	}
	if _, err := New().PostAnalytics(context.Background(), "42", "token:secret", "1", 0); err == nil {
		t.Fatal("post read error lost")
	}
}

func TestRecentPostsAreBoundedAttributedAndDoNotInventMetrics(t *testing.T) {
	_, close := fakeX(t, func(r recorded) (int, string) {
		if !strings.HasPrefix(r.path, "/2/users/42/tweets") || r.query.Get("max_results") != "100" {
			t.Errorf("unexpected timeline request: %s", r.path)
		}
		return 200, `{"data":[{"id":"1","text":"Outside Shots","created_at":"2026-10-24T10:00:00Z","public_metrics":{"like_count":0}},{"id":"1","text":"duplicate","created_at":"2026-10-24T10:00:00Z"},{"id":"2","text":"No metrics","created_at":"2026-10-24T10:00:00Z"},{"id":"3","text":"Missing publication date"}]}`
	})
	defer close()
	posts, err := New().RecentPostMetrics(context.Background(), "42", "token:secret")
	if err != nil || len(posts) != 2 || posts[0].URL != "https://x.com/i/status/1" || len(posts[0].Metrics) != 1 || posts[0].Metrics["likes"] != 0 || len(posts[1].Metrics) != 0 {
		t.Fatalf("posts=%+v err=%v", posts, err)
	}
}
