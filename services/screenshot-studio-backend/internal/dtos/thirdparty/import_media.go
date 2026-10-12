// Package thirdparty holds Postiz's dtos/third-party.
package thirdparty

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
)

type ImportMediaItemDto struct {
	URL  string `json:"url" validate:"required"`
	Name string `json:"name" validate:"required"`
}

type ImportMediaDto struct {
	Items []ImportMediaItemDto `json:"items" validate:"required,min=1,dive"`
}

const unsafeURLMessage = "URL must be a public HTTPS URL and cannot point to internal network addresses"

// Validate runs the async @IsSafeWebhookUrl check on every item; call it
// after httpx Bind.
func (d *ImportMediaDto) Validate(ctx context.Context) error {
	var messages []string
	for _, item := range d.Items {
		if !ssrf.IsSafePublicHTTPSURL(ctx, item.URL) {
			messages = append(messages, unsafeURLMessage)
		}
	}
	if len(messages) > 0 {
		return httpx.BadRequest(messages)
	}
	return nil
}
