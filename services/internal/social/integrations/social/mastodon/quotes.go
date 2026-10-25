package mastodon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

// DynamicQuoteSupport checks API capabilities, not a parse of a software version.
func (p *Provider) DynamicQuoteSupport(ctx context.Context, origin string) (bool, error) {
	response, err := p.Fetch(ctx, origin+"/api/v2/instance", integrations.Request{})
	if err != nil {
		return false, err
	}
	var instance struct {
		Versions struct {
			Mastodon int `json:"mastodon"`
		} `json:"api_versions"`
	}
	if err := response.JSON(&instance); err != nil {
		return false, err
	}
	return instance.Versions.Mastodon >= 7, nil
}

func (p *Provider) QuoteSupport(ctx context.Context, _ *ent.Integration) (bool, error) {
	return p.DynamicQuoteSupport(ctx, DefaultURL())
}

func quoteRejected(message string) error { return temporalx.PublicationRejected(identifier, message) }

var statusID = regexp.MustCompile(`^[0-9]{1,80}$`)

// Unknown or omitted quote states must not be represented as accepted.
func confirmedQuoteState(requested bool, state string) string {
	if !requested {
		return ""
	}
	switch state {
	case "pending", "accepted", "rejected", "revoked", "deleted", "unauthorized":
		return state
	default:
		return "unconfirmed"
	}
}

// resolveQuote asks only the connected instance to resolve a public post URL.
// Fetch never sends credentials to the external post's origin. The instance
// must explicitly confirm automatic quote permission before any mutation.
func (p *Provider) resolveQuote(ctx context.Context, origin, token, target string) (string, error) {
	if !postoptions.MastodonQuoteURL.MatchString(target) {
		return "", quoteRejected("Use a Mastodon post URL.")
	}
	supported, err := p.DynamicQuoteSupport(ctx, origin)
	if err != nil {
		return "", err
	}
	if !supported {
		return "", quoteRejected("This Mastodon server has not advertised native quote support (API version 7 or newer).")
	}
	q := url.Values{"q": {target}, "type": {"statuses"}, "resolve": {"true"}, "limit": {"1"}}
	response, err := p.Fetch(ctx, origin+"/api/v2/search?"+q.Encode(), integrations.Request{Headers: map[string]string{"Authorization": "Bearer " + token}})
	if err != nil {
		return "", err
	}
	var found struct {
		Statuses []struct {
			ID         string `json:"id"`
			URL        string `json:"url"`
			URI        string `json:"uri"`
			Visibility string `json:"visibility"`
			Approval   struct {
				CurrentUser string `json:"current_user"`
			} `json:"quote_approval"`
		} `json:"statuses"`
	}
	if err := response.JSON(&found); err != nil {
		return "", err
	}
	if len(found.Statuses) != 1 {
		return "", quoteRejected("The quoted Mastodon post is unavailable.")
	}
	post := found.Statuses[0]
	if !statusID.MatchString(post.ID) || (post.URL != target && post.URI != target) || (post.Visibility != "public" && post.Visibility != "unlisted") || post.Approval.CurrentUser != "automatic" {
		return "", quoteRejected("This post does not allow this account to quote it automatically. Open the original post to check its permissions.")
	}
	return post.ID, nil
}

func quoteTarget(settings json.RawMessage) (string, error) {
	var value struct {
		URL string `json:"quote_url"`
	}
	if len(settings) == 0 {
		return "", nil
	}
	if err := json.Unmarshal(settings, &value); err != nil {
		return "", fmt.Errorf("invalid Mastodon settings")
	}
	return value.URL, nil
}

// nativeQuoteID validates a finisher's already-published root on this instance.
func (p *Provider) nativeQuoteID(ctx context.Context, origin, token string, settings json.RawMessage) (string, error) {
	var value struct {
		ID string `json:"quote_status_id"`
	}
	if len(settings) == 0 {
		return "", nil
	}
	if err := json.Unmarshal(settings, &value); err != nil {
		return "", quoteRejected("Invalid Mastodon reply settings.")
	}
	if value.ID == "" {
		return "", nil
	}
	if !statusID.MatchString(value.ID) {
		return "", quoteRejected("Invalid Mastodon quote status ID.")
	}
	ok, err := p.DynamicQuoteSupport(ctx, origin)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", quoteRejected("This server does not support native quotes.")
	}
	response, err := p.Fetch(ctx, origin+"/api/v1/statuses/"+value.ID, integrations.Request{Headers: map[string]string{"Authorization": "Bearer " + token}})
	if err != nil {
		return "", err
	}
	var post struct {
		ID         string `json:"id"`
		Visibility string `json:"visibility"`
		Approval   struct {
			CurrentUser string `json:"current_user"`
		} `json:"quote_approval"`
	}
	if err := response.JSON(&post); err != nil {
		return "", err
	}
	if post.ID != value.ID || (post.Visibility != "public" && post.Visibility != "unlisted") || post.Approval.CurrentUser != "automatic" {
		return "", quoteRejected("The thread root does not allow this account to quote it automatically.")
	}
	return value.ID, nil
}
