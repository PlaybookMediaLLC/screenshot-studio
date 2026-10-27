package socialapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"regexp"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

var credentialState = regexp.MustCompile(`^[A-Za-z0-9_-]{32,512}$`)

// BeginBlueskyInput identifies the original tenant and, on reconnect, destination.
type BeginBlueskyInput struct {
	ExpectedGoOrganizationID string
	SecretReference          string
	ExpectedDestinationID    string
}

func (c *Client) boundSocialToken(ctx context.Context, organization, reference string) (string, error) {
	if !publishing.IsSecretReference(reference) {
		return "", NewError(http.StatusConflict, false, "invalid social API credential reference")
	}
	token := os.Getenv(reference)
	if token == "" {
		return "", NewError(http.StatusServiceUnavailable, false, "social API credentials are unavailable")
	}
	var me struct {
		Organization struct {
			ID string `json:"id"`
		} `json:"organization"`
	}
	if err := c.getJSON(ctx, token, "me", &me); err != nil {
		return "", err
	}
	if organization == "" || me.Organization.ID != organization {
		return "", NewError(http.StatusConflict, false, "social API organization does not match this workspace")
	}
	return token, nil
}

// BeginBluesky returns an opaque one-use credential state, never an OAuth URL.
// The native reconnect identity is read with the original tenant's credential.
func (c *Client) BeginBluesky(ctx context.Context, input BeginBlueskyInput) (string, error) {
	token, err := c.boundSocialToken(ctx, input.ExpectedGoOrganizationID, input.SecretReference)
	if err != nil {
		return "", err
	}
	endpoint := "social/bluesky"
	if input.ExpectedDestinationID != "" {
		var account socialidentity.Connection
		if err := c.getJSON(ctx, token, "integrations/"+url.PathEscape(input.ExpectedDestinationID)+"/identity", &account); err != nil {
			return "", err
		}
		// A revoked or legacy account may reconnect, but its native identity may
		// not be substituted. Only completion requires fresh grants and health.
		if account.ID != input.ExpectedDestinationID || account.Provider != "bluesky" || !socialidentity.BlueskyDID(account.NativeID) {
			return "", NewError(http.StatusConflict, false, "the original Bluesky account could not be verified")
		}
		endpoint += "?" + url.Values{"refresh": {account.NativeID}}.Encode()
	}
	var result struct {
		URL string `json:"url"`
	}
	if err := c.getJSON(ctx, token, endpoint, &result); err != nil {
		return "", err
	}
	if !credentialState.MatchString(result.URL) {
		return "", NewError(http.StatusBadGateway, false, "the social adapter returned invalid credential state")
	}
	return result.URL, nil
}

// VerifyBluesky reads verified native identity and publishing facts in its tenant.
func (c *Client) VerifyBluesky(ctx context.Context, input VerifyDestinationInput) (*socialidentity.Connection, error) {
	token, err := c.boundSocialToken(ctx, input.ExpectedGoOrganizationID, input.SecretReference)
	if err != nil {
		return nil, err
	}
	var account socialidentity.Connection
	if err := c.getJSON(ctx, token, "integrations/"+url.PathEscape(input.DestinationID)+"/identity", &account); err != nil {
		return nil, err
	}
	if input.Platform != "bluesky" || account.Validate("bluesky", input.DestinationID) != nil {
		return nil, NewError(http.StatusConflict, false, "Bluesky account identity, grant or capabilities could not be verified")
	}
	return &account, nil
}

// ExchangeBluesky sends the password only in the server-to-server POST body.
// The caller must claim the durable attempt before invoking this method.
func (c *Client) ExchangeBluesky(ctx context.Context, state, handle, password string) (OAuthExchange, error) {
	value, err := socialidentity.BlueskyHandle(handle)
	if err != nil || !credentialState.MatchString(state) || !socialidentity.BlueskyAppPasswordShape(password) {
		return OAuthExchange{}, NewError(http.StatusBadRequest, false, "enter a full Bluesky handle and dedicated app password")
	}
	data, err := json.Marshal(map[string]string{"identifier": value, "password": password})
	if err != nil {
		return OAuthExchange{}, err
	}
	return c.ExchangeOAuth(ctx, "bluesky", base64.StdEncoding.EncodeToString(data), state)
}
