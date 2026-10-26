package tenantpublishing

import (
	"context"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

// Communities preserves provider identities for the account's community picker.
func (p *Publisher) Communities(ctx context.Context, org, destination, secret, query string) ([]product.Community, error) {
	account, provider, _, err := p.account(ctx, org, destination, "x", secret, nil)
	if err != nil {
		return nil, err
	}
	finder, ok := provider.(interface {
		SearchCommunities(context.Context, string, string) ([]integrations.MentionResult, error)
	})
	if !ok {
		return nil, fmt.Errorf("community search is unavailable for this connection")
	}
	found, err := finder.SearchCommunities(ctx, account.Token, query)
	if err != nil {
		return nil, err
	}
	items := make([]product.Community, 0, len(found))
	for _, item := range found {
		items = append(items, product.Community{ID: item.ID, Name: item.Label})
	}
	return items, nil
}
