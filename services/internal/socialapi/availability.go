package socialapi

import (
	"context"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// ConnectionAvailability reads configuration readiness only after independently
// verifying that this credential belongs to the original product workspace.
func (c *Client) ConnectionAvailability(ctx context.Context, organization, reference string) (*socialidentity.ConnectionAvailability, error) {
	token, err := c.boundSocialToken(ctx, organization, reference)
	if err != nil {
		return nil, err
	}
	var result socialidentity.ConnectionAvailability
	if err := c.getJSON(ctx, token, "connection-availability", &result); err != nil {
		return nil, err
	}
	if result.Validate() != nil {
		return nil, NewError(http.StatusBadGateway, false, "social connection availability could not be verified")
	}
	return &result, nil
}
