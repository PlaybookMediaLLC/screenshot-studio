package mastodoncustom

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// instanceCapabilities reads the selected server's public limits without credentials.
// The v2 Instance contract was introduced in Mastodon 4.0. Older or incomplete
// responses cannot establish publishing capabilities and must not get defaults.
func (p *Provider) instanceCapabilities(ctx context.Context, origin string) (socialidentity.Capabilities, error) {
	var instance struct {
		APIVersions struct {
			Mastodon int `json:"mastodon"`
		} `json:"api_versions"`
		Configuration struct {
			Polls *struct {
				MaxOptions    int `json:"max_options"`
				MaxCharacters int `json:"max_characters_per_option"`
				MinExpiration int `json:"min_expiration"`
				MaxExpiration int `json:"max_expiration"`
			} `json:"polls"`
			Statuses struct {
				MaxCharacters            int `json:"max_characters"`
				MaxMediaAttachments      int `json:"max_media_attachments"`
				CharactersReservedPerURL int `json:"characters_reserved_per_url"`
			} `json:"statuses"`
			Media struct {
				SupportedMIMETypes  []string `json:"supported_mime_types"`
				ImageSizeLimit      int64    `json:"image_size_limit"`
				VideoSizeLimit      int64    `json:"video_size_limit"`
				ImageMatrixLimit    int64    `json:"image_matrix_limit"`
				VideoMatrixLimit    int64    `json:"video_matrix_limit"`
				VideoFrameRateLimit int      `json:"video_frame_rate_limit"`
				DescriptionLimit    *int     `json:"description_limit"`
			} `json:"media_attachments"`
		} `json:"configuration"`
	}
	if err := p.requestJSON(ctx, origin+"/api/v2/instance", nil, "", &instance); err != nil {
		return socialidentity.Capabilities{}, err
	}
	statuses, media := instance.Configuration.Statuses, instance.Configuration.Media
	capabilities := socialidentity.Capabilities{
		MastodonAPIVersion: instance.APIVersions.Mastodon, Version: 1, MaxCharacters: statuses.MaxCharacters,
		MaxMediaAttachments: statuses.MaxMediaAttachments, CharactersReservedPerURL: statuses.CharactersReservedPerURL,
		MediaMIMETypes: media.SupportedMIMETypes, ImageSizeLimit: media.ImageSizeLimit, VideoSizeLimit: media.VideoSizeLimit,
		ImageMatrixLimit: media.ImageMatrixLimit, VideoMatrixLimit: media.VideoMatrixLimit,
		VideoFrameRateLimit: media.VideoFrameRateLimit, MediaDescriptionLimit: media.DescriptionLimit,
	}
	if p := instance.Configuration.Polls; p != nil {
		capabilities.Polls = &socialidentity.PollLimits{MaxOptions: p.MaxOptions, MaxOptionCharacters: p.MaxCharacters, MinDurationSeconds: p.MinExpiration, MaxDurationSeconds: p.MaxExpiration}
	}
	if err := capabilities.Validate(); err != nil {
		return socialidentity.Capabilities{}, err
	}
	return capabilities, nil
}
