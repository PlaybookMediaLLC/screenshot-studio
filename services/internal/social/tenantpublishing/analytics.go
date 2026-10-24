package tenantpublishing

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"time"
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
