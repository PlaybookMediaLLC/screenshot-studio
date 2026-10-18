package account

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/adminstats"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/announcements"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/errorsdb"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/users"
	dtoauth "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/payment"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/track"
)

// ---- fakes for the services these controllers don't own ----

type fakeEmail struct{ provider bool }

func (f *fakeEmail) HasProvider() bool { return f.provider }
func (f *fakeEmail) SendEmail(context.Context, string, string, string, string, string) error {
	return nil
}
func (f *fakeEmail) SendEmailSync(context.Context, string, string, string) error { return nil }

type fakeNewsletter struct{}

func (fakeNewsletter) Register(context.Context, string) error { return nil }

type fakeIntegrations struct{}

func (fakeIntegrations) GetIntegrationsList(context.Context, string) ([]*ent.Integration, error) {
	return nil, nil
}
func (fakeIntegrations) DisableIntegrations(context.Context, string, int) error     { return nil }
func (fakeIntegrations) EnableAllIntegrations(context.Context, string) (int, error) { return 0, nil }
func (fakeIntegrations) ChangeActiveCron(context.Context, string) (bool, error)     { return true, nil }
func (fakeIntegrations) DeleteIntegrationsForAccount(context.Context, string) error { return nil }
func (fakeIntegrations) GetIntegrationByInternalID(context.Context, string, string) (*ent.Integration, error) {
	return nil, nil
}

type fakeCounts struct{}

func (fakeCounts) GetTotal(context.Context, string) (int, error) { return 0, nil }

type fakePosts struct{ deleted chan string }

func (fakePosts) CheckPostAnalytics(_ context.Context, orgID, postID string, date int64, _ bool) (any, error) {
	return map[string]any{"org": orgID, "post": postID, "date": date}, nil
}
func (f fakePosts) DeletePost(_ context.Context, _, group string) (map[string]bool, error) {
	f.deleted <- group
	return nil, nil
}

type fakeTrack struct{ calls []string }

func (f *fakeTrack) Track(_ context.Context, uniqueID, _, _ string, tt track.Enum, _ map[string]any, fbclid string, _ *ent.User) error {
	f.calls = append(f.calls, uniqueID+"|"+fbclid)
	return nil
}

// orgAdapter makes organizations.Service fit auth.OrganizationService.
type orgAdapter struct{ *organizations.Service }

func (a orgAdapter) CreateOrgAndUser(ctx context.Context, body auth.CreateOrgAndUserBody, ip, userAgent string) (*ent.Organization, error) {
	provider := string(body.Provider)
	return a.Service.CreateOrgAndUser(ctx, &dtoauth.CreateOrgUserDto{
		Password: &body.Password, Provider: &provider, Email: &body.Email, Company: &body.Company,
		ProviderID: body.ProviderID, DatafastVisitorID: body.DatafastVisitorID,
	}, ip, userAgent)
}

// paymentSubs is payment.SubscriptionService over nothing (no subscription rows).
type paymentSubs struct{}

func (paymentSubs) GetSubscriptionByOrganizationID(context.Context, string) (*ent.Subscription, error) {
	return nil, nil
}
func (paymentSubs) GetSubscription(context.Context, string) (*ent.Subscription, error) {
	return nil, nil
}
func (paymentSubs) GetCode(context.Context, string) (*ent.UsedCodes, error) { return nil, nil }
func (paymentSubs) CheckSubscription(context.Context, string, string) (*ent.Subscription, error) {
	return nil, nil
}
func (paymentSubs) CreateOrUpdateSubscription(context.Context, string, bool, string, string, int, string, string, *int64, string, string) (any, error) {
	return nil, nil
}
func (paymentSubs) CreateOrUpdateSubscriptionByOrg(context.Context, bool, string, string, string, int, string, string, *int64) (any, error) {
	return nil, nil
}
func (paymentSubs) DeleteSubscription(context.Context, string, string) error        { return nil }
func (paymentSubs) DeleteSubscriptionByOrgID(context.Context, string, string) error { return nil }
func (paymentSubs) UpdateCustomerID(context.Context, string, string) error          { return nil }
func (paymentSubs) UpdateCancelAt(context.Context, string, *int64) error            { return nil }

// fakeProvider is a web payment provider whose webhook echoes the raw body.
type fakeProvider struct {
	payment.Unsupported
	webhookErr error
}

func (f *fakeProvider) ValidateWebhook(_ context.Context, raw []byte, headers http.Header) (any, error) {
	if f.webhookErr != nil {
		return nil, f.webhookErr
	}
	return map[string]string{"raw": string(raw), "sig": headers.Get("Stripe-Signature")}, nil
}
func (f *fakeProvider) ProcessWebhook(_ context.Context, event any) (any, error) { return event, nil }
func (f *fakeProvider) CheckDiscount(context.Context, *ent.Organization) (bool, error) {
	return true, nil
}
func (f *fakeProvider) GetCharges(context.Context, string) (any, error) { return []string{}, nil }

// ---- harness ----

type env struct {
	t       *testing.T
	router  *httpx.Router
	email   *fakeEmail
	track   *fakeTrack
	posts   fakePosts
	stripe  *fakeProvider
	client  *ent.Client
	orgs    *organizations.Service
	users   *users.Service
	cookies []*http.Cookie
}

func newEnv(t *testing.T) *env {
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("FRONTEND_URL", "https://app.postiz.com")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "")
	t.Setenv("NOT_SECURED", "")
	client := dbtest.Open(t)
	e := &env{t: t, email: &fakeEmail{}, track: &fakeTrack{}, posts: fakePosts{deleted: make(chan string, 10)}, client: client}

	orgRepo := organizations.NewRepository(client)
	notif := notifications.NewService(notifications.NewRepository(client), e.email, orgRepo, nil)
	e.orgs = organizations.NewService(orgRepo, notif)
	e.users = users.NewService(users.NewRepository(client), orgRepo, fakeIntegrations{}, notif)
	subs := subscriptions.NewService(subscriptions.NewRepository(client), fakeIntegrations{}, e.orgs)
	store := redis.NewMemory()

	manager := payment.NewProviderManager()
	e.stripe = &fakeProvider{Unsupported: payment.Unsupported{P: payment.PlatformWeb}}
	manager.Register(payment.StripeProviderName, e.stripe)
	manager.Register("broken", &fakeProvider{Unsupported: payment.Unsupported{P: payment.PlatformMobile}, webhookErr: errors.New("boom")})
	payments := payment.NewService(manager, paymentSubs{})

	authService := auth.NewAuthService(e.users, orgAdapter{e.orgs}, e.email, auth.NewAuthProviderManager(store), fakeNewsletter{})
	mw := auth.AuthMiddleware(orgAdapter{e.orgs}, e.users)
	perms := auth.NewPermissionsService(subs, postCounter{}, fakeIntegrations{}, fakeCounts{})
	integrationService := integration.NewService(integration.NewRepository(client, nil), nil, integrations.NewManager(nil), nil, nil, store, nil)

	r := httpx.NewRouter()
	RegisterRootController(r)
	RegisterPaymentController(r, payments)
	RegisterStripeController(r, payments)
	RegisterAuthController(r, authService, e.email, store)
	RegisterMonitorController(r)
	RegisterEnterpriseController(r, integrations.NewManager(nil), e.orgs, integrationService, e.posts, store)
	RegisterUsersController(r, mw, perms, payments, authService, e.orgs, e.users, e.track)
	RegisterAnalyticsController(r, mw, integrationService, e.posts)
	RegisterSettingsController(r, mw, perms, e.orgs)
	RegisterBillingController(r, mw, perms, subs, notif, e.users, payments)
	RegisterNotificationsController(r, mw, notif)
	RegisterAnnouncementsController(r, mw, announcements.NewService(announcements.NewRepository(client)))
	RegisterAdminController(r, mw, errorsdb.NewService(errorsdb.NewRepository(client)), adminstats.NewService(adminstats.NewRepository(client)))
	e.router = r
	return e
}

type postCounter struct{}

func (postCounter) CountPostsFromDay(context.Context, string, time.Time) (int, error) {
	return 0, nil
}

func (e *env) do(method, target, body string, mutate ...func(*http.Request)) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, c := range e.cookies {
		req.AddCookie(c)
	}
	for _, m := range mutate {
		m(req)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

// expectValidation checks a validation 400 and its messages. It reads
// both the {message: [...], error, statusCode} body and a bare array.
func expectValidation(t *testing.T, rec *httptest.ResponseRecorder, messages ...string) {
	t.Helper()
	var got []string
	var body struct {
		Message    []string `json:"message"`
		Error      string   `json:"error"`
		StatusCode int      `json:"statusCode"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err == nil {
		got = body.Message
	} else if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("validation body %q", rec.Body.String())
	}
	if rec.Code != 400 || strings.Join(got, "|") != strings.Join(messages, "|") {
		t.Fatalf("got %d %q, want 400 %q", rec.Code, rec.Body.String(), messages)
	}
}

func cookieNamed(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func setCookieLine(rec *httptest.ResponseRecorder, name string) string {
	for _, line := range rec.Header().Values("Set-Cookie") {
		if strings.HasPrefix(line, name+"=") {
			return line
		}
	}
	return ""
}

func expect(t *testing.T, rec *httptest.ResponseRecorder, status int, body string) {
	t.Helper()
	if rec.Code != status || strings.TrimSpace(rec.Body.String()) != body {
		t.Fatalf("got %d %q, want %d %q", rec.Code, rec.Body.String(), status, body)
	}
}

// login registers (activated, no email provider) and keeps the auth cookie.
func (e *env) login(email string) {
	e.t.Helper()
	rec := e.do("POST", "/auth/register", `{"email":"`+email+`","password":"secret1","provider":"LOCAL","company":"Acme Inc"}`)
	expect(e.t, rec, 200, `{"register":true}`)
	e.cookies = []*http.Cookie{cookieNamed(rec, "auth")}
}

func (e *env) makeSuperAdmin(email string) {
	e.t.Helper()
	u, err := e.users.GetUserByEmail(context.Background(), email)
	if err != nil {
		e.t.Fatal(err)
	}
	if err := e.client.User.UpdateOneID(u.ID).SetIsSuperAdmin(true).Exec(context.Background()); err != nil {
		e.t.Fatal(err)
	}
}

// ---- tests ----

func TestRootAndMonitor(t *testing.T) {
	e := newEnv(t)
	expect(t, e.do("GET", "/", ""), 200, "App is running!")
	expect(t, e.do("GET", "/monitor/queue/main", ""), 200, `{"status":"success","message":"Queue main is healthy."}`)
}

func TestAuthRegisterLogin(t *testing.T) {
	e := newEnv(t)

	// ValidationPipe 400
	expectValidation(t, e.do("POST", "/auth/register", `{"provider":"LOCAL","company":"Acme"}`), "password should not be null or undefined", "password must be shorter than or equal to 64 characters", "password must be longer than or equal to 3 characters", "password must be a string", "providerToken should not be null or undefined", "providerToken must be a string", "email should not be null or undefined", "email must be an email")

	rec := e.do("POST", "/auth/register", `{"email":"Jo@Example.com","password":"secret1","provider":"LOCAL","company":"Acme Inc"}`)
	expect(t, rec, 200, `{"register":true}`)
	if rec.Header().Get("onboarding") != "true" || rec.Header().Get("auth") != "" {
		t.Fatalf("headers: %v", rec.Header())
	}
	line := setCookieLine(rec, "auth")
	for _, part := range []string{"Path=/", "Domain=postiz.com", "Expires=", "HttpOnly", "Secure", "SameSite=None"} {
		if !strings.Contains(line, part) {
			t.Fatalf("auth cookie %q misses %q", line, part)
		}
	}
	claims, err := helpers.VerifyJWT(cookieNamed(rec, "auth").Value)
	if err != nil || claims["email"] != "jo@example.com" {
		t.Fatalf("jwt claims %v %v", claims, err)
	}

	// service errors answer 400 with the message as text
	rec = e.do("POST", "/auth/register", `{"email":"jo@example.com","password":"secret1","provider":"LOCAL","company":"Acme Inc"}`)
	expect(t, rec, 400, "Email already exists")
	if !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("content type %q", rec.Header().Get("Content-Type"))
	}
	expect(t, e.do("POST", "/auth/login", `{"email":"jo@example.com","password":"wrong","provider":"LOCAL"}`), 400, "Invalid user name or password")

	// NOT_SECURED: no secure flags, token mirrored in the header
	t.Setenv("NOT_SECURED", "true")
	rec = e.do("POST", "/auth/login", `{"email":"jo@example.com","password":"secret1","provider":"LOCAL"}`)
	expect(t, rec, 200, `{"login":true}`)
	if rec.Header().Get("reload") != "true" || rec.Header().Get("auth") == "" {
		t.Fatalf("headers: %v", rec.Header())
	}
	if line := setCookieLine(rec, "auth"); strings.Contains(line, "Secure") || strings.Contains(line, "HttpOnly") {
		t.Fatalf("NOT_SECURED cookie %q", line)
	}
}

func TestAuthRegisterActivationRequired(t *testing.T) {
	e := newEnv(t)
	e.email.provider = true
	rec := e.do("POST", "/auth/register", `{"email":"a@example.com","password":"secret1","provider":"LOCAL","company":"Acme Inc"}`)
	expect(t, rec, 200, `{"activate":true}`)
	if rec.Header().Get("activate") != "true" || setCookieLine(rec, "auth") != "" {
		t.Fatalf("activation response: %v", rec.Header())
	}
	expect(t, e.do("POST", "/auth/login", `{"email":"a@example.com","password":"secret1","provider":"LOCAL"}`), 400, "User is not activated")
	expect(t, e.do("POST", "/auth/resend-activation", `{"email":"nobody@example.com"}`), 201, `{"success":false,"message":"User not found"}`)
	expect(t, e.do("POST", "/auth/forgot", `{"email":"a@example.com"}`), 201, `{"forgot":true}`)
}

func TestAuthRedirectsAndState(t *testing.T) {
	e := newEnv(t)
	rec := e.do("GET", "/auth/oauth-mobile-callback?code=a+b&state=x~y", "")
	if rec.Code != 302 || rec.Header().Get("Location") != "postiz://auth/callback?code=a+b&state=x%7Ey" {
		t.Fatalf("mobile callback %d %q", rec.Code, rec.Header().Get("Location"))
	}
	rec = e.do("POST", "/auth/oauth/github/redirect", `{"code":"c1","state":"s1"}`)
	if rec.Code != 303 || rec.Header().Get("Location") != "https://app.postiz.com/auth?code=c1&state=s1&provider=GITHUB" {
		t.Fatalf("redirect %d %q", rec.Code, rec.Header().Get("Location"))
	}
	rec = e.do("POST", "/auth/oauth/github/exists", "code=1", func(r *http.Request) {
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	})
	expect(t, rec, 400, "Invalid request")
	expect(t, e.do("POST", "/auth/oauth/github/exists", `{"code":"1"}`), 500, `{"statusCode":500,"message":"Internal server error"}`)
	expect(t, e.do("GET", "/auth/can-register", ""), 200, `{"register":true}`)
	t.Setenv("NEYNAR_APP_FID", "")
	expect(t, e.do("POST", "/auth/farcaster/signer", ""), 201, `{"error":"Farcaster is not configured: set NEYNAR_APP_FID and NEYNAR_APP_MNEMONIC"}`)
}

func TestUsersController(t *testing.T) {
	e := newEnv(t)

	// auth required: cookie cleared, empty 401
	rec := e.do("GET", "/user/self", "")
	if rec.Code != 401 || rec.Body.Len() != 0 || rec.Header().Get("logout") != "true" {
		t.Fatalf("unauthenticated %d %q", rec.Code, rec.Body.String())
	}

	e.login("me@example.com")
	rec = e.do("GET", "/user/self", "")
	if rec.Code != 200 || !strings.HasPrefix(rec.Body.String(), `{"id":`) {
		t.Fatalf("self %d %s", rec.Code, rec.Body.String())
	}
	var self map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &self)
	if self["role"] != "SUPERADMIN" || self["tier"] != "ULTIMATE" || self["totalChannels"] != float64(10000) ||
		self["publicApi"] == "" || self["impersonate"] != false || self["streakSince"] != nil || self["email"] != "me@example.com" {
		t.Fatalf("self body %v", self)
	}
	if _, ok := self["password"]; ok {
		t.Fatal("password leaked")
	}

	rec = e.do("GET", "/user/organizations", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"users":[{"disabled":false,"role":"SUPERADMIN"}],"subscription":null`) {
		t.Fatalf("organizations %s", rec.Body.String())
	}

	expect(t, e.do("GET", "/user/impersonate?name=x", ""), 400, `{"statusCode":400,"message":"Unauthorized"}`)
	expectValidation(t, e.do("POST", "/user/personal", `{"fullname":"ab"}`), "fullname must be longer than or equal to 3 characters")
	expect(t, e.do("POST", "/user/personal", `{"fullname":"Jo Doe","bio":"hi"}`), 201, "")
	expect(t, e.do("GET", "/user/personal", ""), 200, `{"id":"`+self["id"].(string)+`","name":"Jo Doe","bio":"hi","picture":null}`)
	expect(t, e.do("GET", "/user/subscription", ""), 200, `{}`)
	expect(t, e.do("POST", "/user/join-org", `{"org":"bad"}`), 200, `{"id":null}`)

	rec = e.do("POST", "/user/change-org", `{"id":"org-2"}`)
	if rec.Code != 200 || rec.Body.Len() != 0 || cookieNamed(rec, "showorg").Value != "org-2" {
		t.Fatalf("change-org %d %v", rec.Code, rec.Header())
	}

	rec = e.do("POST", "/user/t", `{"tt":0,"fbclid":"fb"}`)
	if rec.Code != 200 || cookieNamed(rec, "track") == nil || len(e.track.calls) != 1 || !strings.HasSuffix(e.track.calls[0], "|fb") {
		t.Fatalf("track %d %v", rec.Code, e.track.calls)
	}

	rec = e.do("POST", "/user/logout", "")
	if rec.Code != 200 || rec.Body.Len() != 0 || rec.Header().Get("logout") != "true" {
		t.Fatalf("logout %d", rec.Code)
	}
	for _, name := range []string{"auth", "showorg", "impersonate"} {
		if c := cookieNamed(rec, name); c == nil || c.Value != "" || c.MaxAge >= 0 {
			t.Fatalf("logout cookie %s: %v", name, c)
		}
	}

	expect(t, e.do("POST", "/user/delete-account", "", func(r *http.Request) { r.Header.Set("impersonate", "x") }), 400,
		`{"statusCode":400,"message":"Account cannot be deleted while impersonating"}`)
}

func TestSettingsPoliciesAndValidation(t *testing.T) {
	e := newEnv(t)
	e.login("owner@example.com")

	expectValidation(t, e.do("POST", "/settings/shortlink", `{"shortlink":"MAYBE"}`), "shortlink must be one of the following values: ASK, YES, NO")
	if rec := e.do("POST", "/settings/shortlink", `{"shortlink":"YES"}`); rec.Code != 201 {
		t.Fatalf("shortlink %d %s", rec.Code, rec.Body.String())
	}
	expect(t, e.do("GET", "/settings/shortlink", ""), 200, `{"shortlink":"YES"}`)
	if rec := e.do("GET", "/settings/team", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"role":"SUPERADMIN"`) {
		t.Fatalf("team %d %s", rec.Code, rec.Body.String())
	}
	expect(t, e.do("POST", "/settings/team/add", `{"email":"x@example.com","role":"USER"}`), 400, `{"statusCode":400,"message":"Unauthorized"}`)

	// with billing on, a FREE org has no team members: 402 before validation
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	expect(t, e.do("GET", "/settings/team", ""), 402, `{"statusCode":402,"url":"https://app.postiz.com/billing"}`)
	expect(t, e.do("POST", "/settings/team", `{}`), 402, `{"statusCode":402,"url":"https://app.postiz.com/billing"}`)
}

func TestBillingController(t *testing.T) {
	e := newEnv(t)
	e.login("pay@example.com")

	expect(t, e.do("GET", "/billing/", ""), 200, "")
	expect(t, e.do("GET", "/billing/is-trial-finished", ""), 200, `{"finished":false}`)
	expectValidation(t, e.do("POST", "/billing/sync", `{}`), "provider should not be null or undefined", "provider must be a string")
	expectValidation(t, e.do("POST", "/billing/subscribe", `{"period":"WEEKLY","billing":"PRO"}`), "period must be one of the following values: MONTHLY, YEARLY")
	expect(t, e.do("GET", "/billing/charges", ""), 400, `{"statusCode":400,"message":"Unauthorized"}`)
	expect(t, e.do("GET", "/billing/portal", ""), 400, `{"statusCode":400,"message":"This action is not supported on web"}`)
	expect(t, e.do("POST", "/billing/add-subscription", `{"subscription":"PRO"}`), 500, `{"statusCode":500,"message":"Internal server error"}`)

	rec := e.do("GET", "/billing/check-discount", "")
	var discount map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &discount); err != nil || discount["offerCoupon"] == "" {
		t.Fatalf("check-discount %s", rec.Body.String())
	}

	e.makeSuperAdmin("pay@example.com")
	expect(t, e.do("GET", "/billing/charges", ""), 200, `[]`)
	expectValidation(t, e.do("POST", "/billing/apply-coupon", `{"type":"percentage","value":10,"months":1.5}`), "months must be an integer number")
}

func TestPaymentWebhooks(t *testing.T) {
	e := newEnv(t)
	body := `{"id":"evt_1",  "x":1}`
	expect(t, e.do("POST", "/payment/stripe", body, func(r *http.Request) { r.Header.Set("Stripe-Signature", "t=1") }), 201,
		`{"raw":"{\"id\":\"evt_1\",  \"x\":1}","sig":"t=1"}`)
	expect(t, e.do("POST", "/stripe", body), 201, `{"raw":"{\"id\":\"evt_1\",  \"x\":1}","sig":""}`)
	expect(t, e.do("POST", "/payment/broken", body), 500, `{}`)
	expect(t, e.do("POST", "/payment/nope", body), 400, `{"statusCode":400,"message":"Payment provider nope not found"}`)
}

func TestNotificationsAnalyticsAdminAnnouncements(t *testing.T) {
	e := newEnv(t)
	expect(t, e.do("GET", "/notifications/", ""), 401, "")
	e.login("n@example.com")

	expect(t, e.do("GET", "/notifications/", ""), 200, `{"total":0}`)
	if rec := e.do("GET", "/notifications/list", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"notifications":[]`) {
		t.Fatalf("list %s", rec.Body.String())
	}
	if rec := e.do("GET", "/analytics/post/p1?date=7", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"date":7`) {
		t.Fatalf("post analytics %s", rec.Body.String())
	}

	expect(t, e.do("GET", "/admin/errors", ""), 400, `{"statusCode":400,"message":"Unauthorized"}`)
	expectValidation(t, e.do("POST", "/announcements/", `{"title":"t"}`), "description should not be empty")
	expect(t, e.do("POST", "/announcements/", `{"title":"t","description":"d"}`), 400, `{"statusCode":400,"message":"Unauthorized"}`)

	e.makeSuperAdmin("n@example.com")
	if rec := e.do("GET", "/admin/errors?page=abc&limit=5", ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"limit":5`) {
		t.Fatalf("errors %s", rec.Body.String())
	}
	if rec := e.do("GET", "/admin/stats?from=2024-01-01&to=2024-01-31", ""); rec.Code != 200 {
		t.Fatalf("stats %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.do("POST", "/announcements/", `{"title":"t","description":"d"}`); rec.Code != 201 || !strings.Contains(rec.Body.String(), `"title":"t"`) {
		t.Fatalf("announcement %d %s", rec.Code, rec.Body.String())
	}
}

func TestEnterpriseController(t *testing.T) {
	e := newEnv(t)
	expect(t, e.do("POST", "/enterprise/create-user", `{"params":"bad"}`), 201, `{"success":false}`)

	login, _ := helpers.SignJWT(map[string]any{"id": "u1", "saasName": "s", "providerName": "LOCAL"})
	expect(t, e.do("POST", "/enterprise/create-user", `{"params":"`+login+`"}`), 201, `{"success":false}`)

	token, _ := helpers.SignJWT(map[string]any{"id": "ent-1", "name": "Ent", "saasName": "SaaS", "email": "ent@example.com"})
	rec := e.do("POST", "/enterprise/create-user", `{"params":"`+token+`"}`)
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), `"apiKey":"`) {
		t.Fatalf("create-user %d %s", rec.Code, rec.Body.String())
	}

	url, _ := helpers.SignJWT(map[string]any{"redirectUrl": "https://x", "apiKey": "missing", "provider": "x"})
	expect(t, e.do("POST", "/enterprise/url", `{"params":"`+url+`"}`), 201, "")
	del, _ := helpers.SignJWT(map[string]any{"apiKey": "missing", "id": "i"})
	expect(t, e.do("POST", "/enterprise/delete-channel", `{"params":"`+del+`"}`), 201, `{"success":false}`)
}
