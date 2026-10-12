// Package webhooks holds Postiz's dtos/webhooks/webhooks.dto.ts (the SSRF
// validator and dispatcher live in internal/ssrf).
package webhooks

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
)

type WebhooksIntegrationDto struct {
	ID string `json:"id" validate:"required"`
}

// Integrations has no @ValidateNested in Postiz, so items are not validated.
type WebhooksDto struct {
	ID           string                   `json:"id,omitempty"`
	Name         string                   `json:"name" validate:"required"`
	URL          string                   `json:"url" validate:"required,url"`
	Integrations []WebhooksIntegrationDto `json:"integrations" validate:"required"`
}

type OnlyURL struct {
	URL string `json:"url" validate:"required,url"`
}

type UpdateDto struct {
	ID           string                   `json:"id" validate:"required"`
	Name         string                   `json:"name" validate:"required"`
	URL          string                   `json:"url" validate:"required,url"`
	Integrations []WebhooksIntegrationDto `json:"integrations" validate:"required"`
}

const (
	webhookURLMessage = "Webhook URL must be a public HTTPS URL and cannot point to internal network addresses"
	urlMessage        = "URL must be a public HTTPS URL and cannot point to internal network addresses"
)

func safe(ctx context.Context, url, message string) error {
	if ssrf.IsSafePublicHTTPSURL(ctx, url) {
		return nil
	}
	return httpx.BadRequest([]string{message})
}

// Validate runs the async @IsSafeWebhookUrl check; call it after httpx Bind.
func (d *WebhooksDto) Validate(ctx context.Context) error { return safe(ctx, d.URL, webhookURLMessage) }

// Validate runs the async @IsSafeWebhookUrl check; call it after httpx Bind.
func (d *OnlyURL) Validate(ctx context.Context) error { return safe(ctx, d.URL, urlMessage) }

// Validate runs the async @IsSafeWebhookUrl check; call it after httpx Bind.
func (d *UpdateDto) Validate(ctx context.Context) error { return safe(ctx, d.URL, webhookURLMessage) }
