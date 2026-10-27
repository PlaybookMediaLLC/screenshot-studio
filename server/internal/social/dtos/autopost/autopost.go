// Package autopost holds the original app's dtos/autopost.
package autopost

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
)

type Integrations struct {
	ID string `json:"id" validate:"required"`
}

type AutopostDto struct {
	Title           string         `json:"title" validate:"required"`
	Content         *string        `json:"content,omitempty"`
	LastURL         *string        `json:"lastUrl,omitempty"`
	OnSlot          *bool          `json:"onSlot" validate:"required"`
	SyncLast        *bool          `json:"syncLast" validate:"required"`
	URL             string         `json:"url" validate:"required,url"`
	Active          *bool          `json:"active" validate:"required"`
	AddPicture      *bool          `json:"addPicture" validate:"required"`
	GenerateContent *bool          `json:"generateContent" validate:"required"`
	Integrations    []Integrations `json:"integrations" validate:"required,dive"`
}

// Validate runs the async @IsSafeWebhookUrl check; call it after httpx Bind.
func (d *AutopostDto) Validate(ctx context.Context) error {
	if ssrf.IsSafePublicHTTPSURL(ctx, d.URL) {
		return nil
	}
	return httpx.BadRequest([]string{"Autopost URL must be a public HTTPS URL and cannot point to internal network addresses"})
}
