package bluesky

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"testing"
)

func TestLinkPreviewChoiceSurvivesPendingAndPublication(t *testing.T) {
	for _, removed := range []bool{false, true} {
		t.Run(map[bool]string{false: "card", true: "removed"}[removed], func(t *testing.T) {
			f := newFakePDS(t)
			p := newProvider(f.Client())
			account := f.integration(t, "app-password")
			settings, _ := json.Marshal(map[string]any{"link_preview": postoptions.LinkPreview{URL: "https://example.com/story", Title: "Story title", Description: "Story description", Removed: removed}})
			post := integrations.PostDetails{ID: "job", Message: "Read https://example.com/story", Settings: settings}
			pending, err := p.PostPending(context.Background(), "", "", []integrations.PostDetails{post}, account)
			if err != nil {
				t.Fatal(err)
			}
			data, err := decodePending(pending[0].PendingData)
			if err != nil || data.LinkPreview == nil || data.LinkPreview.Removed != removed {
				t.Fatalf("choice lost %+v %v", data, err)
			}
			if _, err := p.Post(context.Background(), "", "", []integrations.PostDetails{post}, account); err != nil {
				t.Fatal(err)
			}
			record := f.records[0]["record"].(map[string]any)
			if removed {
				if record["embed"] != nil {
					t.Fatal("removed preview regenerated")
				}
				return
			}
			embed := record["embed"].(map[string]any)
			external := embed["external"].(map[string]any)
			if embed["$type"] != "app.bsky.embed.external" || external["uri"] != "https://example.com/story" || external["title"] != "Story title" {
				t.Fatalf("card not native %+v", embed)
			}
		})
	}
}
func TestLinkPreviewCannotReadLocalFile(t *testing.T) {
	_, err := linkPreview(json.RawMessage(`{"link_preview":{"url":"https://example.com","image":"file:///etc/passwd"}}`))
	if err == nil {
		t.Fatal("local image source accepted")
	}
}
