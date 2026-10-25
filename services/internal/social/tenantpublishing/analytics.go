package tenantpublishing

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"math"
	"strconv"
	"time"
)

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
