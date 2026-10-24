package mastodon

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
	"net/http"
	"net/url"
	"regexp"
)

var statusID = regexp.MustCompile(`^[0-9]{1,80}$`)

func (p *Provider) quoteTarget(ctx context.Context, origin, token string, settings json.RawMessage) (string, error) {
	var options struct {
		URI string `json:"quote_uri"`
	}
	if len(settings) == 0 {
		return "", nil
	}
	if err := json.Unmarshal(settings, &options); err != nil {
		return "", err
	}
	if options.URI == "" {
		return "", nil
	}
	return p.checkedQuote(ctx, origin, token, options.URI)
}

// checkedQuote uses the authenticated instance to resolve remote statuses. No
// credential is sent to the source URL. Manual or denied quote policies stop
// before creating a status, and a policy change after that cannot trigger retry.
func (p *Provider) checkedQuote(ctx context.Context, origin, token, reference string) (string, error) {
	bad := func(message string) (string, error) {
		return "", temporalx.BadBody(p.Info().Identifier, "{}", "{}", message)
	}
	if !statusID.MatchString(reference) && !socialidentity.MastodonStatusURL(reference) {
		return bad("Choose a native Mastodon status URL")
	}
	var instance struct {
		Versions struct {
			Mastodon int `json:"mastodon"`
		} `json:"api_versions"`
	}
	res, err := p.Fetch(ctx, origin+"/api/v2/instance", integrations.Request{Method: http.MethodGet})
	if err != nil {
		return "", err
	}
	if err = res.JSON(&instance); err != nil {
		return "", err
	}
	if instance.Versions.Mastodon < 7 {
		return bad("This Mastodon server does not support native quotes")
	}
	type status struct {
		ID         string `json:"id"`
		URL        string `json:"url"`
		URI        string `json:"uri"`
		Visibility string `json:"visibility"`
		Approval   struct {
			CurrentUser string `json:"current_user"`
		} `json:"quote_approval"`
	}
	var source status
	headers := map[string]string{"Authorization": "Bearer " + token}
	if statusID.MatchString(reference) {
		res, err = p.Fetch(ctx, origin+"/api/v1/statuses/"+reference, integrations.Request{Method: http.MethodGet, Headers: headers})
		if err != nil {
			return "", err
		}
		if err = res.JSON(&source); err != nil {
			return "", err
		}
		if source.ID != reference {
			return bad("The quoted post identity could not be verified")
		}
	} else {
		res, err = p.Fetch(ctx, origin+"/api/v2/search?"+url.Values{"q": {reference}, "type": {"statuses"}, "resolve": {"true"}, "limit": {"1"}}.Encode(), integrations.Request{Method: http.MethodGet, Headers: headers})
		if err != nil {
			return "", err
		}
		var found struct {
			Statuses []status `json:"statuses"`
		}
		if err = res.JSON(&found); err != nil {
			return "", err
		}
		if len(found.Statuses) != 1 {
			return bad("The quoted Mastodon post is unavailable")
		}
		source = found.Statuses[0]
		if source.URL != reference && source.URI != reference {
			return bad("The quoted post identity could not be verified")
		}
	}
	if !statusID.MatchString(source.ID) || source.Approval.CurrentUser != "automatic" {
		return bad("The author has not allowed this account to quote automatically")
	}
	if source.Visibility != "public" && source.Visibility != "unlisted" {
		return bad("Only public or unlisted Mastodon posts can be quoted here")
	}
	return source.ID, nil
}

func (p *Provider) confirmQuote(id, state, origin string) error {
	if state == "accepted" {
		return nil
	}
	return temporalx.UnknownDelivery(p.Info().Identifier, "The post exists at "+origin+"/statuses/"+id+", but its quote is not confirmed. Review it before trying again.")
}
