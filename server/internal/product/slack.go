package product

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
)

// SlackDesignInput delivers a live share link through an existing workspace connection.
type SlackDesignInput struct {
	ShareLinkID string `json:"shareLinkId"`
	ChannelID   string `json:"channelId"`
	Message     string `json:"message"`
}

// SlackAvailable reports backend setup without exposing credentials.
func (c *Configuration) SlackAvailable(ctx context.Context, actor Actor) (bool, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return false, err
	}
	return c.notifications != nil && c.notifications.SlackConfigured(), nil
}

// SlackDesignChannels follows every provider cursor, including empty pages.
func (c *Configuration) SlackDesignChannels(ctx context.Context, actor Actor, id string) ([]notifications.SlackChannel, error) {
	if err := c.authorizeRoles(ctx, actor, integrationUseRoles...); err != nil {
		return nil, err
	}
	if c.notifications == nil {
		return nil, notifications.ErrUnavailable
	}
	channels := []notifications.SlackChannel{}
	cursor := ""
	seen := map[string]bool{}
	for {
		page, err := c.notifications.ConnectionChannels(ctx, actor.OrganizationID, id, cursor)
		if err != nil {
			return nil, err
		}
		channels = append(channels, page.Channels...)
		cursor = page.NextCursor
		if cursor == "" {
			return channels, nil
		}
		if seen[cursor] || len(seen) >= 100 {
			return nil, fmt.Errorf("%w: invalid Slack pagination", ErrInvalidInput)
		}
		seen[cursor] = true
	}
}

// DeliverSlackDesign reauthorizes the asset and live share link before uploading it.
func (c *Configuration) DeliverSlackDesign(ctx context.Context, actor Actor, id string, input SlackDesignInput) error {
	if err := c.authorizeRoles(ctx, actor, integrationUseRoles...); err != nil {
		return err
	}
	if c.notifications == nil {
		return notifications.ErrUnavailable
	}
	if len(input.Message) > 4000 {
		return ErrInvalidInput
	}
	link, err := c.GetShareLink(ctx, actor, input.ShareLinkID)
	if err != nil {
		return err
	}
	if link.RevokedAt != nil || link.ExpiresAt != nil && !link.ExpiresAt.After(time.Now()) {
		return fmt.Errorf("%w: share link is no longer live", ErrInvalidInput)
	}
	body, mediaType, err := c.ReadAsset(ctx, actor, link.AssetID)
	if err != nil {
		return err
	}
	origin, err := url.Parse(os.Getenv("BETTER_AUTH_URL"))
	if err != nil || origin.Host == "" {
		return notifications.ErrUnavailable
	}
	origin.Path = "/s/" + link.Token
	origin.RawQuery = ""
	origin.Fragment = ""
	extension := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm"}[mediaType]
	if extension == "" {
		extension = "bin"
	}
	alt := ""
	if link.AltText != nil {
		alt = *link.AltText
	}
	return c.notifications.UploadDesign(ctx, actor.OrganizationID, id, notifications.SlackDesign{Bytes: body, Filename: "design." + extension, MediaType: mediaType, Title: link.Title, AltText: alt, ShareURL: origin.String(), Message: strings.TrimSpace(input.Message), ChannelID: input.ChannelID})
}
