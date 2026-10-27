package payment

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v84"
	"github.com/stripe/stripe-go/v84/webhook"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
)

// --- fakes -----------------------------------------------------------------

type call struct {
	method string
	args   []any
}

type fakeSubs struct {
	mu      sync.Mutex
	calls   []call
	current *ent.Subscription
}

func (f *fakeSubs) record(method string, args ...any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, call{method, args})
}

func (f *fakeSubs) GetSubscriptionByOrganizationID(context.Context, string) (*ent.Subscription, error) {
	return f.current, nil
}
func (f *fakeSubs) GetSubscription(context.Context, string) (*ent.Subscription, error) {
	return f.current, nil
}
func (f *fakeSubs) GetCode(context.Context, string) (*ent.UsedCodes, error) { return nil, nil }
func (f *fakeSubs) CheckSubscription(context.Context, string, string) (*ent.Subscription, error) {
	return nil, nil
}
func (f *fakeSubs) CreateOrUpdateSubscription(_ context.Context, provider string, isTrailing bool, identifier, customerID string, totalChannels int, billing, period string, cancelAt *int64, code, org string) (any, error) {
	f.record("CreateOrUpdateSubscription", provider, isTrailing, identifier, customerID, totalChannels, billing, period, cancelAt, code, org)
	return map[string]any{}, nil
}
func (f *fakeSubs) CreateOrUpdateSubscriptionByOrg(_ context.Context, isTrailing bool, organizationID, provider, identifier string, totalChannels int, billing, period string, cancelAt *int64) (any, error) {
	f.record("CreateOrUpdateSubscriptionByOrg", isTrailing, organizationID, provider, identifier, totalChannels, billing, period, cancelAt)
	return map[string]any{}, nil
}
func (f *fakeSubs) DeleteSubscription(_ context.Context, customerID, provider string) error {
	f.record("DeleteSubscription", customerID, provider)
	return nil
}
func (f *fakeSubs) DeleteSubscriptionByOrgID(_ context.Context, organizationID, provider string) error {
	f.record("DeleteSubscriptionByOrgID", organizationID, provider)
	return nil
}
func (f *fakeSubs) UpdateCustomerID(_ context.Context, organizationID, customerID string) error {
	f.record("UpdateCustomerID", organizationID, customerID)
	return nil
}
func (f *fakeSubs) UpdateCancelAt(_ context.Context, organizationID string, cancelAt *int64) error {
	f.record("UpdateCancelAt", organizationID, cancelAt)
	return nil
}

type fakeOrgs struct{ org *ent.Organization }

func (f *fakeOrgs) GetOrgByID(context.Context, string) (*ent.Organization, error) { return f.org, nil }
func (f *fakeOrgs) GetOrgByCustomerID(context.Context, string) (*ent.Organization, error) {
	return f.org, nil
}
func (f *fakeOrgs) GetOrgsByUserID(context.Context, string) ([]*ent.Organization, error) {
	return nil, nil
}
func (f *fakeOrgs) GetTeam(context.Context, string) (*ent.Organization, error) { return f.org, nil }

type fakeUsers struct{ user *ent.User }

func (f *fakeUsers) GetUserByID(context.Context, string) (*ent.User, error) { return f.user, nil }

type fakeTrack struct{}

func (fakeTrack) Track(context.Context, string, string, string, int, map[string]any, string, *ent.User) {
}

// stripeServer records every request and answers from routes ("METHOD /path").
type stripeServer struct {
	mu       sync.Mutex
	requests []string
	forms    map[string]url.Values
}

func newStripe(t *testing.T, routes map[string]string) *stripeServer {
	t.Helper()
	s := &stripeServer{forms: map[string]url.Values{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// stripe-node 20.4.0's pinned version (stripe-go v84.4.x pins the same)
		if v := r.Header.Get("Stripe-Version"); v != "2026-02-25.clover" {
			t.Errorf("Stripe-Version = %q", v)
		}
		key := r.Method + " " + r.URL.Path
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		if r.Method == http.MethodGet {
			form = r.URL.Query()
		}
		s.mu.Lock()
		s.requests = append(s.requests, key)
		s.forms[key] = form
		s.mu.Unlock()
		resp, ok := routes[key]
		if !ok {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":{"message":"no route ` + key + `"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(resp))
	}))
	t.Cleanup(srv.Close)
	stripeBackends = stripe.NewBackendsWithConfig(&stripe.BackendConfig{
		URL:           stripe.String(srv.URL),
		LeveledLogger: &stripe.LeveledLogger{Level: stripe.LevelNull},
	})
	t.Cleanup(func() { stripeBackends = nil })
	return s
}

func (s *stripeServer) called(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.requests {
		if r == key {
			return true
		}
	}
	return false
}

func list(items ...string) string {
	return `{"object":"list","has_more":false,"data":[` + strings.Join(items, ",") + `]}`
}

func strPtr(s string) *string { return &s }

// exactForm fails unless got holds exactly want's keys, each with one value.
func exactForm(t *testing.T, name string, got url.Values, want map[string]string) {
	t.Helper()
	for k, v := range want {
		if g := got[k]; len(g) != 1 || g[0] != v {
			t.Errorf("%s: %s = %q, want %q", name, k, g, v)
		}
	}
	for k, v := range got {
		if _, ok := want[k]; !ok {
			t.Errorf("%s: unexpected %s = %q", name, k, v)
		}
	}
}

// --- stripe webhook --------------------------------------------------------

func signedEvent(t *testing.T, secret string, event map[string]any) ([]byte, http.Header) {
	t.Helper()
	payload, _ := json.Marshal(event)
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: secret, Timestamp: time.Now()})
	h := http.Header{}
	h.Set("stripe-signature", signed.Header)
	return payload, h
}

func subscriptionEvent(typ string, object map[string]any) map[string]any {
	return map[string]any{
		"id": "evt_1", "object": "event", "type": typ, "api_version": "2020-01-01",
		"data": map[string]any{"object": object},
	}
}

func TestStripeWebhookSignature(t *testing.T) {
	t.Setenv("STRIPE_SIGNING_KEY", "whsec_test")
	subs := &fakeSubs{}
	s := NewStripeService(subs, &fakeOrgs{}, &fakeUsers{}, fakeTrack{})
	m := NewProviderManager()
	m.Register(StripeProviderName, s)
	svc := NewService(m, subs)

	payload, headers := signedEvent(t, "whsec_test", subscriptionEvent("customer.subscription.updated", map[string]any{
		"id": "sub_1", "object": "subscription", "status": "active", "customer": "cus_1", "cancel_at": 1700000000,
		"metadata": map[string]any{"service": "gitroom", "billing": "PRO", "period": "MONTHLY", "uniqueId": "u1"},
	}))

	// wrong secret
	if _, err := svc.Webhook(context.Background(), "stripe", payload, func() http.Header {
		_, h := signedEvent(t, "whsec_other", map[string]any{})
		return h
	}()); err == nil {
		t.Fatal("expected signature error")
	}
	// tampered body
	if _, err := svc.Webhook(context.Background(), "stripe", append(payload, ' '), headers); err == nil {
		t.Fatal("expected signature error for tampered body")
	}
	if len(subs.calls) != 0 {
		t.Fatal("billing touched on invalid signature")
	}

	// valid: org without trial -> card check skipped -> subscription updated
	res, err := svc.Webhook(context.Background(), "stripe", payload, headers)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := res.(map[string]any); !ok {
		t.Fatalf("unexpected result %#v", res)
	}
	if len(subs.calls) != 1 || subs.calls[0].method != "CreateOrUpdateSubscription" {
		t.Fatalf("calls = %#v", subs.calls)
	}
	got := fmt.Sprint(subs.calls[0].args[:7]...)
	if want := fmt.Sprint("stripe", false, "u1", "cus_1", 30, "PRO", "MONTHLY"); got != want {
		t.Fatalf("args = %s, want %s", got, want)
	}
	if c := subs.calls[0].args[7].(*int64); c == nil || *c != 1700000000 {
		t.Fatalf("cancelAt = %v", c)
	}
}

func TestStripeProcessWebhookDispatch(t *testing.T) {
	ctx := context.Background()
	ev := func(typ string, object map[string]any) stripe.Event {
		raw, _ := json.Marshal(subscriptionEvent(typ, object))
		var e stripe.Event
		if err := json.Unmarshal(raw, &e); err != nil {
			t.Fatal(err)
		}
		return e
	}

	t.Run("foreign events are acknowledged and ignored", func(t *testing.T) {
		subs := &fakeSubs{}
		s := NewStripeService(subs, &fakeOrgs{}, &fakeUsers{}, fakeTrack{})
		res, err := s.ProcessWebhook(ctx, ev("customer.subscription.updated", map[string]any{"id": "sub_1", "metadata": map[string]any{"service": "other"}}))
		if err != nil || res.(map[string]any)["ok"] != true || len(subs.calls) != 0 {
			t.Fatalf("res=%v err=%v calls=%v", res, err, subs.calls)
		}
	})

	t.Run("deleted without survivors removes the subscription", func(t *testing.T) {
		subs := &fakeSubs{}
		s := NewStripeService(subs, &fakeOrgs{}, &fakeUsers{}, fakeTrack{})
		// non cus_ customer: no live subscription lookup
		if _, err := s.ProcessWebhook(ctx, ev("customer.subscription.deleted", map[string]any{
			"id": "sub_1", "customer": "user_1", "metadata": map[string]any{"service": "gitroom"},
		})); err != nil {
			t.Fatal(err)
		}
		if len(subs.calls) != 1 || subs.calls[0].method != "DeleteSubscription" || subs.calls[0].args[0] != "user_1" {
			t.Fatalf("calls = %#v", subs.calls)
		}
	})

	t.Run("duplicate created subscription is cancelled", func(t *testing.T) {
		srv := newStripe(t, map[string]string{
			"GET /v1/subscriptions": list(
				`{"id":"sub_old","object":"subscription","status":"active","created":10}`,
				`{"id":"sub_new","object":"subscription","status":"active","created":20}`,
			),
			"DELETE /v1/subscriptions/sub_new": `{"id":"sub_new","object":"subscription","status":"canceled"}`,
		})
		subs := &fakeSubs{}
		s := NewStripeService(subs, &fakeOrgs{}, &fakeUsers{}, fakeTrack{})
		res, err := s.ProcessWebhook(ctx, ev("customer.subscription.created", map[string]any{
			"id": "sub_new", "customer": "cus_1", "created": 20, "status": "active",
			"metadata": map[string]any{"service": "gitroom", "billing": "PRO", "period": "MONTHLY"},
		}))
		if err != nil || res.(map[string]any)["ok"] != true {
			t.Fatalf("res=%v err=%v", res, err)
		}
		if !srv.called("DELETE /v1/subscriptions/sub_new") || len(subs.calls) != 0 {
			t.Fatalf("requests=%v calls=%v", srv.requests, subs.calls)
		}
		if f := srv.forms["GET /v1/subscriptions"]; f.Get("status") != "all" || f.Get("customer") != "cus_1" || f.Get("expand[0]") != "data.latest_invoice" {
			t.Fatalf("list params = %v", f)
		}
	})

	t.Run("failed card check returns ok false without billing", func(t *testing.T) {
		srv := newStripe(t, map[string]string{
			"GET /v1/subscriptions":                list(`{"id":"sub_1","object":"subscription","status":"trialing","created":20}`),
			"GET /v1/payment_methods":              list(`{"id":"pm_1","object":"payment_method","created":5}`),
			"POST /v1/payment_intents":             `{"id":"pi_1","object":"payment_intent","status":"requires_payment_method"}`,
			"POST /v1/payment_methods/pm_1/detach": `{"id":"pm_1","object":"payment_method"}`,
			"DELETE /v1/subscriptions/sub_1":       `{"id":"sub_1","object":"subscription","status":"canceled"}`,
		})
		subs := &fakeSubs{}
		s := NewStripeService(subs, &fakeOrgs{org: &ent.Organization{AllowTrial: true}}, &fakeUsers{}, fakeTrack{})
		res, err := s.ProcessWebhook(ctx, ev("customer.subscription.created", map[string]any{
			"id": "sub_1", "customer": "cus_1", "created": 20, "status": "trialing",
			"metadata": map[string]any{"service": "gitroom", "billing": "PRO", "period": "MONTHLY"},
		}))
		if err != nil || res.(map[string]any)["ok"] != false || len(subs.calls) != 0 {
			t.Fatalf("res=%v err=%v calls=%v", res, err, subs.calls)
		}
		if f := srv.forms["POST /v1/payment_intents"]; f.Get("amount") != "100" || f.Get("capture_method") != "manual" || f.Get("confirm") != "true" || f.Get("off_session") != "true" || f.Get("payment_method") != "pm_1" {
			t.Fatalf("payment intent params = %v", f)
		}
		if !srv.called("POST /v1/payment_methods/pm_1/detach") || !srv.called("DELETE /v1/subscriptions/sub_1") {
			t.Fatalf("requests = %v", srv.requests)
		}
	})
}

// --- checkout --------------------------------------------------------------

// priceRoutes answers findOrCreatePrice with an existing PRO monthly price.
func priceRoutes(routes map[string]string) map[string]string {
	routes["GET /v1/products"] = list(`{"id":"prod_1","object":"product","name":"Pro"}`)
	routes["GET /v1/prices"] = list(`{"id":"price_1","object":"price","nickname":"PRO MONTHLY","unit_amount":4900,"recurring":{"interval":"month"}}`)
	return routes
}

func TestStripeSubscribeCheckoutParams(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.test")
	srv := newStripe(t, priceRoutes(map[string]string{
		"POST /v1/customers/cus_1":   `{"id":"cus_1","object":"customer"}`,
		"POST /v1/checkout/sessions": `{"id":"cs_1","object":"checkout.session","url":"https://checkout.test/cs_1"}`,
	}))
	org := &ent.Organization{ID: "org_1", PaymentID: strPtr("cus_1")}
	s := NewStripeService(&fakeSubs{}, &fakeOrgs{org: org}, &fakeUsers{}, fakeTrack{})

	res, err := s.Subscribe(context.Background(), "track_1", "org_1", "user_1", BillingSubscribeDTO{
		Period: "MONTHLY", Billing: "PRO", Utm: strPtr("news"), Dub: strPtr("dub_1"),
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if res.(map[string]any)["url"] != "https://checkout.test/cs_1" {
		t.Fatalf("res = %v", res)
	}

	exactForm(t, "products", srv.forms["GET /v1/products"], map[string]string{"active": "true", "expand[0]": "data.prices"})
	exactForm(t, "prices", srv.forms["GET /v1/prices"], map[string]string{"active": "true", "product": "prod_1"})
	exactForm(t, "customer", srv.forms["POST /v1/customers/cus_1"], map[string]string{
		"metadata[dubCustomerExternalId]": "user_1",
		"metadata[dubClickId]":            "dub_1",
	})
	f := srv.forms["POST /v1/checkout/sessions"]
	id := f.Get("subscription_data[metadata][uniqueId]")
	if len(id) != 10 {
		t.Fatalf("uniqueId = %q", id)
	}
	exactForm(t, "hosted checkout", f, map[string]string{
		"customer":                              "cus_1",
		"cancel_url":                            "https://app.test/billing?cancel=true&utm_source=news",
		"success_url":                           "https://app.test/launches?onboarding=true&trialStart=true&check=" + id + "&utm_source=news",
		"mode":                                  "subscription",
		"subscription_data[trial_period_days]":  "7",
		"subscription_data[metadata][service]":  "gitroom",
		"subscription_data[metadata][period]":   "MONTHLY",
		"subscription_data[metadata][billing]":  "PRO",
		"subscription_data[metadata][utm]":      "news",
		"subscription_data[metadata][dub]":      "dub_1",
		"subscription_data[metadata][userId]":   "user_1",
		"subscription_data[metadata][uniqueId]": id,
		"subscription_data[metadata][ud]":       "track_1",
		"allow_promotion_codes":                 "true",
		"line_items[0][price]":                  "price_1",
		"line_items[0][quantity]":               "1",
	})
	if srv.called("POST /v1/prices") || srv.called("POST /v1/products") {
		t.Errorf("existing product/price must be reused: %v", srv.requests)
	}
}

func TestStripeEmbeddedCheckoutParams(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.test")
	srv := newStripe(t, priceRoutes(map[string]string{
		"GET /v1/subscriptions":    list(),
		"POST /v1/customers/cus_1": `{"id":"cus_1","object":"customer"}`,
		"GET /v1/promotion_codes": list(`{"id":"promo_1","object":"promotion_code","code":"SAVE10","active":true,
			"metadata":{"autoapply":"true"},"promotion":{"type":"coupon","coupon":"co_1"}}`),
		"POST /v1/checkout/sessions": `{"id":"cs_1","object":"checkout.session","client_secret":"cs_secret"}`,
	}))
	org := &ent.Organization{ID: "org_1", PaymentID: strPtr("cus_1")}
	s := NewStripeService(&fakeSubs{}, &fakeOrgs{org: org}, &fakeUsers{user: &ent.User{Email: "jane"}}, fakeTrack{})

	res, err := s.Embedded(context.Background(), "track_1", "org_1", "user_1", BillingSubscribeDTO{
		Period: "MONTHLY", Billing: "PRO", Dub: strPtr("dub_1"),
		DatafastSessionID: strPtr("ds_1"), DatafastVisitorID: strPtr("dv_1"),
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(res); string(b) != `{"client_secret":"cs_secret","auto_apply_coupon":"SAVE10"}` {
		t.Fatalf("res = %s", b)
	}

	exactForm(t, "live subscriptions", srv.forms["GET /v1/subscriptions"], map[string]string{
		"customer": "cus_1", "status": "all", "expand[0]": "data.latest_invoice",
	})
	exactForm(t, "customer", srv.forms["POST /v1/customers/cus_1"], map[string]string{
		"email":                           "jane@shots.playbookmedia.io",
		"metadata[dubCustomerExternalId]": "user_1",
		"metadata[dubClickId]":            "dub_1",
	})
	exactForm(t, "promotion codes", srv.forms["GET /v1/promotion_codes"], map[string]string{"active": "true", "limit": "100"})
	f := srv.forms["POST /v1/checkout/sessions"]
	id := f.Get("subscription_data[metadata][uniqueId]")
	if len(id) != 10 {
		t.Fatalf("uniqueId = %q", id)
	}
	exactForm(t, "embedded checkout", f, map[string]string{
		"ui_mode":                              "custom",
		"customer":                             "cus_1",
		"return_url":                           "https://app.test/launches?onboarding=true&trialStart=true&check=" + id,
		"mode":                                 "subscription",
		"subscription_data[metadata][service]": "gitroom",
		"subscription_data[metadata][period]":  "MONTHLY",
		"subscription_data[metadata][billing]": "PRO",
		"subscription_data[metadata][dub]":     "dub_1",
		"subscription_data[metadata][datafast_session_id]": "ds_1",
		"subscription_data[metadata][datafast_visitor_id]": "dv_1",
		"subscription_data[metadata][userId]":              "user_1",
		"subscription_data[metadata][uniqueId]":            id,
		"subscription_data[metadata][ud]":                  "track_1",
		"metadata[datafast_visitor_id]":                    "dv_1",
		"metadata[datafast_session_id]":                    "ds_1",
		"allow_promotion_codes":                            "true",
		"line_items[0][price]":                             "price_1",
		"line_items[0][quantity]":                          "1",
	})
}

func TestStripeProrateParams(t *testing.T) {
	srv := newStripe(t, priceRoutes(map[string]string{
		"GET /v1/subscriptions": list(`{"id":"sub_1","object":"subscription","status":"active",
			"items":{"object":"list","data":[{"id":"si_1","object":"subscription_item"}]}}`),
		"POST /v1/invoices/create_preview": `{"id":"in_1","object":"invoice","amount_due":1234}`,
	}))
	org := &ent.Organization{ID: "org_1", PaymentID: strPtr("cus_1")}
	s := NewStripeService(&fakeSubs{}, &fakeOrgs{org: org}, &fakeUsers{}, fakeTrack{})

	res, err := s.Prorate(context.Background(), "org_1", BillingSubscribeDTO{Period: "MONTHLY", Billing: "PRO"})
	if err != nil {
		t.Fatal(err)
	}
	if res != (ProrateResult{Price: 12.34}) {
		t.Fatalf("res = %v", res)
	}
	exactForm(t, "subscriptions", srv.forms["GET /v1/subscriptions"], map[string]string{"customer": "cus_1", "status": "all"})
	exactForm(t, "create_preview", srv.forms["POST /v1/invoices/create_preview"], map[string]string{
		"customer":     "cus_1",
		"subscription": "sub_1",
		"subscription_details[proration_behavior]": "always_invoice",
		"subscription_details[items][0][id]":       "si_1",
		"subscription_details[items][0][price]":    "price_1",
		"subscription_details[items][0][quantity]": "1",
	})
}

func TestStripeSetToCancelParams(t *testing.T) {
	for _, tc := range []struct {
		name              string
		cancelAtPeriodEnd bool
	}{
		{"cancel at period end", false},
		{"toggle back", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newStripe(t, map[string]string{
				"GET /v1/subscriptions": list(fmt.Sprintf(`{"id":"sub_1","object":"subscription","status":"active",
					"cancel_at_period_end":%t,"latest_invoice":{"id":"in_1","object":"invoice","status":"paid"}}`, tc.cancelAtPeriodEnd)),
				"POST /v1/subscriptions/sub_1": `{"id":"sub_1","object":"subscription","cancel_at":1700000000}`,
			})
			subs := &fakeSubs{}
			org := &ent.Organization{ID: "org_1", PaymentID: strPtr("cus_1")}
			s := NewStripeService(subs, &fakeOrgs{org: org}, &fakeUsers{}, fakeTrack{})

			res, err := s.SetToCancel(context.Background(), "org_1")
			if err != nil {
				t.Fatal(err)
			}
			if len(res.ID) != 10 || res.CancelAt == nil {
				t.Fatalf("res = %+v", res)
			}
			exactForm(t, "update", srv.forms["POST /v1/subscriptions/sub_1"], map[string]string{
				"cancel_at_period_end": fmt.Sprint(!tc.cancelAtPeriodEnd),
				"metadata[service]":    "gitroom",
				"metadata[id]":         res.ID,
			})
			if len(subs.calls) != 1 || subs.calls[0].method != "UpdateCancelAt" || *subs.calls[0].args[1].(*int64) != 1700000000 {
				t.Fatalf("calls = %#v", subs.calls)
			}
		})
	}
}

func TestStripeApplyDiscountGated(t *testing.T) {
	routes := func(chargeAmount int) map[string]string {
		return map[string]string{
			"GET /v1/charges": list(fmt.Sprintf(`{"id":"ch_1","object":"charge","amount":%d}`, chargeAmount)),
			"GET /v1/subscriptions": list(`{"id":"sub_1","object":"subscription","status":"active","discounts":[],
				"items":{"object":"list","data":[{"id":"si_1","object":"subscription_item","price":{"id":"price_1","object":"price","recurring":{"interval":"month"}}}]}}`),
			"POST /v1/subscriptions/sub_1": `{"id":"sub_1","object":"subscription"}`,
		}
	}
	org := &ent.Organization{ID: "org_1", PaymentID: strPtr("cus_1")}
	t.Setenv("STRIPE_DISCOUNT_ID", "coupon_1")

	t.Run("eligible", func(t *testing.T) {
		srv := newStripe(t, routes(2000))
		res, err := NewStripeService(&fakeSubs{}, &fakeOrgs{}, &fakeUsers{}, fakeTrack{}).ApplyDiscount(context.Background(), org)
		if err != nil || res != true {
			t.Fatalf("res=%v err=%v", res, err)
		}
		exactForm(t, "charges", srv.forms["GET /v1/charges"], map[string]string{"customer": "cus_1", "limit": "1"})
		exactForm(t, "update", srv.forms["POST /v1/subscriptions/sub_1"], map[string]string{"discounts[0][coupon]": "coupon_1"})
	})

	t.Run("not eligible", func(t *testing.T) {
		srv := newStripe(t, routes(500))
		res, err := NewStripeService(&fakeSubs{}, &fakeOrgs{}, &fakeUsers{}, fakeTrack{}).ApplyDiscount(context.Background(), org)
		if err != nil || res != false {
			t.Fatalf("res=%v err=%v", res, err)
		}
		if srv.called("POST /v1/subscriptions/sub_1") {
			t.Fatalf("discount applied without passing checkDiscount: %v", srv.requests)
		}
	})
}

// --- webhook signature (stripe-node constructEvent) ------------------------

func TestVerifyStripeSignature(t *testing.T) {
	const secret = "whsec_fixture"
	payload := []byte(`{"id":"evt_1","object":"event","api_version":"2019-02-19","type":"invoice.payment_succeeded","data":{"object":{"object":"invoice"}}}`)
	now := time.Unix(1760000000, 0)
	// signed like Stripe does: t=<unix>,v1=<hex HMAC-SHA256("<t>.<body>")>,v0=<test-mode legacy>
	sign := func(ts int64, body []byte, key string) string {
		return hex.EncodeToString(webhook.ComputeSignature(time.Unix(ts, 0), body, key))
	}
	header := func(ts int64) string {
		return fmt.Sprintf("t=%d,v1=%s,v0=%s", ts, sign(ts, payload, secret), sign(ts, payload, "whsec_legacy"))
	}
	ts := now.Unix() - 10

	for _, tc := range []struct {
		name, header string
		payload      []byte
		secret, err  string
	}{
		{name: "valid, any api_version", header: header(ts)},
		{name: "300s old is inside the tolerance", header: header(now.Unix() - 300)},
		{name: "301s old", header: header(now.Unix() - 301), err: "Timestamp outside the tolerance zone"},
		{name: "future timestamps pass", header: header(now.Unix() + 3600)},
		{name: "malformed extra pairs are ignored", header: "junk," + header(ts) + ",a=b=c"},
		{name: "second v1 matches", header: fmt.Sprintf("t=%d,v1=%s,v1=%s", ts, sign(ts, payload, "whsec_old"), sign(ts, payload, secret))},
		{name: "wrong secret", header: header(ts), secret: "whsec_other", err: "No signatures found matching the expected signature for payload."},
		{name: "secret with whitespace", header: header(ts), secret: secret + "\n", err: "contains whitespace"},
		{name: "tampered body", header: header(ts), payload: append(append([]byte{}, payload...), ' '), err: "No signatures found matching"},
		{name: "header keys are case sensitive", header: strings.ToUpper(header(ts)), err: "Unable to extract timestamp"},
		{name: "uppercase signature", header: fmt.Sprintf("t=%d,v1=%s", ts, strings.ToUpper(sign(ts, payload, secret))), err: "No signatures found matching"},
		{name: "no header", header: "", err: "No stripe-signature header value was provided."},
		{name: "no timestamp", header: "v1=" + sign(ts, payload, secret), err: "Unable to extract timestamp and signatures from header"},
		{name: "no v1", header: fmt.Sprintf("t=%d,v0=%s", ts, sign(ts, payload, secret)), err: "No signatures found with expected scheme"},
		{name: "no payload", header: header(ts), payload: []byte{}, err: "No webhook payload was provided."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, key := payload, secret
			if tc.payload != nil {
				body = tc.payload
			}
			if tc.secret != "" {
				key = tc.secret
			}
			err := verifyStripeSignature(body, tc.header, key, now)
			if tc.err == "" && err != nil || tc.err != "" && (err == nil || !strings.Contains(err.Error(), tc.err)) {
				t.Fatalf("err = %v, want %q", err, tc.err)
			}
		})
	}
}

func TestStripeValidateWebhookSecret(t *testing.T) {
	s := NewStripeService(&fakeSubs{}, &fakeOrgs{}, &fakeUsers{}, fakeTrack{})
	payload, headers := signedEvent(t, "", map[string]any{"id": "evt_1", "object": "event", "type": "ping"})

	// unset: stripe-node throws on the undefined key, so an empty-key forgery fails
	t.Setenv("STRIPE_SIGNING_KEY", "")
	_ = os.Unsetenv("STRIPE_SIGNING_KEY")
	if _, err := s.ValidateWebhook(context.Background(), payload, headers); err == nil {
		t.Fatal("unset STRIPE_SIGNING_KEY must reject")
	}

	// set but empty: Node signs with the empty key
	t.Setenv("STRIPE_SIGNING_KEY", "")
	event, err := s.ValidateWebhook(context.Background(), payload, headers)
	if err != nil || event.(stripe.Event).ID != "evt_1" {
		t.Fatalf("event=%v err=%v", event, err)
	}
}

// --- revenuecat ------------------------------------------------------------

func TestRevenueCatWebhookOrganizations(t *testing.T) {
	got := webhookOrganizations(map[string]any{
		"app_user_id":          "org_1",
		"original_app_user_id": "$RCAnonymousID:abc",
		"transferred_from":     []any{"org_2", "org_1"},
		"transferred_to":       []any{"org_3", nil},
	})
	if strings.Join(got, ",") != "org_1,org_2,org_3" {
		t.Fatalf("got %v", got)
	}
}

func TestRevenueCatValidateWebhook(t *testing.T) {
	r := NewRevenueCatProvider(&fakeSubs{}, &fakeOrgs{})
	h := http.Header{}
	h.Set("Authorization", "secret")
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "")
	if _, err := r.ValidateWebhook(context.Background(), []byte(`{}`), h); err == nil {
		t.Fatal("unset secret must reject")
	}
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")
	if _, err := r.ValidateWebhook(context.Background(), []byte(`{}`), http.Header{}); err == nil {
		t.Fatal("missing header must reject")
	}
	body, err := r.ValidateWebhook(context.Background(), []byte(`{"event":{"type":"TEST"}}`), h)
	if err != nil {
		t.Fatal(err)
	}
	res, err := r.ProcessWebhook(context.Background(), body)
	if err != nil || res.(map[string]any)["ok"] != true {
		t.Fatalf("res=%v err=%v", res, err)
	}
}

func TestRevenueCatSync(t *testing.T) {
	future := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	later := time.Now().Add(96 * time.Hour).UTC().Format(time.RFC3339)
	past := time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339)
	var auth, path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, path = r.Header.Get("Authorization"), r.URL.Path
		fmt.Fprintf(w, `{"subscriber":{"subscriptions":{
			"com.shots.mob.standard.monthly":{"expires_date":%q,"period_type":"normal"},
			"com.shots.mob.pro_yearly":{"expires_date":%q,"period_type":"trial","unsubscribe_detected_at":%q},
			"com.shots.mob.team.yearly":{"expires_date":%q,"is_sandbox":true},
			"com.shots.mob.ultimate.monthly":{"expires_date":%q}
		}}}`, future, later, past, later, past)
	}))
	defer srv.Close()
	revenueCatAPI = srv.URL
	defer func() { revenueCatAPI = "https://api.revenuecat.com" }()
	t.Setenv("REVENUECAT_SECRET_KEY", "rc_key")
	t.Setenv("IN_APP_PURCHASE_REJECT_SANDBOX", "1")

	subs := &fakeSubs{}
	r := NewRevenueCatProvider(subs, &fakeOrgs{org: &ent.Organization{ID: "org_1"}})
	res, err := r.ProcessWebhook(context.Background(), map[string]any{"event": map[string]any{"type": "RENEWAL", "app_user_id": "org_1"}})
	if err != nil || res.(map[string]any)["ok"] != true {
		t.Fatalf("res=%v err=%v", res, err)
	}
	if auth != "Bearer rc_key" || path != "/v1/subscribers/org_1" {
		t.Fatalf("auth=%q path=%q", auth, path)
	}
	if len(subs.calls) != 1 || subs.calls[0].method != "CreateOrUpdateSubscriptionByOrg" {
		t.Fatalf("calls = %#v", subs.calls)
	}
	a := subs.calls[0].args
	if fmt.Sprint(a[:7]...) != fmt.Sprint(true, "org_1", "revenuecat", "com.shots.mob.pro_yearly", 30, "PRO", "YEARLY") {
		t.Fatalf("args = %v", a)
	}
	laterT, _ := time.Parse(time.RFC3339, later)
	if c := a[7].(*int64); c == nil || *c != laterT.Unix() {
		t.Fatalf("cancelAt = %v", c)
	}
}

func TestRevenueCatSyncNoActiveDeletes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"subscriber":{"subscriptions":{}}}`))
	}))
	defer srv.Close()
	revenueCatAPI = srv.URL
	defer func() { revenueCatAPI = "https://api.revenuecat.com" }()
	t.Setenv("REVENUECAT_SECRET_KEY", "rc_key")

	subs := &fakeSubs{}
	r := NewRevenueCatProvider(subs, &fakeOrgs{org: &ent.Organization{ID: "org_1"}})
	res, err := r.SyncSubscription(context.Background(), "org_1")
	if err != nil || res.Active {
		t.Fatalf("res=%v err=%v", res, err)
	}
	if len(subs.calls) != 1 || subs.calls[0].method != "DeleteSubscriptionByOrgID" {
		t.Fatalf("calls = %#v", subs.calls)
	}
}

func TestParseProductID(t *testing.T) {
	for in, want := range map[string]string{
		"com.shots.mob.pro.yearly":   "PRO YEARLY",
		"com.shots.mob.team_monthly": "TEAM MONTHLY",
		"standard.MONTHLY":           "STANDARD MONTHLY",
		"com.shots.mob.gold.monthly": "",
		"com.shots.mob.pro.weekly":   "",
		"monthly":                    "",
	} {
		billing, period, err := parseProductID(in)
		got := billing + " " + period
		if err != nil {
			got = ""
		}
		if got != want {
			t.Errorf("%s: got %q want %q", in, got, want)
		}
	}
}

// --- payment service -------------------------------------------------------

type mobileProvider struct{ Unsupported }

func (mobileProvider) ValidateWebhook(context.Context, []byte, http.Header) (any, error) {
	return nil, nil
}
func (mobileProvider) ProcessWebhook(context.Context, any) (any, error) { return nil, nil }

func TestServiceProviderRouting(t *testing.T) {
	subs := &fakeSubs{current: &ent.Subscription{Provider: "revenuecat"}}
	m := NewProviderManager()
	m.Register(StripeProviderName, NewStripeService(subs, &fakeOrgs{}, &fakeUsers{}, fakeTrack{}))
	m.Register(RevenueCatProviderName, mobileProvider{Unsupported{P: PlatformMobile}})
	svc := NewService(m, subs)
	ctx := context.Background()

	if _, err := svc.GetProviderForOrganization(ctx, "org", PlatformWeb); err == nil ||
		!strings.Contains(fmt.Sprint(err), "Your subscription is managed on mobile, please use mobile to manage it") {
		t.Fatalf("err = %v", err)
	}
	if err := svc.AssertCanUseProvider(ctx, "org", "stripe"); err == nil {
		t.Fatal("expected cross-platform block")
	}
	if _, err := svc.Webhook(ctx, "paypal", nil, nil); err == nil || !strings.Contains(fmt.Sprint(err), "Payment provider paypal not found") {
		t.Fatalf("err = %v", err)
	}
	mobile := mobileProvider{Unsupported{P: PlatformMobile}}
	if _, err := mobile.PortalLink(ctx, "org"); err == nil ||
		!strings.Contains(fmt.Sprint(err), "This action is not supported on mobile") {
		t.Fatalf("err = %v", err)
	}

	raw, err := svc.GetSubscription(ctx, "org")
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil || got["platform"] != "mobile" || got["provider"] != "revenuecat" {
		t.Fatalf("got %s (%v)", raw, err)
	}

	name, _ := svc.GetDefaultProviderName(PlatformWeb)
	if name != "stripe" {
		t.Fatalf("default web = %s", name)
	}
}

func TestCancelResultJSON(t *testing.T) {
	ts := int64(1700000000)
	b, _ := json.Marshal(cancelAtResult("abc", &ts))
	if string(b) != `{"id":"abc","cancel_at":"2023-11-14T22:13:20.000Z"}` {
		t.Fatalf("got %s", b)
	}
	b, _ = json.Marshal(cancelAtResult("abc", nil))
	if string(b) != `{"id":"abc"}` {
		t.Fatalf("got %s", b)
	}
}
