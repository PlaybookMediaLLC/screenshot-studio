package bluesky

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"strings"
)

func (a *agent) quoteEmbed(ctx context.Context, target string, media any) (any, error) {
	parts := postoptions.BlueskyQuoteURL.FindStringSubmatch(target)
	if parts == nil {
		return nil, contentFailure("Use a native Bluesky post URL")
	}
	did := parts[1]
	if !strings.HasPrefix(did, "did:") {
		resolved, err := a.resolveHandle(ctx, did)
		if err != nil {
			return nil, err
		}
		did = resolved
	}
	if !strings.HasPrefix(did, "did:") || strings.ContainsAny(did, "/?#") {
		return nil, contentFailure("The quoted account could not be resolved")
	}
	uri := "at://" + did + "/app.bsky.feed.post/" + parts[2]
	post, err := a.getPostThread(ctx, uri)
	if err != nil {
		return nil, err
	}
	if post == nil || post.URI != uri || post.CID == "" || len(post.CID) > 256 {
		return nil, contentFailure("The quoted Bluesky post is unavailable")
	}
	record := map[string]any{"$type": "app.bsky.embed.record", "record": map[string]string{"uri": uri, "cid": post.CID}}
	if media == nil {
		return record, nil
	}
	return map[string]any{"$type": "app.bsky.embed.recordWithMedia", "record": record, "media": media}, nil
}
