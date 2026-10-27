package x

import (
	"context"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"net/url"
	"os"
	"time"
)

// CurrentMetrics records only the authorized user's actual current count.
func (p *Provider) CurrentMetrics(ctx context.Context, id, token string) (map[string]float64, error) {
	if os.Getenv("DISABLE_X_ANALYTICS") != "" {
		return nil, fmt.Errorf("X analytics is disabled")
	}
	var response struct {
		Data struct {
			Metrics map[string]*int64 `json:"public_metrics"`
		} `json:"data"`
	}
	if err := newClient(token).get(ctx, v2("users/"+url.PathEscape(id)), url.Values{"user.fields": {"public_metrics"}}, &response); err != nil {
		return nil, err
	}
	result := map[string]float64{}
	if n := response.Data.Metrics["followers_count"]; n != nil {
		result["followers"] = float64(*n)
	}
	return result, nil
}

// PublishedMetrics imports at most 1,000 posts over a bounded lookback. Reconciliation
// overlaps that lookback, deduplicating by account and remote ID in the product service.
func (p *Provider) PublishedMetrics(ctx context.Context, id, token string, since time.Time) ([]integrations.PublishedMetricPost, error) {
	if os.Getenv("DISABLE_X_ANALYTICS") != "" {
		return nil, fmt.Errorf("X analytics is disabled")
	}
	result := []integrations.PublishedMetricPost{}
	cursor := ""
	c := newClient(token)
	for page := 0; page < 10; page++ {
		query := url.Values{"tweet.fields": {"id,text,created_at,public_metrics,conversation_id,referenced_tweets,community_id"}, "max_results": {"100"}, "exclude": {"retweets"}, "start_time": {since.UTC().Format(time.RFC3339)}}
		if cursor != "" {
			query.Set("pagination_token", cursor)
		}
		var response struct {
			Data []struct {
				ID         string    `json:"id"`
				Text       string    `json:"text"`
				At         time.Time `json:"created_at"`
				Root       string    `json:"conversation_id"`
				Community  string    `json:"community_id"`
				References []struct {
					Type string `json:"type"`
					ID   string `json:"id"`
				} `json:"referenced_tweets"`
				Metrics map[string]*int64 `json:"public_metrics"`
			} `json:"data"`
			Meta struct {
				Next string `json:"next_token"`
			} `json:"meta"`
		}
		if err := c.get(ctx, v2("users/"+url.PathEscape(id)+"/tweets"), query, &response); err != nil {
			return nil, err
		}
		for _, post := range response.Data {
			if post.Community != "" {
				continue
			}
			row := integrations.PublishedMetricPost{ID: post.ID, Text: post.Text, At: post.At, URL: "https://x.com/i/status/" + post.ID, Counters: map[string]float64{}}
			for _, ref := range post.References {
				if ref.Type == "replied_to" {
					row.IsReply = true
					row.ThreadRootID = post.Root
					// A reply alone does not prove a self-thread continuation.
				}
			}
			for source, target := range map[string]string{"impression_count": "impressions", "like_count": "likes", "reply_count": "replies", "retweet_count": "reposts", "quote_count": "quotes", "bookmark_count": "bookmarks"} {
				if n := post.Metrics[source]; n != nil {
					row.Counters[target] = float64(*n)
				}
			}
			result = append(result, row)
		}
		if response.Meta.Next == "" || response.Meta.Next == cursor {
			break
		}
		cursor = response.Meta.Next
	}
	owned := map[string]bool{}
	for _, row := range result {
		owned[row.ID] = true
	}
	roots := map[string]bool{}
	for i := range result {
		if result[i].IsReply && owned[result[i].ThreadRootID] {
			result[i].Position = -1
			roots[result[i].ThreadRootID] = true
		}
	}
	for i := range result {
		if roots[result[i].ID] {
			result[i].ThreadRootID = result[i].ID
		}
	}
	return result, nil
}
