package product

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"strings"
	"unicode/utf8"
)

// Community is a provider-confirmed X community identity, not an audience privacy guarantee.
type Community struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// CommunityFinder reads communities using the selected account's authorization.
type CommunityFinder interface {
	Communities(context.Context, string, string, string, string) ([]Community, error)
}

// LookupCommunities searches X using the visible social set's own connection.
func (c *Configuration) LookupCommunities(ctx context.Context, actor Actor, setID, query string) ([]Community, error) {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 200 {
		return nil, invalid("Search communities with 1 to 200 characters.")
	}
	set, err := visibleSocialSet(ctx, c.client, actor, setID)
	if err != nil {
		return nil, err
	}
	connection, err := setAccount(ctx, c.client, set, "x")
	if ent.IsNotFound(err) {
		return nil, conflict("Connect X to this social set before searching communities.")
	}
	if err != nil {
		return nil, err
	}
	finder, ok := c.accounts.(CommunityFinder)
	if !ok {
		return nil, conflict("Community search is unavailable on this server.")
	}
	return finder.Communities(ctx, actor.OrganizationID, connection.ExternalAccountID, connection.SecretReference, query)
}
