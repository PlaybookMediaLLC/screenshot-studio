package bluesky

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func quoteURI(settings json.RawMessage) (string, error) {
	var values struct {
		Quote     string `json:"quote_uri"`
		LegacyURL string `json:"quote_url"`
	}
	if len(settings) == 0 {
		return "", nil
	}
	if err := json.Unmarshal(settings, &values); err != nil {
		return "", contentFailure("Invalid Bluesky settings")
	}
	if values.Quote == "" {
		values.Quote = values.LegacyURL
	}
	if values.Quote == "" {
		return "", nil
	}
	uri, err := socialidentity.BlueskyPostURI(values.Quote)
	if err != nil {
		return "", contentFailure("Choose a valid Bluesky post to quote")
	}
	return uri, nil
}

// quoteEmbed resolves the post's immutable URI and CID before any mutation.
// The official app.bsky.embed.record and recordWithMedia lexicons carry the
// strong reference alongside optional images or video; ordinary links do not.
func (a *agent) quoteEmbed(ctx context.Context, uri string, media any) (any, error) {
	if uri == "" {
		return media, nil
	}
	uri, err := socialidentity.BlueskyPostURI(uri)
	if err != nil {
		return nil, contentFailure("Choose a valid Bluesky post to quote")
	}
	authority := strings.Split(strings.TrimPrefix(uri, "at://"), "/")[0]
	if !socialidentity.BlueskyDID(authority) {
		did, err := a.resolveHandle(ctx, authority)
		if err != nil {
			return nil, err
		}
		if !socialidentity.BlueskyDID(did) {
			return nil, contentFailure("Bluesky could not verify the quoted account")
		}
		uri = strings.Replace(uri, "at://"+authority+"/", "at://"+did+"/", 1)
	}
	post, err := a.getPostThread(ctx, uri)
	if err != nil {
		return nil, err
	}
	if post == nil || post.URI != uri || post.CID == "" || len(post.CID) > 256 {
		return nil, contentFailure("The quoted Bluesky post is unavailable")
	}
	record := map[string]any{"$type": "app.bsky.embed.record", "record": refOrUndefined{URI: post.URI, CID: post.CID}}
	if media == nil {
		return record, nil
	}
	return map[string]any{"$type": "app.bsky.embed.recordWithMedia", "record": record, "media": media}, nil
}
