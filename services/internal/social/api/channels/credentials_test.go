package channels

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

type externalFixture struct {
	*fakeProvider
	registrations, exchanges int
	client                   *integrations.ClientInformation
}

func TestOAuthCallbackPersistsVerifiedProviderFacts(t *testing.T) {
	f := setup(t)
	f.provider.id = "mastodon-custom"
	proof := &socialidentity.Verification{
		AccountKey: "mastodon:example.social:123", AccountKind: "profile", GrantedScopes: []string{"read", "write"},
		Capabilities: socialidentity.Capabilities{Version: 1, MaxCharacters: 1024, MaxMediaAttachments: 4, CharactersReservedPerURL: 23,
			MediaMIMETypes: []string{"image/jpeg"}, ImageSizeLimit: 16777216, VideoSizeLimit: 103809024,
			ImageMatrixLimit: 33177600, VideoMatrixLimit: 8294400, VideoFrameRateLimit: 120},
	}
	f.provider.auth = func() (*integrations.AuthTokenDetails, error) {
		return &integrations.AuthTokenDetails{ID: proof.AccountKey, AccessToken: "private-access", Username: "me@example.social", NonExpiring: true, Verification: proof}, nil
	}
	f.noAuth()
	f.state(t)
	status, body := do(t, f.router, http.MethodPost, "/integrations/social-connect/mastodon-custom", `{"state":"state1","code":"code","timezone":"0"}`)
	if status != http.StatusCreated || strings.Contains(body, "private-access") {
		t.Fatalf("verified callback failed or leaked credentials: status %d", status)
	}
	stored := f.client.Integration.Query().OnlyX(f.ctx)
	if stored.VerifiedAccountKey == nil || *stored.VerifiedAccountKey != proof.AccountKey || stored.VerifiedCapabilities == nil || stored.VerifiedCapabilities.MaxCharacters != 1024 || stored.IdentityVerifiedAt == nil || stored.TokenExpiration != nil {
		t.Fatal("callback lost adapter verification before persistence")
	}
}

func (f *externalFixture) ExternalURL(context.Context, string) (*integrations.ClientInformation, error) {
	f.registrations++
	return &integrations.ClientInformation{ClientID: "fixture-client", ClientSecret: "private-client-secret"}, nil
}

func (f *externalFixture) Authenticate(_ context.Context, _ integrations.AuthenticateParams, client *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	f.exchanges++
	f.client = client
	return &integrations.AuthTokenDetails{ID: "external-account", AccessToken: "private-access", Username: "external"}, nil
}

func TestCustomOAuthEncryptsTransientAndPersistentCredentials(t *testing.T) {
	f := setup(t)
	provider := &externalFixture{fakeProvider: f.provider}
	manager := integrations.NewManager([]integrations.Provider{provider})
	RegisterIntegrationsController(f.router, asOrg(f.org), auth.NewPermissionsService(nil, nil, nil, nil), manager, f.service, nil, f.store)
	RegisterNoAuthIntegrationsController(f.router, manager, f.service, organizations.NewService(organizations.NewRepository(f.client), nil), f.store)
	status, body := do(t, f.router, http.MethodGet, "/integrations/social/fake?externalUrl=https://social.example", "")
	if status != http.StatusOK || provider.registrations != 1 {
		t.Fatal("handoff failed", status, body)
	}
	stored, _, err := f.store.Get(f.ctx, "external:state1")
	if err != nil || !credentialcipher.IsSealed(stored) || strings.Contains(stored, "private-client-secret") {
		t.Fatal("transient client secret was not encrypted")
	}
	if _, err := credentialcipher.Open(stored, "oauth-external:another-state"); err == nil {
		t.Fatal("client secret could be moved to another OAuth attempt")
	}
	status, body = do(t, f.router, http.MethodPost, "/integrations/social-connect/fake", `{"state":"state1","code":"code","timezone":"0"}`)
	if status != http.StatusCreated || provider.exchanges != 1 || provider.client == nil || provider.client.ClientSecret != "private-client-secret" {
		t.Fatal("encrypted client could not complete authentication", status)
	}
	if strings.Contains(body, "private-") {
		t.Fatal("credential appeared in callback response")
	}
	row := f.client.Integration.Query().OnlyX(f.ctx)
	if row.CustomInstanceDetails == nil || !credentialcipher.IsSealed(*row.CustomInstanceDetails) {
		t.Fatal("custom credentials were not stored with authenticated encryption")
	}
	plain, err := helpers.FixedDecryption(*row.CustomInstanceDetails)
	var client integrations.ClientInformation
	if err != nil || json.Unmarshal([]byte(plain), &client) != nil || client.ClientSecret != "private-client-secret" {
		t.Fatal("provider cannot read persistent custom credentials")
	}

	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "")
	status, _ = do(t, f.router, http.MethodGet, "/integrations/social/fake?externalUrl=https://social.example", "")
	if status < 400 || provider.registrations != 1 {
		t.Fatal("missing storage key allowed remote registration")
	}
	f.state(t)
	status, _ = do(t, f.router, http.MethodPost, "/integrations/social-connect/fake", `{"state":"state1","code":"code","timezone":"0"}`)
	if status < 400 || provider.exchanges != 1 {
		t.Fatal("missing storage key allowed credential exchange")
	}
}
