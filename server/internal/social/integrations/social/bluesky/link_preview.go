package bluesky

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func linkPreview(settings json.RawMessage) (*postoptions.LinkPreview, error) {
	if len(settings) == 0 {
		return nil, nil
	}
	var options struct {
		Preview *postoptions.LinkPreview `json:"link_preview"`
	}
	if err := json.Unmarshal(settings, &options); err != nil {
		return nil, err
	}
	if options.Preview != nil {
		if err := options.Preview.Validate(); err != nil {
			return nil, contentFailure(err.Error())
		}
	}
	return options.Preview, nil
}
func (p *Provider) linkEmbed(ctx context.Context, a *agent, card *postoptions.LinkPreview, media any) (any, error) {
	if card == nil {
		return media, nil
	}
	if err := card.Validate(); err != nil {
		return nil, contentFailure(err.Error())
	}
	if card.Removed {
		return media, nil
	}
	if media != nil {
		return nil, contentFailure("Remove the link preview or media before publishing to Bluesky")
	}
	external := map[string]any{"uri": card.URL, "title": card.Title, "description": card.Description}
	if card.Image != "" {
		images, err := prepareImages(ctx, []integrations.MediaContent{{Path: card.Image, Type: "image"}}, a.limits)
		if err != nil {
			return nil, err
		}
		blob, err := a.uploadBlob(ctx, images[0].data, images[0].mime)
		if err != nil {
			return nil, err
		}
		if err := checkBlob(blob, images[0].mime, a.limits.ImageMaxBytes, a.limits); err != nil {
			return nil, err
		}
		external["thumb"] = blob
	}
	return map[string]any{"$type": "app.bsky.embed.external", "external": external}, nil
}
