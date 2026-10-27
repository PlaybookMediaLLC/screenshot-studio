package auth

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
)

type fakeProvider struct {
	user  *ProviderUser
	token string
}

func (f fakeProvider) GenerateLink(_ context.Context, q map[string]string) (string, error) {
	return "link:" + q["state"], nil
}
func (f fakeProvider) GetToken(context.Context, string, string) (string, error) { return f.token, nil }
func (f fakeProvider) GetUser(context.Context, string) (*ProviderUser, error)   { return f.user, nil }

type serviceFixture struct {
	svc        *AuthService
	users      *fakeUsers
	orgs       *fakeOrgs
	email      *fakeEmail
	newsletter *fakeNewsletter
}

func newServiceFixture(t *testing.T) serviceFixture {
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://app.sample.com")
	f := serviceFixture{users: newFakeUsers(), orgs: newFakeOrgs(), email: &fakeEmail{}, newsletter: &fakeNewsletter{}}
	manager := NewAuthProviderManager(redis.NewMemory())
	manager.providers["GITHUB"] = fakeProvider{user: &ProviderUser{ID: "gh1", Email: "gh@x.com"}, token: "tok"}
	f.svc = NewAuthService(f.users, f.orgs, f.email, manager, f.newsletter)
	return f
}

func claims(t *testing.T, token string) map[string]any {
	t.Helper()
	c, err := helpers.VerifyJWT(token)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestRegisterLocal(t *testing.T) {
	f := newServiceFixture(t)
	invite := &OrgCookie{OrgID: "o9", ID: "inv", Role: "ADMIN"}
	res, err := f.svc.RouteAuth(context.Background(), user.ProviderNameLOCAL,
		AuthBody{Email: "New@X.com", Password: "pw123", Provider: user.ProviderNameLOCAL, Company: "Acme"}, true, "1.2.3.4", "ua", invite)
	if err != nil {
		t.Fatal(err)
	}
	if f.orgs.created[0].Email != "new@x.com" || f.orgs.created[0].Company != "Acme" {
		t.Fatalf("created %+v", f.orgs.created)
	}
	if res.AddedOrg == nil || f.orgs.added[0] != "new-user|inv|o9|ADMIN" {
		t.Fatalf("added %v", f.orgs.added)
	}
	c := claims(t, res.JWT)
	if _, has := c["password"]; has || c["id"] != "new-user" {
		t.Fatalf("claims %v: a non-empty password must not be signed", c)
	}
	if len(f.email.sent) != 1 || !strings.Contains(f.email.sent[0], "new@x.com|Activate your account|Click <a href=\"https://app.sample.com/auth/activate/"+res.JWT+"\">here</a>") {
		t.Fatalf("email %v", f.email.sent)
	}

	f.users.byEmail["new@x.com"] = &ent.User{ID: "new-user"}
	if _, err := f.svc.RouteAuth(context.Background(), user.ProviderNameLOCAL, AuthBody{Email: "new@x.com"}, true, "", "", nil); err == nil || err.Error() != "Email already exists" {
		t.Fatal(err)
	}
}

func TestRegisterRules(t *testing.T) {
	f := newServiceFixture(t)
	t.Setenv("DISALLOW_PLUS", "true")
	if _, err := f.svc.RouteAuth(context.Background(), user.ProviderNameLOCAL, AuthBody{Email: "a+b@x.com"}, true, "", "", nil); err == nil || err.Error() != "Email with plus sign is not allowed" {
		t.Fatal(err)
	}
	t.Setenv("DISABLE_REGISTRATION", "true")
	f.orgs.count = 1
	if _, err := f.svc.RouteAuth(context.Background(), user.ProviderNameLOCAL, AuthBody{Email: "a@x.com"}, true, "", "", nil); err == nil || err.Error() != "Registration is disabled" {
		t.Fatal(err)
	}
	if ok, _ := f.svc.CanRegister(context.Background(), "GENERIC"); !ok {
		t.Fatal("GENERIC can always register")
	}
	f.orgs.count = 0
	if ok, _ := f.svc.CanRegister(context.Background(), "LOCAL"); !ok {
		t.Fatal("first org can register")
	}
}

func TestLoginLocal(t *testing.T) {
	f := newServiceFixture(t)
	hash, _ := helpers.HashPassword("pw123")
	f.users.byEmail["a@x.com"] = &ent.User{ID: "u1", Email: "a@x.com", Password: &hash, Activated: false}
	login := func(pw string) (*RouteAuthResult, error) {
		return f.svc.RouteAuth(context.Background(), user.ProviderNameLOCAL, AuthBody{Email: "a@x.com", Password: pw}, false, "", "", nil)
	}
	if _, err := login("bad"); err == nil || err.Error() != "Invalid user name or password" {
		t.Fatal(err)
	}
	if _, err := login("pw123"); err == nil || err.Error() != "User is not activated" {
		t.Fatal(err)
	}
	f.users.byEmail["a@x.com"].Activated = true
	res, err := login("pw123")
	if err != nil || res.AddedOrg != nil || claims(t, res.JWT)["id"] != "u1" {
		t.Fatal(res, err)
	}
}

func TestProviderLoginAndRegister(t *testing.T) {
	f := newServiceFixture(t)
	res, err := f.svc.RouteAuth(context.Background(), user.ProviderNameGITHUB,
		AuthBody{ProviderToken: "tok", Company: "Acme", Provider: user.ProviderNameGITHUB}, true, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	created := f.orgs.created[0]
	if created.Email != "gh@x.com" || created.ProviderID != "gh1" || created.Password != "" || created.Provider != user.ProviderNameGITHUB {
		t.Fatalf("created %+v", created)
	}
	if len(f.newsletter.registered) != 1 {
		t.Fatal("newsletter not registered")
	}
	// No password key at all (the original app signed provider users with password: "").
	if c := claims(t, res.JWT); c["id"] == nil {
		t.Fatalf("claims %v", c)
	} else if _, has := c["password"]; has {
		t.Fatalf("claims %v: password must not be signed", c)
	}

	f.users.byProvider["GITHUB:gh1"] = &ent.User{ID: "existing"}
	res, err = f.svc.RouteAuth(context.Background(), user.ProviderNameGITHUB, AuthBody{ProviderToken: "tok"}, false, "", "", nil)
	if err != nil || claims(t, res.JWT)["id"] != "existing" || len(f.orgs.created) != 1 {
		t.Fatal(err)
	}

	if _, err := f.svc.RouteAuth(context.Background(), "NOPE", AuthBody{}, false, "", "", nil); err == nil || err.Error() != "Auth provider NOPE not found" {
		t.Fatal(err)
	}
}

func TestCheckExists(t *testing.T) {
	f := newServiceFixture(t)
	ctx := context.Background()
	if _, err := f.svc.CheckExists(ctx, "GITHUB", "code", "", "a", "b"); err == nil || err.Error() != "Invalid state" {
		t.Fatal(err)
	}
	res, err := f.svc.CheckExists(ctx, "GITHUB", "code", "", "s", "s")
	if err != nil || res.Token != "tok" || res.JWT != "" {
		t.Fatal(res, err)
	}
	// the mobile flow passes redirect_uri and no state
	f.users.byProvider["GITHUB:gh1"] = &ent.User{ID: "existing"}
	res, err = f.svc.CheckExists(ctx, "GITHUB", "code", "app://cb", "", "")
	if err != nil || claims(t, res.JWT)["id"] != "existing" {
		t.Fatal(res, err)
	}
	link, err := f.svc.OAuthLink(ctx, "GITHUB", map[string]string{"state": "login-x"})
	if err != nil || link != "link:login-x" {
		t.Fatal(link, err)
	}
}

func TestForgotFlow(t *testing.T) {
	f := newServiceFixture(t)
	ctx := context.Background()
	f.users.byEmail["a@x.com"] = &ent.User{ID: "u1", Email: "a@x.com", ProviderName: user.ProviderNameLOCAL}
	if err := f.svc.Forgot(ctx, "a@x.com"); err != nil {
		t.Fatal(err)
	}
	sent := f.email.sent[0]
	token := sent[strings.Index(sent, "/auth/forgot/")+len("/auth/forgot/"):]
	token = token[:strings.Index(token, `"`)]
	if c := claims(t, token); c["id"] != "u1" || len(c["expires"].(string)) != len("2006-01-02 15:04:05") {
		t.Fatalf("claims %v", c)
	}
	ok, err := f.svc.ForgotReturn(ctx, token, "newpw")
	if err != nil || !ok || f.users.passwords["u1"] != "newpw" {
		t.Fatal(ok, err)
	}
	expired, _ := helpers.SignJWT(map[string]any{"id": "u1", "expires": time.Now().UTC().Add(-time.Minute).Format(time.DateTime)})
	if ok, err := f.svc.ForgotReturn(ctx, expired, "x"); ok || err != nil {
		t.Fatal(ok, err)
	}
	// A token without a valid expires never resets a password.
	noExpiry, _ := helpers.SignJWT(map[string]any{"id": "u1"})
	badExpiry, _ := helpers.SignJWT(map[string]any{"id": "u1", "expires": "soon"})
	for _, token := range []string{noExpiry, badExpiry} {
		f.users.passwords["u1"] = "kept"
		if ok, err := f.svc.ForgotReturn(ctx, token, "x"); ok || err != nil || f.users.passwords["u1"] != "kept" {
			t.Fatal(ok, err, f.users.passwords["u1"])
		}
	}
	if _, err := f.svc.ForgotReturn(ctx, "garbage", "x"); err == nil {
		t.Fatal("invalid token must error")
	}
}

func TestActivate(t *testing.T) {
	f := newServiceFixture(t)
	ctx := context.Background()
	code, _ := helpers.SignJWT(map[string]any{"id": "u1", "email": "a@x.com", "activated": false, "password": ""})
	f.users.byEmail["a@x.com"] = &ent.User{ID: "u1", Activated: false}
	token, err := f.svc.Activate(ctx, code, "visitor")
	if err != nil || token == "" || f.users.activated[0] != "u1" || f.newsletter.registered[0] != "a@x.com" {
		t.Fatal(token, err)
	}
	if c := claims(t, token); c["activated"] != true || c["id"] != "u1" {
		t.Fatalf("claims %v", c)
	}
	f.users.byEmail["a@x.com"].Activated = true
	if token, err := f.svc.Activate(ctx, code, ""); token != "" || err != nil {
		t.Fatal(token, err)
	}
}

func TestResendActivationEmail(t *testing.T) {
	f := newServiceFixture(t)
	ctx := context.Background()
	if _, err := f.svc.ResendActivationEmail(ctx, "x@x.com"); err == nil || err.Error() != "User not found" {
		t.Fatal(err)
	}
	f.users.byEmail["a@x.com"] = &ent.User{ID: "u1", Email: "a@x.com", Activated: true}
	if _, err := f.svc.ResendActivationEmail(ctx, "a@x.com"); err == nil || err.Error() != "Account is already activated" {
		t.Fatal(err)
	}
	f.users.byEmail["a@x.com"].Activated = false
	if ok, err := f.svc.ResendActivationEmail(ctx, "a@x.com"); !ok || err != nil || len(f.email.sent) != 1 {
		t.Fatal(ok, err)
	}
}

func TestGetOrgFromCookie(t *testing.T) {
	f := newServiceFixture(t)
	valid, _ := helpers.SignJWT(map[string]any{"email": "a@x.com", "role": "USER", "orgId": "o1", "id": "inv",
		"timeLimit": time.Now().UTC().Add(48 * time.Hour).Format(time.DateTime)})
	if got := f.svc.GetOrgFromCookie(valid); got == nil || *got != (OrgCookie{Email: "a@x.com", Role: "USER", OrgID: "o1", ID: "inv"}) {
		t.Fatal(got)
	}
	expired, _ := helpers.SignJWT(map[string]any{"orgId": "o1", "timeLimit": time.Now().UTC().Add(-time.Hour).Format(time.DateTime)})
	if f.svc.GetOrgFromCookie(expired) != nil || f.svc.GetOrgFromCookie("") != nil || f.svc.GetOrgFromCookie("bad") != nil {
		t.Fatal("expected nil")
	}
	// An invite without a valid timeLimit is rejected.
	noLimit, _ := helpers.SignJWT(map[string]any{"email": "a@x.com", "role": "USER", "orgId": "o1", "id": "inv"})
	badLimit, _ := helpers.SignJWT(map[string]any{"orgId": "o1", "timeLimit": true})
	if f.svc.GetOrgFromCookie(noLimit) != nil || f.svc.GetOrgFromCookie(badLimit) != nil {
		t.Fatal("cookie without a valid timeLimit accepted")
	}
}
