package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/oauth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/oauthauthorization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// The original app stores UTC in "timestamp without time zone" columns and pgx writes
// the wall clock, so the process must run in UTC (as it does in production).
func TestMain(m *testing.M) {
	time.Local = time.UTC
	os.Exit(m.Run())
}

func status(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func TestOAuthFlow(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("OPENAI_OAUTH_CLIENT_ID", "")
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))

	org := client.Organization.Create().SetName("Acme").SetPaymentID("cus_1").SaveX(ctx)
	user := client.User.Create().SetEmail("a@b.c").SetProviderName("LOCAL").SetTimezone(0).SaveX(ctx)

	// static app: one per org, secret returned once
	app, err := s.CreateApp(ctx, org.ID, dto.CreateOAuthAppDto{Name: "App", RedirectURL: "https://app.example/cb"})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(app)
	if !strings.Contains(string(data), `"clientSecret":"pcs_`) || !strings.HasPrefix(app.ClientID, "pca_") {
		t.Fatalf("create app: %s", data)
	}
	if _, err := s.CreateApp(ctx, org.ID, dto.CreateOAuthAppDto{Name: "B", RedirectURL: "https://x"}); status(err) != 400 {
		t.Fatalf("second app: %v", err)
	}
	got, _ := s.GetApp(ctx, org.ID)
	if data, _ := json.Marshal(got); strings.Contains(string(data), "clientSecret") {
		t.Fatalf("secret leaked: %s", data)
	}

	// code exchange with PKCE
	verifier := "verifier-123"
	code, err := s.CreateAuthorizationCode(ctx, app.ID, user.ID, org.ID, PKCEOptions{CodeChallenge: challenge(verifier), CodeChallengeMethod: "S256", RedirectURI: "https://app.example/cb"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ExchangeCodeForToken(ctx, code, app.ClientID, "wrong", verifier, "https://app.example/cb"); status(err) != 401 {
		t.Fatalf("bad secret: %v", err)
	}
	if _, err := s.ExchangeCodeForToken(ctx, code, app.ClientID, app.ClientSecret, "nope", "https://app.example/cb"); status(err) != 400 {
		t.Fatalf("bad verifier: %v", err)
	}
	if _, err := s.ExchangeCodeForToken(ctx, code, app.ClientID, app.ClientSecret, verifier, "https://other/cb"); status(err) != 400 {
		t.Fatalf("redirect mismatch: %v", err)
	}
	token, err := s.ExchangeCodeForToken(ctx, code, app.ClientID, app.ClientSecret, verifier, "https://app.example/cb")
	if err != nil {
		t.Fatal(err)
	}
	if token["id"] != org.ID || *token["cus"].(*string) != "cus_1" || token["scope"] != "mcp:read mcp:write" {
		t.Fatalf("token: %v", token)
	}
	// a code works once
	if _, err := s.ExchangeCodeForToken(ctx, code, app.ClientID, app.ClientSecret, verifier, "https://app.example/cb"); status(err) != 400 {
		t.Fatalf("code reuse: %v", err)
	}
	auth, err := s.GetOrgByOAuthToken(ctx, token["access_token"].(string))
	if err != nil || auth == nil || auth.Edges.Organization.ID != org.ID || auth.Edges.User.ID != user.ID {
		t.Fatalf("lookup: %v %v", auth, err)
	}

	approved, _ := s.GetApprovedApps(ctx, user.ID)
	if len(approved) != 1 || approved[0].Edges.OauthApp == nil {
		t.Fatalf("approved: %v", approved)
	}
	if _, err := s.RevokeApp(ctx, "someone-else", approved[0].ID); err == nil {
		t.Fatal("revoked another user's app")
	}
	if _, err := s.RevokeApp(ctx, user.ID, approved[0].ID); err != nil {
		t.Fatal(err)
	}
	if auth, _ := s.GetOrgByOAuthToken(ctx, token["access_token"].(string)); auth != nil {
		t.Fatal("revoked token still valid")
	}

	// re-authorizing reuses the row and clears the revocation
	code, _ = s.CreateAuthorizationCode(ctx, app.ID, user.ID, org.ID, PKCEOptions{})
	if n := client.OAuthAuthorization.Query().CountX(ctx); n != 1 {
		t.Fatalf("authorizations: %d", n)
	}
	if _, err := s.ExchangeCodeForToken(ctx, code, app.ClientID, app.ClientSecret, "", ""); err != nil {
		t.Fatal(err)
	}

	// expired code
	code, _ = s.CreateAuthorizationCode(ctx, app.ID, user.ID, org.ID, PKCEOptions{})
	client.OAuthAuthorization.Update().SetCodeExpiresAt(time.Now().Add(-time.Minute)).ExecX(ctx)
	if _, err := s.ExchangeCodeForToken(ctx, code, app.ClientID, app.ClientSecret, "", ""); status(err) != 400 {
		t.Fatalf("expired: %v", err)
	}

	// deleting the app revokes everything
	if _, err := s.DeleteApp(ctx, org.ID); err != nil {
		t.Fatal(err)
	}
	if n := client.OAuthAuthorization.Query().Where(oauthauthorization.RevokedAtIsNil()).CountX(ctx); n != 0 {
		t.Fatalf("unrevoked after delete: %d", n)
	}
	if got, _ := s.GetApp(ctx, org.ID); got != nil {
		t.Fatal("app not deleted")
	}
}

func TestDynamicClientAndAgentCodes(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("OPENAI_OAUTH_CLIENT_ID", "")
	t.Setenv("DCR_VERIFIED_DOMAINS", "claude.ai")
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))

	for uri, want := range map[string]int{
		"javascript:alert(1)":         400,
		"http://evil.com/cb":          400,
		"https://evilclaude.ai/cb":    400,
		"not a url":                   400,
		"https://app.claude.ai/cb":    0,
		"http://localhost:3000/cb":    0,
		"cursor://anysphere/oauth/cb": 0,
	} {
		_, err := s.RegisterDynamicClient(ctx, dto.RegisterClientDto{RedirectURIs: []string{uri}})
		if status(err) != want || (want == 0 && err != nil) {
			t.Errorf("%s: %v", uri, err)
		}
	}

	name := "  Claude  "
	reg, err := s.RegisterDynamicClient(ctx, dto.RegisterClientDto{
		RedirectURIs: []string{"https://claude.ai/cb"}, ClientName: &name, TokenEndpointAuthMethod: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(reg)
	if reg.ClientName != "Claude" || strings.Contains(string(data), "client_secret") || !strings.HasPrefix(reg.ClientID, "pcd_") {
		t.Fatalf("register: %s", data)
	}

	// dynamic clients must use a registered redirect_uri and PKCE
	if _, err := s.ValidateAuthorizationRequest(ctx, reg.ClientID, PKCEOptions{RedirectURI: "https://claude.ai/other"}); status(err) != 400 {
		t.Fatalf("redirect: %v", err)
	}
	if _, err := s.ValidateAuthorizationRequest(ctx, reg.ClientID, PKCEOptions{RedirectURI: "https://claude.ai/cb"}); status(err) != 400 {
		t.Fatalf("pkce required: %v", err)
	}
	if _, err := s.ValidateAuthorizationRequest(ctx, reg.ClientID, PKCEOptions{RedirectURI: "https://claude.ai/cb", CodeChallenge: "x", CodeChallengeMethod: "plain"}); status(err) != 400 {
		t.Fatalf("plain: %v", err)
	}
	app, err := s.ValidateAuthorizationRequest(ctx, reg.ClientID, PKCEOptions{RedirectURI: "https://claude.ai/cb", CodeChallenge: "x", CodeChallengeMethod: "S256"})
	if err != nil {
		t.Fatal(err)
	}
	if app.ClientID != reg.ClientID {
		t.Fatalf("validated app: %v", app.ClientID)
	}

	// A Shots consent code (shc_) is exchanged by the platform once the
	// client authenticated; without an exchanger it is an invalid grant.
	if _, err := s.ExchangeCodeForToken(ctx, "shc_code", reg.ClientID, "", "v", "https://claude.ai/cb"); status(err) != 400 {
		t.Fatalf("shc_ without an exchanger: %v", err)
	}
	exchanger := &fakeAgentCodes{}
	s.WithAgentCodes(exchanger)
	token, err := s.ExchangeCodeForToken(ctx, "shc_code", reg.ClientID, "", "v", "https://claude.ai/cb")
	if err != nil || token["access_token"] != "ss_key" || exchanger.clientID != reg.ClientID || exchanger.verifier != "v" {
		t.Fatalf("agent token: %v %v %+v", token, err, exchanger)
	}
	if _, err := s.ExchangeCodeForToken(ctx, "shc_code", "pcd_unknown", "", "v", ""); status(err) != 401 {
		t.Fatalf("unknown client: %v", err)
	}

	// userinfo needs OIDC claims enabled and a bearer token
	if _, err := s.GetUserInfo(ctx, "Bearer pos_unknown"); status(err) != 404 {
		t.Fatalf("userinfo disabled: %v", err)
	}
	t.Setenv("OPENAI_OAUTH_CLIENT_ID", "chatgpt")
	if _, err := s.GetUserInfo(ctx, "Basic x"); status(err) != 401 {
		t.Fatalf("no bearer: %v", err)
	}
}

type fakeAgentCodes struct{ clientID, verifier string }

func (f *fakeAgentCodes) ExchangeAgentCode(_ context.Context, clientID, _, codeVerifier, _ string) (map[string]any, error) {
	f.clientID, f.verifier = clientID, codeVerifier
	return map[string]any{"access_token": "ss_key", "token_type": "bearer"}, nil
}

func TestExtractBearerToken(t *testing.T) {
	for in, want := range map[string]string{"Bearer abc": "abc", "bearer  abc ": "abc", "Bearer ": "", "Basic abc": "", "": ""} {
		if got := ExtractBearerToken(in); got != want {
			t.Errorf("%q: %q", in, got)
		}
	}
}
