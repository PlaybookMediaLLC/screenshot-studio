package bluesky

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func TestNativeQuotePendingAndReply(t *testing.T) {
	for _, media := range []bool{false, true} {
		t.Run(map[bool]string{false: "text", true: "with image"}[media], func(t *testing.T) {
			f := newFakePDS(t)
			p := newProvider(f.Client())
			account := f.integration(t, "app-password")
			uri := "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/source"
			settings, _ := json.Marshal(map[string]string{"quote_uri": uri})
			post := integrations.PostDetails{ID: "quote", Message: "My commentary", Settings: settings}
			if media {
				post.Media = []integrations.MediaContent{{Type: "image", Path: f.URL + "/media/image.png"}}
			}
			pending, err := p.PostPending(context.Background(), "", "", []integrations.PostDetails{post}, account)
			if err != nil {
				t.Fatal(err)
			}
			data, err := decodePending(pending[0].PendingData)
			if err != nil || data.QuoteURI != uri {
				t.Fatalf("quote lost: %+v %v", data, err)
			}
			result, err := p.Post(context.Background(), "", "", []integrations.PostDetails{post}, account)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = p.Comment(context.Background(), "", result[0].PostID, "", "", []integrations.PostDetails{post}, account); err != nil {
				t.Fatal(err)
			}
			if len(f.records) != 2 {
				t.Fatal("wrong mutation count")
			}
			for _, record := range f.records {
				embed := record["record"].(map[string]any)["embed"].(map[string]any)
				if media {
					if embed["$type"] != "app.bsky.embed.recordWithMedia" || embed["media"] == nil {
						t.Fatalf("media lost: %+v", embed)
					}
					embed = embed["record"].(map[string]any)
				}
				if embed["$type"] != "app.bsky.embed.record" {
					t.Fatalf("not native: %+v", embed)
				}
				ref := embed["record"].(map[string]any)
				if ref["uri"] != uri || ref["cid"] != "bafyparent" {
					t.Fatalf("wrong immutable reference: %+v", ref)
				}
			}
		})
	}
}

func TestUnavailableQuoteNeverCreatesPost(t *testing.T) {
	f := newFakePDS(t)
	p := newProvider(f.Client())
	f.override = func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/xrpc/app.bsky.feed.getPostThread" {
			_, _ = w.Write([]byte(`{"thread":{"$type":"app.bsky.feed.defs#notFoundPost"}}`))
			return true
		}
		return false
	}
	_, err := p.Post(context.Background(), "", "", []integrations.PostDetails{{Message: "Quote", Settings: json.RawMessage(`{"quote_uri":"at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/missing"}`)}}, f.integration(t, "app-password"))
	if err == nil || len(f.records) != 0 {
		t.Fatalf("unavailable quote published: %v", err)
	}
}

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
			if embed["$type"] != "app.bsky.embed.record" || ref["uri"] != "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3kparent" || ref["cid"] != "bafyparent" {
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
