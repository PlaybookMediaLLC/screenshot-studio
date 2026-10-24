package product

import (
	"context"
	"regexp"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
)

// Mentions picked from the platform (RFC 042). A mention is looked up with
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
	set, err := visibleSocialSet(ctx, c.client, actor, setID)
	if err != nil {
		return nil, err
	}
	if len(query) > 200 {
		return nil, invalid("Keep mention searches under 200 characters.")
	}
	if channel == "linkedin" {
		recent, err := c.recentCompanyMentions(ctx, actor, set.ID, query)
		if err != nil {
			return nil, err
		}
		if len(recent) > 0 || strings.TrimSpace(query) == "" {
			return recent, nil
		}
	}
	normalized, err := mentionQuery(channel, query)
	if err != nil {
		return nil, err
	}
	connection, err := setAccount(ctx, c.client, set, channel)
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

// recentCompanyMentions indexes persisted mention nodes in the set's latest
// drafts. It never reads another social set or a private set the actor cannot see.
func (c *Configuration) recentCompanyMentions(ctx context.Context, actor Actor, setID, query string) ([]Mention, error) {
	rows, err := c.client.ContentDraft.Query().Where(contentdraft.OrganizationID(actor.OrganizationID), contentdraft.SocialSetID(setID)).Order(ent.Desc(contentdraft.FieldUpdatedAt)).Limit(100).All(ctx)
	if err != nil {
		return nil, err
	}
	bodies := [][]any{}
	for _, row := range rows {
		bodies = append(bodies, row.Body)
		for _, version := range row.PlatformVersions.Versions {
			bodies = append(bodies, version.Body)
		}
	}
	return companyMentions(bodies, query), nil
}

func companyMentions(bodies [][]any, query string) []Mention {
	out := []Mention{}
	seen := map[string]bool{}
	query = strings.ToLower(strings.TrimSpace(query))
	var walk func(any)
	walk = func(raw any) {
		switch node := raw.(type) {
		case []any:
			for _, child := range node {
				walk(child)
			}
		case map[string]any:
			id, _ := node["providerId"].(string)
			label, _ := node["label"].(string)
			if node["type"] == "social_mention" && node["platform"] == "linkedin" && (node["kind"] == "organization" || node["kind"] == nil) && strings.HasPrefix(id, "urn:li:organization:") && numericID.MatchString(strings.TrimPrefix(id, "urn:li:organization:")) && label != "" && !seen[id] && (query == "" || strings.Contains(strings.ToLower(label), query)) && len(out) < 30 {
				out = append(out, Mention{Kind: "organization", Label: label, ProviderID: id})
				seen[id] = true
			}
			walk(node["children"])
		}
	}
	for _, body := range bodies {
		walk(body)
	}
	return out
}
