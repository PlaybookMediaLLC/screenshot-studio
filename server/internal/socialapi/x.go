package socialapi

import (
	"context"
	"net/http"
	"net/url"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// VerifyX reads the adapter's native account identity and observed OAuth grant
// using the original workspace's tenant credential. User settings are not proof.
func (c *Client) VerifyX(ctx context.Context, input VerifyDestinationInput) (*socialidentity.Connection, error) {
	if input.Platform != "x" || input.DestinationID == "" {
		return nil, NewError(http.StatusConflict, false, "invalid X destination")
	}
	token, err := c.boundSocialToken(ctx, input.ExpectedGoOrganizationID, input.SecretReference)
	if err != nil {
		return nil, err
	}
	var account socialidentity.Connection
	if err := c.getJSON(ctx, token, "integrations/"+url.PathEscape(input.DestinationID)+"/identity", &account); err != nil {
		return nil, err
	}
	if account.Validate("x", input.DestinationID) != nil {
		return nil, NewError(http.StatusConflict, false, "X account identity, grant or capabilities could not be verified")
	}
	return &account, nil
}
