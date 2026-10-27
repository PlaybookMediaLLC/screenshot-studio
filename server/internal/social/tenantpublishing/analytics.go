package tenantpublishing

import (
	"context"
	"math"
	"strconv"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func (p *Publisher) AnalyticsCapabilities(platform string) product.AnalyticsCapabilities {
	provider := p.resolve(platform)
	_, account := provider.(integrations.CurrentAnalytics)
	_, posts := provider.(integrations.PostAnalytics)
	_, imported := provider.(integrations.PublishedAnalytics)
	return product.AnalyticsCapabilities{Account: account, Posts: posts, Import: imported}
}
func (p *Publisher) AccountObservations(ctx context.Context, org, destination, platform, secret string) ([]product.AccountObservation, error) {
	account, provider, _, err := p.analyticsAccount(ctx, org, destination, platform, secret)
	if err != nil {
		return nil, err
	}
	reader, ok := provider.(integrations.CurrentAnalytics)
	if !ok {
		return nil, nil
	}
	metrics, err := reader.CurrentMetrics(ctx, account.InternalID, account.Token)
	if err != nil {
		return nil, err
	}
	return []product.AccountObservation{{At: p.currentTime(), Counters: metrics}}, nil
}
func (p *Publisher) ImportAnalyticsPosts(ctx context.Context, org, destination, platform, secret string, since time.Time) ([]product.ImportedAnalyticsPost, error) {
	account, provider, _, err := p.analyticsAccount(ctx, org, destination, platform, secret)
	if err != nil {
		return nil, err
	}
	reader, ok := provider.(integrations.PublishedAnalytics)
	if !ok {
		return nil, nil
	}
	posts, err := reader.PublishedMetrics(ctx, account.InternalID, account.Token, since)
	if err != nil {
		return nil, err
	}
	result := make([]product.ImportedAnalyticsPost, 0, len(posts))
	for _, post := range posts {
		result = append(result, product.ImportedAnalyticsPost{ID: post.ID, Text: post.Text, URL: post.URL, ThreadRootID: post.ThreadRootID, At: post.At, IsReply: post.IsReply, Position: post.Position, Counters: post.Counters})
	}
	return result, nil
}

// RecentPostMetrics returns read-only provider posts, including posts made outside Shots.
func (p *Publisher) RecentPostMetrics(ctx context.Context, organizationID, destinationID, platform, secretReference string) ([]postoptions.ObservedPost, error) {
	account, provider, _, err := p.account(ctx, organizationID, destinationID, platform, secretReference, nil)
	if err != nil {
		return nil, err
	}
	reader, ok := provider.(interface {
		RecentPostMetrics(context.Context, string, string) ([]postoptions.ObservedPost, error)
	})
	if !ok {
		return nil, postoptions.ErrMetricsUnavailable
	}
	return reader.RecentPostMetrics(ctx, account.InternalID, account.Token)
}

// AccountMetrics preserves dated provider series without inventing conversions
// between account metrics that have different definitions on different networks.
func (p *Publisher) AccountMetrics(ctx context.Context, organizationID, destinationID, platform, secretReference string) ([]schema.SocialMetricSeries, error) {
	account, provider, _, err := p.account(ctx, organizationID, destinationID, platform, secretReference, nil)
	if err != nil {
		return nil, err
	}
	reader, ok := provider.(integrations.Analytics)
	if !ok {
		return nil, postoptions.ErrMetricsUnavailable
	}
	series, err := reader.Analytics(ctx, account.InternalID, account.Token, 30)
	if err != nil {
		return nil, err
	}
	result := []schema.SocialMetricSeries{}
	for _, s := range series {
		if len(s.Data) == 0 {
			continue
		}
		item := schema.SocialMetricSeries{Label: s.Label, Average: s.Average, Data: []schema.SocialMetricPoint{}}
		for _, point := range s.Data {
			value, err := strconv.ParseFloat(point.Total, 64)
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
				continue
			}
			if _, err := time.Parse(time.DateOnly, point.Date); err != nil {
				continue
			}
			item.Data = append(item.Data, schema.SocialMetricPoint{Date: point.Date, Total: point.Total})
		}
		if len(item.Data) > 0 {
			result = append(result, item)
		}
	}
	if len(result) == 0 {
		return nil, postoptions.ErrMetricsUnavailable
	}
	return result, nil
}
