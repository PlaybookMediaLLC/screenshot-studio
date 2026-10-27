package x

import (
	"context"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

var communityID = regexp.MustCompile(`^[0-9]{1,19}$`)

// SearchCommunities uses GET /2/communities/search with the connected user's
// OAuth credentials. Provider denial and rate limits remain visible to callers.
func (p *Provider) SearchCommunities(ctx context.Context, token, query string) ([]integrations.MentionResult, error) {
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 200 {
		return nil, fmt.Errorf("search communities with 1 to 200 characters")
	}
	var response struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := newClient(token).get(ctx, v2("communities/search"), url.Values{"query": {query}, "max_results": {"25"}}, &response); err != nil {
		return nil, err
	}
	items := make([]integrations.MentionResult, 0, len(response.Data))
	for _, item := range response.Data {
		if communityID.MatchString(item.ID) && item.Name != "" {
			items = append(items, integrations.MentionResult{ID: item.ID, Label: item.Name})
		}
	}
	return items, nil
}
