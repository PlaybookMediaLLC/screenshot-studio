package bluesky

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"net/http"
	"testing"
)

func TestNativeQuoteResolvesStrongReference(t *testing.T) {
	for _, withImage := range []bool{false, true} {
		t.Run(map[bool]string{false: "record", true: "record with media"}[withImage], func(t *testing.T) {
			f := newFakePDS(t)
			p := newProvider(f.Client())
			in := f.integration(t, "app-password")
			post := integrations.PostDetails{ID: "quote", Message: "My comment", Settings: json.RawMessage(`{"quote_url":"https://bsky.app/profile/alice.bsky.social/post/3kparent"}`)}
			if withImage {
				post.Media = []integrations.MediaContent{{Type: "image", Path: f.URL + "/media/image.png"}}
			}
			_, err := p.Post(context.Background(), in.InternalID, "", []integrations.PostDetails{post}, in)
			if err != nil || len(f.records) != 1 {
				t.Fatalf("publication: %v records=%d", err, len(f.records))
			}
			embed := f.records[0]["record"].(map[string]any)["embed"].(map[string]any)
			if withImage {
				if embed["$type"] != "app.bsky.embed.recordWithMedia" || embed["media"] == nil {
					t.Fatal(embed)
				}
				embed = embed["record"].(map[string]any)
			}
			ref := embed["record"].(map[string]any)
			if embed["$type"] != "app.bsky.embed.record" || ref["uri"] != "at://did:plc:alice/app.bsky.feed.post/3kparent" || ref["cid"] != "bafyparent" {
				t.Fatal(embed)
			}
		})
	}
}
func TestUnavailableQuoteNeverCreates(t *testing.T) {
	f := newFakePDS(t)
	f.override = func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != "/xrpc/app.bsky.feed.getPostThread" {
			return false
		}
		_, _ = w.Write([]byte(`{"thread":{"$type":"app.bsky.feed.defs#notFoundPost"}}`))
		return true
	}
	p := newProvider(f.Client())
	in := f.integration(t, "app-password")
	_, err := p.Post(context.Background(), in.InternalID, "", []integrations.PostDetails{{ID: "q", Message: "comment", Settings: json.RawMessage(`{"quote_url":"https://bsky.app/profile/alice.bsky.social/post/3kparent"}`)}}, in)
	if err == nil || len(f.records) != 0 {
		t.Fatalf("missing quote published: %v", err)
	}
}

func TestFinisherIsNativeQuoteAndThreadReply(t *testing.T) {
	f := newFakePDS(t)
	in := f.integration(t, "app-password")
	_, err := newProvider(f.Client()).Comment(context.Background(), in.InternalID, "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/root", "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/last", "", []integrations.PostDetails{{ID: "finish", Message: "Follow for more", Settings: json.RawMessage(`{"quote_url":"https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx/post/root"}`)}}, in)
	if err != nil || len(f.records) != 1 {
		t.Fatalf("%v records=%d", err, len(f.records))
	}
	record := f.records[0]["record"].(map[string]any)
	embed := record["embed"].(map[string]any)
	if embed["$type"] != "app.bsky.embed.record" || record["reply"] == nil {
		t.Fatal(record)
	}
}
