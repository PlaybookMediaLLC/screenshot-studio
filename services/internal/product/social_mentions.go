package product

import (
	"context"
	"regexp"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Mentions picked from the platform (RFC 041). A mention is looked up with
// the set's own account, so it names something that account can tag: an X
// user by exact username, a LinkedIn organization by its vanity name.
// LinkedIn people are not looked up: the connection's API access has no
// people search, so the composer says so instead of guessing.

// Mention is an account a post can tag. ProviderID is how the platform
// writes it in a post: the X username, or a LinkedIn organization URN.
type Mention struct {
	Handle     string `json:"handle,omitempty"`
	Image      string `json:"image,omitempty"`
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	ProviderID string `json:"providerId"`
}

// MentionFinder looks mentions up with an account's credentials. The
// account standing reader implements it when the platform has a lookup.
type MentionFinder interface {
	Mentions(ctx context.Context, organizationID, destinationID, platform, secretReference, query string) ([]Mention, error)
}

var (
	xUsernamePattern       = regexp.MustCompile(`^[A-Za-z0-9_]{1,15}$`)
	linkedInVanityPattern  = regexp.MustCompile(`^[A-Za-z0-9-]{2,100}$`)
	linkedInCompanyURLPath = regexp.MustCompile(`linkedin\.com/company/([A-Za-z0-9-]{2,100})`)
)

// mentionQuery normalizes what was typed for a platform's lookup: an X
// username without the @, a LinkedIn company vanity name or company URL.
func mentionQuery(channel, query string) (string, error) {
	query = strings.TrimSpace(query)
	switch channel {
	case "x":
		query = strings.TrimPrefix(query, "@")
		if !xUsernamePattern.MatchString(query) {
			return "", invalid("Type an X username: letters, numbers and underscores, up to 15.")
		}
	case "linkedin":
		if match := linkedInCompanyURLPath.FindStringSubmatch(query); match != nil {
			query = match[1]
		}
		query = strings.TrimPrefix(query, "@")
		if !linkedInVanityPattern.MatchString(query) {
			return "", invalid("Type a LinkedIn company page name as in its address, linkedin.com/company/<name>.")
		}
	default:
		return "", invalid("Mentions are looked up for X and LinkedIn.")
	}
	return query, nil
}

// LookupMentions finds what a set's account for a channel can mention.
func (c *Configuration) LookupMentions(ctx context.Context, actor Actor, setID, channel, query string) ([]Mention, error) {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return nil, err
	}
	normalized, err := mentionQuery(channel, query)
	if err != nil {
		return nil, err
	}
	set, err := c.draftSet(ctx, actor.OrganizationID, &setID)
	if err != nil {
		return nil, err
	}
	access, err := c.socialSetAccess(ctx, actor)
	if err != nil {
		return nil, err
	}
	if !access.allows(set) {
		return nil, publishing.ErrNotFound
	}
	connection, err := c.client.ChannelConnection.Query().Where(channelconnection.IDIn(set.ChannelConnectionIds...),
		channelconnection.OrganizationID(actor.OrganizationID), channelconnection.Platform(channel),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, conflict("Connect a " + channelLabel(channel) + " account to this set to look up mentions.")
	}
	if err != nil {
		return nil, err
	}
	finder, ok := c.accounts.(MentionFinder)
	if !ok {
		return nil, conflict("Mention lookup is not available on this server.")
	}
	return finder.Mentions(ctx, actor.OrganizationID, connection.ExternalAccountID, connection.Platform,
		connection.SecretReference, normalized)
}

func channelLabel(channel string) string {
	if channel == "linkedin" {
		return "LinkedIn"
	}
	return "X"
}
