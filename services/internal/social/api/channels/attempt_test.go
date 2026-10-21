package channels

import (
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

type credentialFixtureProvider struct{ *fakeProvider }

func (*credentialFixtureProvider) CustomFields() []integrations.CustomField {
	return []integrations.CustomField{{Key: "password", Type: "password"}}
}

func TestCredentialAttemptIsSingleUseBeforeAnyProviderCall(t *testing.T) {
	f := setup(t)
	f.provider.id = "bluesky"
	var calls atomic.Int32
	f.provider.auth = func() (*integrations.AuthTokenDetails, error) {
		calls.Add(1)
		return nil, integrations.AuthMessage("invalid app password")
	}
	p := &credentialFixtureProvider{f.provider}
	RegisterNoAuthIntegrationsController(f.router, integrations.NewManager([]integrations.Provider{p}), f.service, organizations.NewService(organizations.NewRepository(f.client), nil), f.store)
	f.state(t)
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			status, body := do(t, f.router, http.MethodPost, "/integrations/social-connect/bluesky", `{"state":"state1","code":"disposable-credential-code","timezone":"0"}`)
			if status < 400 || strings.Contains(body, "disposable-credential-code") {
				t.Error("rejected exchange succeeded or echoed credential input")
			}
		})
	}
	wg.Wait()
	if calls.Load() != 1 || f.client.Integration.Query().CountX(f.ctx) != 0 {
		t.Fatal("concurrent or repeated credential state reached the provider twice")
	}
	f.state(t)
	_ = f.store.Set(f.ctx, "connection-provider:state1", "another-provider", 0)
	status, _ := do(t, f.router, http.MethodPost, "/integrations/social-connect/bluesky", `{"state":"state1","code":"code","timezone":"0"}`)
	if status != http.StatusBadRequest || calls.Load() != 1 {
		t.Fatal("another provider's attempt accepted")
	}
	if _, exists, _ := f.store.Get(f.ctx, "login:state1"); !exists {
		t.Fatal("wrong provider consumed the rightful callback")
	}
}

func TestCredentialReconnectCannotPersistAnotherNativeAccount(t *testing.T) {
	f := setup(t)
	f.provider.id = "bluesky"
	canonical := `{"password":"disposable-app-password"}`
	f.provider.auth = func() (*integrations.AuthTokenDetails, error) {
		return &integrations.AuthTokenDetails{ID: "wrong-native-id", AccessToken: "new-access", CredentialDetails: &canonical}, nil
	}
	f.noAuth()
	f.state(t)
	_ = f.store.Set(f.ctx, "refresh:state1", "original-native-id", 0)
	status, body := do(t, f.router, http.MethodPost, "/integrations/social-connect/bluesky", `{"state":"state1","code":"code","timezone":"0"}`)
	if status != http.StatusConflict || !strings.Contains(body, "same account") || f.client.Integration.Query().CountX(f.ctx) != 0 {
		t.Fatal("wrong reconnect identity was committed to the adapter")
	}
}
