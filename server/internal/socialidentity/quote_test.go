package socialidentity

import "testing"

func TestBlueskyQuoteReference(t *testing.T) {
	for _, ref := range []string{"https://bsky.app/profile/alice.bsky.social/post/3key", "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3key"} {
		if _, err := BlueskyPostURI(ref); err != nil {
			t.Fatal(err)
		}
	}
	for _, ref := range []string{"https://bsky.app.evil/profile/alice.bsky.social/post/key", "https://user@bsky.app/profile/alice.bsky.social/post/key", "at://did:plc:short/app.bsky.feed.post/key", "at://alice.bsky.social/app.bsky.graph.list/key", "at://alice.bsky.social/app.bsky.feed.post/.."} {
		if _, err := BlueskyPostURI(ref); err == nil {
			t.Fatalf("accepted %s", ref)
		}
	}
}
