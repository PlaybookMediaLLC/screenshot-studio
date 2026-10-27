package publicapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

type readyProvider struct {
	integrations.Provider
	calls int
}

func (p *readyProvider) Info() integrations.Info { return integrations.Info{Identifier: "x"} }
func (p *readyProvider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	p.calls++
	return &integrations.GenerateAuthURLResponse{URL: "https://api.x.com/oauth/authenticate?oauth_token=ready-state", State: "ready-state", CodeVerifier: "private-verifier-canary"}, nil
}

func TestCatalogIsAuthenticatedAndStartRechecksReadiness(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
	t.Setenv("FRONTEND_URL", "http://localhost:3460")
	t.Setenv("X_URL", "")
	t.Setenv("X_API_KEY", "private-app-key-canary")
	t.Setenv("X_API_SECRET", "private-app-secret-canary")
	t.Setenv("HIDDEN_PROVIDERS", "")
	provider := &readyProvider{}
	custom := &externalOAuthProvider{Base: integrations.NewBase("mastodon-custom", nil)}
	store := redis.NewMemory()
	router := httpx.NewRouter()
	RegisterPublicIntegrationsController(router, Deps{
		Orgs: &fakeOrgs{byKey: map[string]*ent.Organization{"key": {ID: "original-org"}}}, OAuth: fakeOAuth{}, Store: store,
		Perms: auth.NewPermissionsService(nil, nil, nil, nil), Manager: integrations.NewManager([]integrations.Provider{provider, custom}),
	})
	for _, key := range []string{"", "wrong-key"} {
		if code, _ := do(t, router, http.MethodGet, "/public/v1/connection-availability", key, ""); code != 401 {
			t.Fatalf("unauthorized catalog: %d", code)
		}
	}
	r := httptest.NewRequest(http.MethodGet, "/public/v1/connection-availability", nil)
	r.Header.Set("Authorization", "key")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	var catalog socialidentity.ConnectionAvailability
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &catalog) != nil || catalog.Validate() != nil || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), "canary") {
		t.Fatal("invalid or unsafe catalog response")
	}
	if catalog.Providers[0].Status != "available" || provider.calls != 0 {
		t.Fatal("readiness started authorization or did not report X")
	}
	// Configuration may change after this read; starting must check it again.
	t.Setenv("X_API_SECRET", "")
	if code, _ := do(t, router, http.MethodGet, "/public/v1/social/x", "key", ""); code != 503 || provider.calls != 0 {
		t.Fatal("stale readiness started OAuth")
	}
	if _, exists, _ := store.Get(context.Background(), "organization:ready-state"); exists {
		t.Fatal("unavailable connection stored state")
	}
	t.Setenv("PLATFORM_SOCIAL_CUSTOM_MASTODON_ENABLED", "false")
	if code, _ := do(t, router, http.MethodGet, "/public/v1/social/mastodon-custom?instance=example.social", "key", ""); code != 503 || custom.registrations != 0 {
		t.Fatal("disabled connection registered an external app")
	}
	t.Setenv("X_API_SECRET", "private-app-secret-canary")
	if code, body := do(t, router, http.MethodGet, "/public/v1/social/x", "key", ""); code != 200 || provider.calls != 1 || strings.Contains(body, "canary") {
		t.Fatal("configured start failed or leaked credentials")
	}
	if org, _, _ := store.Get(context.Background(), "organization:ready-state"); org != "original-org" {
		t.Fatal("configured start lost original organization")
	}
}
