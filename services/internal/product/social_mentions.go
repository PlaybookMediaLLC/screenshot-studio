package product

import (
	"context"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

// Mentions picked from the platform (RFC 025). A mention is looked up with
// the set's own account, so it names something that account can tag: an X
// user by exact username, a LinkedIn organization by its vanity name.
// Authorized Page followers use the separate restricted people lookup.

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

// recentCompanyMentions reads the durable, set-scoped directory.
func (c *Configuration) recentCompanyMentions(ctx context.Context, actor Actor, setID, query string) ([]Mention, error) {
	return c.mentionDirectory(ctx, actor, setID, query, "organization")
}

func companyMentions(bodies [][]any, query string) []Mention {
	return storedMentions(bodies, query, "organization")
}

var linkedInPersonURN = regexp.MustCompile(`^urn:li:person:[A-Za-z0-9_-]{1,100}$`)

func storedMentions(bodies [][]any, query, kind string) []Mention {
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
			validIdentity := kind == "person" && node["kind"] == "person" && linkedInPersonURN.MatchString(id) || kind == "organization" && (node["kind"] == "organization" || node["kind"] == nil) && strings.HasPrefix(id, "urn:li:organization:") && numericID.MatchString(strings.TrimPrefix(id, "urn:li:organization:"))
			if node["type"] == "social_mention" && node["platform"] == "linkedin" && validIdentity && strings.TrimSpace(label) != "" && utf8.RuneCountInString(label) <= 500 && !seen[id] && (query == "" || strings.Contains(strings.ToLower(label), query)) {
				out = append(out, Mention{Kind: kind, Label: label, ProviderID: id})
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

// PeopleMentionFinder is implemented only by an adapter with an authorized
// native LinkedIn Page follower lookup; it never guesses person identities.
type PeopleMentionFinder interface {
	PeopleMentions(context.Context, string, string, string, string, string) ([]Mention, error)
}

// LookupPeopleMentions uses the same workspace/set boundary as organization
// mentions. Recent people come from this set's own saved draft documents.
func (c *Configuration) LookupPeopleMentions(ctx context.Context, actor Actor, setID, query string) ([]Mention, error) {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return nil, err
	}
	set, err := visibleSocialSet(ctx, c.client, actor, setID)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if len(query) > 200 {
		return nil, invalid("Keep mention searches under 200 characters.")
	}
	recent, err := c.mentionDirectory(ctx, actor, set.ID, query, "person")
	if err != nil {
		return nil, err
	}
	if query == "" || len(recent) > 0 {
		return recent, nil
	}

	connection, err := setAccount(ctx, c.client, set, "linkedin-page")
	if ent.IsNotFound(err) {
		return nil, conflict("Connect a LinkedIn Page with follower lookup access before searching people.")
	}
	if err != nil {
		return nil, err
	}
	finder, ok := c.accounts.(PeopleMentionFinder)
	if !ok {
		return nil, conflict("People lookup is unavailable on this server.")
	}
	return finder.PeopleMentions(ctx, actor.OrganizationID, connection.ExternalAccountID, connection.Platform, connection.SecretReference, query)
}
