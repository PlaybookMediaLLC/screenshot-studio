package publicapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
)

type externalOAuthProvider struct {
	*integrations.Base
	origin        string
	registrations int
	incomplete    bool
}

func (p *externalOAuthProvider) Info() integrations.Info {
	return integrations.Info{Identifier: "mastodon-custom", Name: "Mastodon"}
}
func (p *externalOAuthProvider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int {
	return 500
}
func (p *externalOAuthProvider) Authenticate(context.Context, integrations.AuthenticateParams, *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	return nil, nil
}
func (p *externalOAuthProvider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return nil, nil
}
func (p *externalOAuthProvider) Post(context.Context, string, string, []integrations.PostDetails, *ent.Integration) ([]integrations.PostResponse, error) {
	return nil, nil
}
func (p *externalOAuthProvider) ExternalURL(_ context.Context, origin string) (*integrations.ClientInformation, error) {
	p.origin = origin
	p.registrations++
	if p.incomplete {
		return &integrations.ClientInformation{}, nil
	}
	return &integrations.ClientInformation{ClientID: "client", ClientSecret: "secret-canary"}, nil
}
func (p *externalOAuthProvider) GenerateAuthURL(_ context.Context, client *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	return &integrations.GenerateAuthURLResponse{URL: client.InstanceURL + "/oauth/authorize?state=instance-state", State: "instance-state", CodeVerifier: "verifier-canary"}, nil
}

func TestPublicMastodonStartEncryptsOriginalInstanceCredentials(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
	provider := &externalOAuthProvider{Base: integrations.NewBase("mastodon-custom", nil)}
	store := redis.NewMemory()
	router := httpx.NewRouter()
	RegisterPublicIntegrationsController(router, Deps{
		Orgs: &fakeOrgs{byKey: map[string]*ent.Organization{"key": {ID: "original-org"}}}, OAuth: fakeOAuth{}, Store: store,
		Perms: auth.NewPermissionsService(nil, nil, nil, nil), Manager: integrations.NewManager([]integrations.Provider{provider}),
	})
	for _, path := range []string{"/public/v1/social/mastodon-custom", "/public/v1/social/mastodon-custom?instance=https%3A%2F%2F127.0.0.1", "/public/v1/social/mastodon-custom?instance=https%3A%2F%2Fuser%3Asecret%40example.social"} {
		status, _ := do(t, router, http.MethodGet, path, "key", "")
		if status != 400 || provider.registrations != 0 {
			t.Fatalf("unsafe registration: status %d", status)
		}
	}
	status, body := do(t, router, http.MethodGet, "/public/v1/social/mastodon-custom?instance=EXAMPLE.social%2F", "key", "")
	if status != 200 || provider.origin != "https://example.social" || strings.Contains(body, "canary") {
		t.Fatalf("registration failed: %d %s", status, body)
	}
	sealed, ok, err := store.Get(context.Background(), "external:instance-state")
	if err != nil || !ok || !credentialcipher.IsSealed(sealed) || strings.Contains(sealed, "canary") {
		t.Fatal("client credentials were not encrypted")
	}
	plain, err := credentialcipher.Open(sealed, "oauth-external:instance-state")
	if err != nil {
		t.Fatal(err)
	}
	var client integrations.ClientInformation
	if json.Unmarshal([]byte(plain), &client) != nil || client.InstanceURL != "https://example.social" || client.ClientSecret != "secret-canary" {
		t.Fatal("encrypted client lost its original server")
	}
	if _, err := credentialcipher.Open(sealed, "oauth-external:other-state"); err == nil {
		t.Fatal("credentials were transferable to another attempt")
	}
	if org, _, _ := store.Get(context.Background(), "organization:instance-state"); org != "original-org" {
		t.Fatal("wrong organization binding")
	}
	if verifier, _, _ := store.Get(context.Background(), "login:instance-state"); verifier != "verifier-canary" {
		t.Fatal("missing PKCE verifier")
	}
	provider.incomplete = true
	status, _ = do(t, router, http.MethodGet, "/public/v1/social/mastodon-custom?instance=example.social", "key", "")
	if status != 500 {
		t.Fatal("incomplete client registration succeeded")
	}
}
