package x

import (
	"context"
	"net/url"
	"os"
	"regexp"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
)

var observedPostID = regexp.MustCompile(`^[0-9]{1,30}$`)

// RecentPostMetrics reads at most 100 original posts in the last 30 days. API
// access and account credentials are the same as the account analytics adapter.
func (p *Provider) RecentPostMetrics(ctx context.Context, id, token string) ([]postoptions.ObservedPost, error) {
	if os.Getenv("DISABLE_X_ANALYTICS") != "" {
		return nil, postoptions.ErrMetricsUnavailable
	}
	var timeline struct {
		Data []struct {
			ID            string            `json:"id"`
			Text          string            `json:"text"`
			CreatedAt     time.Time         `json:"created_at"`
			PublicMetrics map[string]*int64 `json:"public_metrics"`
		} `json:"data"`
	}
	query := url.Values{"tweet.fields": {"public_metrics,created_at,text"}, "exclude": {"replies,retweets"}, "max_results": {"100"}, "start_time": {time.Now().UTC().AddDate(0, 0, -30).Format(time.RFC3339)}}
	if err := newClient(token).get(ctx, v2("users/"+id+"/tweets"), query, &timeline); err != nil {
		return nil, err
	}
	result := []postoptions.ObservedPost{}
	seen := map[string]bool{}
	for _, post := range timeline.Data {
		if !observedPostID.MatchString(post.ID) || post.CreatedAt.IsZero() || seen[post.ID] {
			continue
		}
		seen[post.ID] = true
		metrics := postoptions.Metrics{}
		for key, name := range map[string]string{"impression_count": "impressions", "like_count": "likes", "reply_count": "replies", "retweet_count": "reposts", "quote_count": "quotes", "bookmark_count": "bookmarks"} {
			if n := post.PublicMetrics[key]; n != nil && *n >= 0 {
				metrics[name] = float64(*n)
			}
		}
		result = append(result, postoptions.ObservedPost{ID: post.ID, URL: "https://x.com/i/status/" + post.ID, Caption: post.Text, PublishedAt: post.CreatedAt, Metrics: metrics})
		if len(result) == 100 {
			break
		}
	}
	return result, nil
}
