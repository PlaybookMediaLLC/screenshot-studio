package channels

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/sets"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

type fakeProvider struct {
	*integrations.Base
	id   string
	auth func() (*integrations.AuthTokenDetails, error)
	// calls records the token each "ping" call received.
	calls []string
}

func (f *fakeProvider) Info() integrations.Info {
	return integrations.Info{Identifier: f.id, Name: f.id, Editor: "normal"}
}
func (f *fakeProvider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 100 }
func (f *fakeProvider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	return &integrations.GenerateAuthURLResponse{URL: "https://auth", CodeVerifier: "verifier", State: "state1"}, nil
}
func (f *fakeProvider) Authenticate(context.Context, integrations.AuthenticateParams, *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	return f.auth()
}
func (f *fakeProvider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{AccessToken: "new-token", RefreshToken: "new-refresh", ExpiresIn: 3600}, nil
}
func (f *fakeProvider) Post(context.Context, string, string, []integrations.PostDetails, *ent.Integration) ([]integrations.PostResponse, error) {
	return nil, nil
}
func (f *fakeProvider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"ping": func(_ context.Context, token string, _ json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			f.calls = append(f.calls, token)
			if token == "old-token" {
				return nil, temporalx.RefreshToken(f.id, "{}", "{}", "expired")
			}
			return map[string]string{"token": token}, nil
		},
	}
}

type fakeNotifications struct{}

func (fakeNotifications) InAppNotification(context.Context, string, string, string, bool, bool, string) error {
	return nil
}

type fakeUploader struct{}

func (fakeUploader) UploadSimple(_ context.Context, path string) (string, error) { return path, nil }

type fixture struct {
	ctx      context.Context
	client   *ent.Client
	store    *redis.Memory
	provider *fakeProvider
	service  *integration.Service
	org      *ent.Organization
	router   *httpx.Router
}

func setup(t *testing.T) *fixture {
	t.Helper()
	client := dbtest.Open(t)
	ctx := context.Background()
	provider := &fakeProvider{Base: integrations.NewBase("fake", nil), id: "fake"}
	manager := integrations.NewManager([]integrations.Provider{provider})
	store := redis.NewMemory()
	service := integration.NewService(integration.NewRepository(client, fakeUploader{}), nil, manager, fakeNotifications{}, nil, store, fakeUploader{})
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	return &fixture{ctx: ctx, client: client, store: store, provider: provider, service: service, org: org, router: httpx.NewRouter()}
}

// asOrg is a stand-in for AuthMiddleware.
func asOrg(org *ent.Organization) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		c.Org = org
		c.User = &ent.User{ID: "user"}
		return nil
	}
}

func do(t *testing.T, h http.Handler, method, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	data, _ := io.ReadAll(rec.Body)
	return rec.Code, string(data)
}

func (f *fixture) noAuth() {
	RegisterNoAuthIntegrationsController(f.router, integrations.NewManager([]integrations.Provider{f.provider}), f.service,
		organizations.NewService(organizations.NewRepository(f.client), nil), f.store)
}

func (f *fixture) state(t *testing.T) {
	t.Helper()
	_ = f.store.Set(f.ctx, "login:state1", "verifier", 0)
	_ = f.store.Set(f.ctx, "connection-provider:state1", f.provider.id, 0)
	_ = f.store.Set(f.ctx, "organization:state1", f.org.ID, 0)
	_ = f.store.Set(f.ctx, "redirect:state1", "https://app/back", 0)
}

func TestConnectSocialMediaHappyPath(t *testing.T) {
	f := setup(t)
	f.provider.auth = func() (*integrations.AuthTokenDetails, error) {
		return &integrations.AuthTokenDetails{ID: "acc-1", Username: "alice.smith", AccessToken: "tok", RefreshToken: "ref", ExpiresIn: 100}, nil
	}
	f.noAuth()
	f.state(t)

	status, body := do(t, f.router, http.MethodPost, "/integrations/social-connect/fake", `{"state":"state1","code":"c","timezone":"0"}`)
	if status != http.StatusCreated {
		t.Fatalf("status %d: %s", status, body)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	if got["internalId"] != "acc-1" || got["name"] != "alice" || got["onboarding"] != false || got["returnURL"] != "https://app/back" {
		t.Fatalf("unexpected body %s", body)
	}
	for _, key := range []string{"token", "refreshToken", "customInstanceDetails", "extensionToken"} {
		if _, ok := got[key]; ok {
			t.Fatalf("%s leaked: %s", key, body)
		}
	}
	if pages, ok := got["pages"].([]any); !ok || len(pages) != 0 {
		t.Fatalf("pages = %v", got["pages"])
	}
	stored := f.client.Integration.Query().OnlyX(f.ctx)
	if stored.Token != "tok" || *stored.Profile != "alice.smith" {
		t.Fatalf("stored %+v", stored)
	}
	// the state is single use
	if _, ok, _ := f.store.Get(f.ctx, "login:state1"); ok {
		t.Fatal("login state not deleted")
	}
	status, body = do(t, f.router, http.MethodPost, "/integrations/social-connect/fake", `{"state":"state1","code":"c","timezone":"0"}`)
	if status != http.StatusBadRequest || !strings.Contains(body, "This connection link expired") {
		t.Fatalf("reuse: %d %s", status, body)
	}
}

func TestConnectSocialMediaErrors(t *testing.T) {
	cases := []struct {
		name string
		auth func() (*integrations.AuthTokenDetails, error)
		want string
	}{
		{"not enough scopes", func() (*integrations.AuthTokenDetails, error) {
			return nil, &integrations.NotEnoughScopes{Message: "Not enough scopes"}
		}, `{"msg":"Not enough scopes"}`},
		{"auth message", func() (*integrations.AuthTokenDetails, error) {
			return nil, integrations.AuthMessage("Invalid credentials")
		}, `{"msg":"Invalid credentials"}`},
		{"other error", func() (*integrations.AuthTokenDetails, error) {
			return nil, errors.New("boom")
		}, `{"msg":"Authentication failed"}`},
		{"missing id", func() (*integrations.AuthTokenDetails, error) {
			return &integrations.AuthTokenDetails{AccessToken: "tok"}, nil
		}, `{"msg":"Invalid API key"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			f.provider.auth = tc.auth
			f.noAuth()
			f.state(t)
			status, body := do(t, f.router, http.MethodPost, "/integrations/social-connect/fake", `{"state":"state1","code":"c","timezone":"0"}`)
			if status != http.StatusConflict || body != tc.want {
				t.Fatalf("got %d %s", status, body)
			}
		})
	}
}

func TestConnectSocialMediaNonExpiringToken(t *testing.T) {
	f := setup(t)
	f.provider.auth = func() (*integrations.AuthTokenDetails, error) {
		return &integrations.AuthTokenDetails{ID: "non-expiring", Username: "me@example.social", AccessToken: "token", NonExpiring: true}, nil
	}
	f.noAuth()
	f.state(t)
	status, _ := do(t, f.router, http.MethodPost, "/integrations/social-connect/fake", `{"state":"state1","code":"code","timezone":"0"}`)
	if status != http.StatusCreated {
		t.Fatalf("connection status %d", status)
	}
	stored := f.client.Integration.Query().OnlyX(f.ctx)
	if stored.TokenExpiration != nil || stored.RefreshToken != nil {
		t.Fatal("non-expiring token was assigned an invented expiry or refresh token")
	}
	// A reconnect must clear a legacy invented expiry on the same integration.
	expires := int64(60)
	_, err := f.service.CreateOrUpdateIntegration(f.ctx, integration.CreateOrUpdateIntegrationParams{
		Org: f.org.ID, Type: "social", Name: "Account", Provider: "fake", InternalID: "non-expiring", Token: "old", ExpiresIn: &expires,
	})
	if err != nil {
		t.Fatal(err)
	}
	f.state(t)
	status, _ = do(t, f.router, http.MethodPost, "/integrations/social-connect/fake", `{"state":"state1","code":"new-code","timezone":"0"}`)
	if status != http.StatusCreated {
		t.Fatalf("reconnection status %d", status)
	}
	updated := f.client.Integration.Query().OnlyX(f.ctx)
	if updated.ID != stored.ID || updated.TokenExpiration != nil {
		t.Fatal("reconnection failed to preserve identity and clear legacy expiry")
	}
}

func TestFunctionRefreshesTokenAndRetries(t *testing.T) {
	f := setup(t)
	in, err := f.service.CreateOrUpdateIntegration(f.ctx, integration.CreateOrUpdateIntegrationParams{
		Org: f.org.ID, Name: "Alice", Type: "social", InternalID: "acc-1", Provider: "fake", Token: "old-token", RefreshToken: "ref",
	})
	if err != nil {
		t.Fatal(err)
	}
	perms := auth.NewPermissionsService(nil, nil, nil, nil)
	RegisterIntegrationsController(f.router, asOrg(f.org), perms, integrations.NewManager([]integrations.Provider{f.provider}), f.service, nil, f.store)

	status, body := do(t, f.router, http.MethodPost, "/integrations/function", `{"id":"`+in.ID+`","name":"ping","data":{}}`)
	if status != http.StatusCreated || body != `{"token":"new-token"}` {
		t.Fatalf("got %d %s", status, body)
	}
	if strings.Join(f.provider.calls, ",") != "old-token,new-token" {
		t.Fatalf("calls %v", f.provider.calls)
	}

	status, body = do(t, f.router, http.MethodPost, "/integrations/function", `{"id":"`+in.ID+`","name":"nope"}`)
	if status != http.StatusInternalServerError {
		t.Fatalf("unknown function: %d %s", status, body)
	}
	status, _ = do(t, f.router, http.MethodPost, "/integrations/function", `{"name":"ping"}`)
	if status != http.StatusBadRequest {
		t.Fatalf("validation: %d", status)
	}
}

func TestGetIntegrationURLStoresState(t *testing.T) {
	f := setup(t)
	RegisterIntegrationsController(f.router, asOrg(f.org), auth.NewPermissionsService(nil, nil, nil, nil),
		integrations.NewManager([]integrations.Provider{f.provider}), f.service, nil, f.store)
	status, body := do(t, f.router, http.MethodGet, "/integrations/social/fake?refresh=acc-1&onboarding=true", "")
	if status != http.StatusOK || body != `{"url":"https://auth"}` {
		t.Fatalf("got %d %s", status, body)
	}
	for key, want := range map[string]string{"refresh:state1": "acc-1", "onboarding:state1": "true", "organization:state1": f.org.ID, "login:state1": "verifier"} {
		if got, _, _ := f.store.Get(f.ctx, key); got != want {
			t.Fatalf("%s = %q", key, got)
		}
	}
}

type fakeSubscriptions struct{}

func (fakeSubscriptions) GetSubscriptionByOrganizationID(context.Context, string) (*ent.Subscription, error) {
	return nil, nil
}
func (fakeSubscriptions) GetSubscription(context.Context, string) (*ent.Subscription, error) {
	return nil, nil
}

func TestWebhooksAndSets(t *testing.T) {
	f := setup(t)
	perms := auth.NewPermissionsService(fakeSubscriptions{}, nil, nil, webhooks.NewService(webhooks.NewRepository(f.client)))
	RegisterWebhooksController(f.router, asOrg(f.org), perms, webhooks.NewService(webhooks.NewRepository(f.client)))
	RegisterSetsController(f.router, asOrg(f.org), sets.NewService(sets.NewRepository(f.client)))

	denied := httpx.NewRouter()
	RegisterSetsController(denied, func(*httpx.Ctx) error { return auth.HTTPForbiddenException() }, sets.NewService(sets.NewRepository(f.client)))
	if status, _ := do(t, denied, http.MethodGet, "/sets", ""); status != http.StatusUnauthorized {
		t.Fatalf("auth required: %d", status)
	}

	if status, body := do(t, f.router, http.MethodPost, "/webhooks", `{"url":"https://example.com","integrations":[]}`); status != http.StatusBadRequest || !strings.Contains(body, "name") {
		t.Fatalf("validation: %d %s", status, body)
	}

	// FREE tier has no webhooks once billing is on
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	t.Setenv("FRONTEND_URL", "https://app")
	status, body := do(t, f.router, http.MethodPost, "/webhooks", `{"name":"n","url":"https://example.com","integrations":[]}`)
	if status != http.StatusPaymentRequired || !strings.Contains(body, `"url":"https://app/billing"`) {
		t.Fatalf("policy: %d %s", status, body)
	}

	status, body = do(t, f.router, http.MethodPost, "/sets", `{"name":"Set","content":"{}"}`)
	if status != http.StatusCreated || !strings.Contains(body, `"id"`) {
		t.Fatalf("create set: %d %s", status, body)
	}
	status, body = do(t, f.router, http.MethodGet, "/sets", "")
	if status != http.StatusOK || !strings.Contains(body, `"name":"Set"`) {
		t.Fatalf("list sets: %d %s", status, body)
	}
}

func TestNodeBase64(t *testing.T) {
	for in, want := range map[string]string{"eyJhIjoxfQ==": `{"a":1}`, "eyJhIjoxfQ": `{"a":1}`, "eyJh-_8": "{\"a\xfb\xff"} {
		if got := string(nodeBase64(in)); got != want {
			t.Fatalf("%s: %q", in, got)
		}
	}
}

// posts.Service is wired directly as PostsService.
var _ PostsService = (*posts.Service)(nil)
