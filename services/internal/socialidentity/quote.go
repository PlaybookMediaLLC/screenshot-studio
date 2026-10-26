package socialidentity

import (
	"net/url"
	"regexp"
	"strings"
)

var blueskyRecordKey = regexp.MustCompile(`^[A-Za-z0-9._~:-]{1,512}$`)

// BlueskyPostURI parses a native post reference. Handle authorities must be
// resolved to a DID before creating a strong reference at the provider.
func BlueskyPostURI(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	var actor, key string
	if strings.HasPrefix(value, "at://") {
		parts := strings.Split(strings.TrimPrefix(value, "at://"), "/")
		if len(parts) != 3 || parts[1] != "app.bsky.feed.post" {
			return "", ErrInvalid
		}
		actor, key = parts[0], parts[2]
	} else {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme != "https" || parsed.Host != "bsky.app" || parsed.User != nil {
			return "", ErrInvalid
		}
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) != 4 || parts[0] != "profile" || parts[2] != "post" {
			return "", ErrInvalid
		}
		actor, key = parts[1], parts[3]
	}
	if !BlueskyDID(actor) {
		handle, err := BlueskyHandle(actor)
		if err != nil || handle != actor {
			return "", ErrInvalid
		}
	}
	if !blueskyRecordKey.MatchString(key) || key == "." || key == ".." {
		return "", ErrInvalid
	}
	return "at://" + actor + "/app.bsky.feed.post/" + key, nil
}

var mastodonStatusPath = regexp.MustCompile(`^/(?:@[^/]+/|users/[^/]+/statuses/|statuses/)([0-9]{1,80})$`)

// MastodonStatusURL recognizes native status links, never an arbitrary fetch URL.
func MastodonStatusURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	host, err := BlueskyHandle(parsed.Host)
	return err == nil && host == parsed.Host && mastodonStatusPath.MatchString(parsed.Path)
}

// CanQuoteMastodon requires API v7 and grants used to resolve and inspect a post.
func CanQuoteMastodon(c Capabilities, scopes []string) bool {
	has := func(want string) bool {
		for _, s := range scopes {
			if s == "read" || s == want {
				return true
			}
		}
		return false
	}
	return c.MastodonAPIVersion >= 7 && has("read:search") && has("read:statuses")
}
