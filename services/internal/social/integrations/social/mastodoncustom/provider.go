// Package mastodoncustom is the custom Mastodon provider:
// Mastodon on a user-supplied instance. Postiz does not register it in its
// provider list; it is ported anyway.
package mastodoncustom

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/mastodon"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
)

const identifier = "mastodon-custom"

// Provider extends mastodon.Provider; CheckPostStatus / FinalizePost are
// inherited as-is: the instance url travels inside pendingData.
type Provider struct {
	*mastodon.Provider
}

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.PendingPoster = (*Provider)(nil)
	_ integrations.Commenter     = (*Provider)(nil)
	_ integrations.ExternalURLer = (*Provider)(nil)
)

func New() *Provider {
	return &Provider{Provider: mastodon.NewFor(identifier)}
}

func (p *Provider) Info() integrations.Info {
	info := p.Provider.Info()
	info.Identifier = identifier
	info.Name = "M. Instance"
	// Custom Mastodon instances typically have generous limits
	info.MaxConcurrentJob = 5
	return info
}

// ExternalURL registers Postiz as an app on the instance.
func (p *Provider) ExternalURL(ctx context.Context, url string) (*integrations.ClientInformation, error) {
	body, contentType := mastodon.Form(
		"client_name", "Postiz",
		"redirect_uris", os.Getenv("FRONTEND_URL")+"/integrations/social/mastodon",
		"scopes", strings.Join(mastodon.Scopes, " "),
		"website", os.Getenv("FRONTEND_URL"),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url+"/api/v1/apps", strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	res, err := ssrf.Client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	var app struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	}
	if err := json.Unmarshal(data, &app); err != nil {
		return nil, err
	}
	return &integrations.ClientInformation{ClientID: app.ClientID, ClientSecret: app.ClientSecret}, nil
}

func (p *Provider) GenerateAuthURL(_ context.Context, external *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	if external == nil {
		external = &integrations.ClientInformation{}
	}
	state := ids.Secure(6)
	url := p.GenerateURLDynamic(external.InstanceURL, state, external.ClientID, os.Getenv("FRONTEND_URL"))
	return &integrations.GenerateAuthURLResponse{URL: url, CodeVerifier: ids.Secure(10), State: state}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, client *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	if client == nil {
		client = &integrations.ClientInformation{}
	}
	return p.DynamicAuthenticate(ctx, client.ClientID, client.ClientSecret, client.InstanceURL, params.Code)
}

// instanceURL is the user's instance URL, saved encrypted at connection time.
// Falls back to the default instance for legacy integrations that predate
// storing it.
func instanceURL(integration *ent.Integration) string {
	if integration == nil || integration.CustomInstanceDetails == nil {
		return mastodon.DefaultURL()
	}
	decrypted, err := helpers.FixedDecryption(*integration.CustomInstanceDetails)
	if err != nil {
		return mastodon.DefaultURL()
	}
	var details struct {
		InstanceURL string `json:"instanceUrl"`
	}
	if json.Unmarshal([]byte(decrypted), &details) != nil || details.InstanceURL == "" {
		return mastodon.DefaultURL()
	}
	return details.InstanceURL
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	return p.DynamicPost(ctx, id, accessToken, instanceURL(integration), posts)
}

func (p *Provider) PostPending(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	return p.DynamicPostPending(ctx, id, accessToken, instanceURL(integration), posts)
}

func (p *Provider) Comment(ctx context.Context, id, postID, lastCommentID, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	return p.DynamicComment(ctx, id, postID, lastCommentID, accessToken, instanceURL(integration), posts)
}
