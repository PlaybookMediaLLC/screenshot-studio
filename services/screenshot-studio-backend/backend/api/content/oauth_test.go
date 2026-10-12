package content

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/oauth"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/oauth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

func TestOAuthAuthorizeTokenFlow(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("OPENAI_OAUTH_CLIENT_ID", "")
	ctx := context.Background()
	c := dbtest.Open(t)
	org := c.Organization.Create().SetName("Acme").SaveX(ctx)
	user := c.User.Create().SetEmail("a@b.c").SetProviderName("LOCAL").SetTimezone(0).SaveX(ctx)
	svc := oauth.NewService(oauth.NewRepository(c))
	app, err := svc.CreateApp(ctx, org.ID, dto.CreateOAuthAppDto{Name: "App", RedirectURL: "https://app.example/cb?x=1"})
	if err != nil {
		t.Fatal(err)
	}

	r := httpx.NewRouter()
	RegisterOAuthController(r, svc, nil, redis.NewMemory())
	RegisterOAuthAuthorizedController(r, as(user, org), svc)

	res := do(t, r, httptest.NewRequest(http.MethodGet, "/oauth/authorize?client_id="+app.ClientID+"&response_type=code&state=s1", nil))
	want := `{"app":{"name":"App","description":null,"picture":null,"clientId":"` + app.ClientID + `","redirectUrl":"https://app.example/cb?x=1"},"state":"s1","selfHosted":false,"selfHostedEmail":false}`
	if res.status != 200 || res.body != want {
		t.Fatalf("authorize: %d %s", res.status, res.body)
	}
	if res := do(t, r, httptest.NewRequest(http.MethodGet, "/oauth/authorize?client_id=nope&response_type=code", nil)); res.status != 400 {
		t.Fatalf("unknown client: %d %s", res.status, res.body)
	}

	res = do(t, r, jsonRequest(http.MethodPost, "/oauth/authorize", `{"client_id":"`+app.ClientID+`","action":"deny","state":"s1"}`))
	if res.status != 201 || res.json(t)["redirect"] != "https://app.example/cb?x=1&error=access_denied&state=s1" {
		t.Fatalf("deny: %d %s", res.status, res.body)
	}

	res = do(t, r, jsonRequest(http.MethodPost, "/oauth/authorize", `{"client_id":"`+app.ClientID+`","action":"approve","state":"s1"}`))
	redirect, _ := res.json(t)["redirect"].(string)
	u, err := url.Parse(redirect)
	if res.status != 201 || err != nil || !strings.HasPrefix(redirect, "https://app.example/cb?x=1&code=") || u.Query().Get("state") != "s1" {
		t.Fatalf("approve: %d %s", res.status, res.body)
	}
	code := u.Query().Get("code")

	token := func(form url.Values, basic string) response {
		req := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if basic != "" {
			req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(basic)))
		}
		return do(t, r, req)
	}

	if res := token(url.Values{"grant_type": {"client_credentials"}, "code": {code}}, ""); res.status != 400 || res.body != `{"error":"unsupported_grant_type"}` {
		t.Fatalf("grant: %d %s", res.status, res.body)
	}
	if res := token(url.Values{"grant_type": {"authorization_code"}, "code": {code}}, ""); res.status != 401 || res.body != `{"error":"invalid_client"}` {
		t.Fatalf("no client: %d %s", res.status, res.body)
	}

	// client_secret_basic, sent as a form
	res = token(url.Values{"grant_type": {"authorization_code"}, "code": {code}}, url.QueryEscape(app.ClientID)+":"+url.QueryEscape(app.ClientSecret))
	body := res.json(t)
	if res.status != 200 || !strings.HasPrefix(body["access_token"].(string), "pos_") || body["id"] != org.ID {
		t.Fatalf("token: %d %s", res.status, res.body)
	}

	// a code works once
	if res := token(url.Values{"grant_type": {"authorization_code"}, "code": {code}, "client_id": {app.ClientID}, "client_secret": {app.ClientSecret}}, ""); res.status != 400 {
		t.Fatalf("reuse: %d %s", res.status, res.body)
	}
}

func TestSetSearchParam(t *testing.T) {
	u, _ := jsURL("https://a.example")
	setSearchParam(u, "code", "a b")
	if u.String() != "https://a.example/?code=a+b" {
		t.Fatal(u.String())
	}
	u, _ = jsURL("https://a.example/cb?code=old&flag&code=again&z=1")
	setSearchParam(u, "code", "new")
	if u.String() != "https://a.example/cb?code=new&flag=&z=1" {
		t.Fatal(u.String())
	}
}
