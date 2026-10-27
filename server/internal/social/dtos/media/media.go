// Package media holds dtos/media.
package media

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
)

type GetMediaDto struct {
	Page   *int   `json:"page,omitempty" query:"page" validate:"omitempty,min=1"`
	Search string `json:"search,omitempty" query:"search"`
}

// MediaDto is also the image entry of a post. Validate runs the custom
// ValidUrlPath and ValidUrlExtension checks the tags cannot express.
type MediaDto struct {
	ID        string `json:"id" validate:"required"`
	Path      string `json:"path" validate:"required"`
	Alt       string `json:"alt,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty" validate:"omitempty,url"`
	// The post DTO carries these on its images too.
	ThumbnailTimestamp *int `json:"thumbnailTimestamp,omitempty"`
}

func (d *MediaDto) Validate() []string {
	var out []string
	if !helpers.ValidURLExtension(d.Path) {
		out = append(out, helpers.ValidURLExtensionMessage)
	}
	if !helpers.IsAllowedUploadPath(d.Path) {
		out = append(out, helpers.ValidURLPathMessage())
	}
	return out
}

type SaveMediaInformationDto struct {
	ID                 string  `json:"id" validate:"required"`
	Alt                string  `json:"alt"`
	Thumbnail          *string `json:"thumbnail,omitempty" validate:"omitempty,url"`
	ThumbnailTimestamp *int    `json:"thumbnailTimestamp,omitempty"`
}

// UploadDto: ValidUrlExtension and IsSafeWebhookUrl are custom, so Validate
// checks them (the second resolves DNS, like the async TS validator).
type UploadDto struct {
	URL string `json:"url" validate:"required"`
}

func (d *UploadDto) Validate() []string {
	var out []string
	if !helpers.ValidURLExtension(d.URL) {
		out = append(out, helpers.ValidURLExtensionMessage)
	}
	if !ssrf.IsSafePublicHTTPSURL(context.Background(), d.URL) {
		out = append(out, "URL must be a public HTTPS URL and cannot point to internal network addresses")
	}
	return out
}
