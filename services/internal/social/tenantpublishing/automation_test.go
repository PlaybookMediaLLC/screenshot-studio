package tenantpublishing

import (
	"context"
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
)

// automatingPoster is a provider with every follow-up (RFC 042).
type automatingPoster struct {
	fakePoster
	actions        []string
	likes, reposts int
}

func (f *automatingPoster) RetweetPost(_ context.Context, _ *socialent.Integration, id string) error {
	f.actions = append(f.actions, "retweet:"+id)
	return nil
}

func (f *automatingPoster) UnretweetPost(_ context.Context, _ *socialent.Integration, id string) error {
	f.actions = append(f.actions, "unretweet:"+id)
	return nil
}

func (f *automatingPoster) PostEngagement(context.Context, *socialent.Integration, string) (int, int, error) {
	return f.likes, f.reposts, nil
}

func (f *automatingPoster) ReplyTo(_ context.Context, _ *socialent.Integration, id, text string) (string, error) {
	f.actions = append(f.actions, "reply:"+id+":"+text)
	return "plug-reply-1", nil
}

func TestAutomateRunsEachFollowUpOnTheProvider(t *testing.T) {
	p, _, _, _ := directFixture()
	provider := &automatingPoster{likes: 120, reposts: 4}
	p.resolve = func(string) poster { return provider }
	ctx := context.Background()
	input := socialapi.AutomationInput{DestinationID: "destination", OrganizationID: "product-org", Platform: "linkedin",
		RemotePostID: "remote-post-1", SecretReference: "SOCIAL_API_KEY"}
	run := func(change func(*socialapi.AutomationInput)) socialapi.AutomationResult {
		t.Helper()
		request := input
		change(&request)
		result, err := p.Automate(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	if result := run(func(in *socialapi.AutomationInput) { in.Kind, in.Text = "first_comment", "Link in the comments" }); !result.Done ||
		result.RemoteID != "reply-1" || provider.replies[0] != "Link in the comments>remote-post-1" {
		t.Fatalf("first comment = %+v %v", result, provider.replies)
	}
	run(func(in *socialapi.AutomationInput) { in.Kind = "retweet" })
	run(func(in *socialapi.AutomationInput) { in.Kind = "unretweet" })
	// 4 reposts is under 5; 120 likes is over 100.
	if result := run(func(in *socialapi.AutomationInput) {
		in.Kind, in.Metric, in.Threshold, in.Text = "plug", "reposts", 5, "Guide"
	}); result.Done {
		t.Fatal("a plug went out under its repost threshold")
	}
	if result := run(func(in *socialapi.AutomationInput) { in.Kind, in.Threshold, in.Text = "plug", 100, "Guide" }); !result.Done || result.RemoteID != "plug-reply-1" {
		t.Fatalf("plug = %+v", result)
	}
	want := []string{"retweet:remote-post-1", "unretweet:remote-post-1", "reply:remote-post-1:Guide"}
	if len(provider.actions) != len(want) {
		t.Fatalf("actions = %v", provider.actions)
	}
	for index := range want {
		if provider.actions[index] != want[index] {
			t.Fatalf("actions = %v", provider.actions)
		}
	}
	// A provider without reposts says so rather than pretending.
	p.resolve = func(string) poster { return &fakePoster{} }
	if _, err := p.Automate(ctx, socialapi.AutomationInput{DestinationID: "destination", Kind: "retweet",
		OrganizationID: "product-org", Platform: "linkedin", SecretReference: "SOCIAL_API_KEY"}); !errors.Is(err, socialapi.ErrUnsupported) {
		t.Fatalf("unsupported = %v", err)
	}
}

// An image's description goes to the provider with the image.
func TestSignedMediaCarriesAltText(t *testing.T) {
	p, _, _, _ := directFixture()
	media, err := p.signedMedia(context.Background(), "product-org", []publishing.MediaAsset{
		{Alt: "A chart of signups", MediaType: "image/png", ObjectKey: "org/product-org/chart.png"},
	})
	if err != nil || len(media) != 1 || media[0].Alt != "A chart of signups" {
		t.Fatalf("media = %+v err=%v", media, err)
	}
}
