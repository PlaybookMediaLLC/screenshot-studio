package payment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// revenueCatAPI is overridden in tests.
var revenueCatAPI = "https://api.revenuecat.com"

type revenueCatSubscription struct {
	ExpiresDate           *string `json:"expires_date"`
	UnsubscribeDetectedAt *string `json:"unsubscribe_detected_at"`
	IsSandbox             bool    `json:"is_sandbox"`
	PeriodType            string  `json:"period_type"`
}

type revenueCatEntry struct {
	productID    string
	subscription revenueCatSubscription
}

// RevenueCatProvider: RevenueCat is the source of truth for App Store /
// Google Play subscriptions. The webhook and the app only tell us *which*
// subscriber to re-check; we always load the subscriber from the API instead
// of trusting the event payload.
// app_user_id === Postiz organization id (the app calls Purchases.logIn(orgId)).
// Product ids end with <tier>.<period> or <tier>_<period>, e.g. com.postiz.mob.pro.yearly
type RevenueCatProvider struct {
	Unsupported
	subscriptions SubscriptionService
	organizations OrganizationService
	http          *http.Client
}

func NewRevenueCatProvider(subscriptions SubscriptionService, organizations OrganizationService) *RevenueCatProvider {
	return &RevenueCatProvider{
		Unsupported:   Unsupported{P: PlatformMobile},
		subscriptions: subscriptions,
		organizations: organizations,
		http:          http.DefaultClient,
	}
}

func (r *RevenueCatProvider) ValidateWebhook(_ context.Context, rawBody []byte, headers http.Header) (any, error) {
	secret := os.Getenv("REVENUECAT_WEBHOOK_SECRET")
	if secret == "" || headers.Get("Authorization") != secret {
		return nil, httpx.HTTPException("Invalid webhook authorization", 401)
	}

	var body any
	if err := json.Unmarshal(rawBody, &body); err != nil {
		return nil, err
	}
	return body, nil
}

func (r *RevenueCatProvider) ProcessWebhook(ctx context.Context, body any) (any, error) {
	ok := map[string]any{"ok": true}
	root, _ := body.(map[string]any)
	event, _ := root["event"].(map[string]any)
	if event == nil || event["type"] == "TEST" {
		return ok, nil
	}

	for _, organizationID := range webhookOrganizations(event) {
		if _, err := r.SyncSubscription(ctx, organizationID); err != nil {
			return nil, err
		}
	}
	return ok, nil
}

// webhookOrganizations is uniq([app_user_id, original_app_user_id,
// transferred_from, transferred_to].flat()) without anonymous ids.
func webhookOrganizations(event map[string]any) []string {
	var flat []any
	for _, key := range []string{"app_user_id", "original_app_user_id", "transferred_from", "transferred_to"} {
		if list, isList := event[key].([]any); isList {
			flat = append(flat, list...)
		} else {
			flat = append(flat, event[key])
		}
	}
	var out []string
	for _, v := range flat {
		p, _ := v.(string)
		if p == "" || strings.HasPrefix(p, "$RCAnonymousID:") || slices.Contains(out, p) {
			continue
		}
		out = append(out, p)
	}
	return out
}

// CancelAllSubscriptions: store subscriptions can only be cancelled by the
// user in the App Store / Google Play; account deletion must not be blocked by it.
func (r *RevenueCatProvider) CancelAllSubscriptions(context.Context, string) error { return nil }

func (r *RevenueCatProvider) SyncSubscription(ctx context.Context, organizationID string) (*SyncResult, error) {
	organization, err := r.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if organization == nil {
		return &SyncResult{Active: false}, nil
	}

	active, err := r.getActiveSubscription(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if active == nil {
		if err := r.subscriptions.DeleteSubscriptionByOrgID(ctx, organizationID, RevenueCatProviderName); err != nil {
			return nil, err
		}
		return &SyncResult{Active: false}, nil
	}

	billing, period, err := parseProductID(active.productID)
	if err != nil {
		return nil, err
	}

	var cancelAt *int64
	if s := active.subscription; s.UnsubscribeDetectedAt != nil && *s.UnsubscribeDetectedAt != "" && s.ExpiresDate != nil && *s.ExpiresDate != "" {
		if t, ok := parseDate(*s.ExpiresDate); ok {
			unix := t.Unix()
			cancelAt = &unix
		}
	}

	// Store trials (intro offers) keep the same trial restrictions as a Stripe trial
	if _, err := r.subscriptions.CreateOrUpdateSubscriptionByOrg(
		ctx,
		active.subscription.PeriodType == "trial",
		organizationID,
		RevenueCatProviderName,
		active.productID,
		pricing[billing].Channel,
		billing,
		period,
		cancelAt,
	); err != nil {
		return nil, err
	}

	return &SyncResult{Active: true}, nil
}

func (r *RevenueCatProvider) getActiveSubscription(ctx context.Context, organizationID string) (*revenueCatEntry, error) {
	key := os.Getenv("REVENUECAT_SECRET_KEY")
	if key == "" {
		return nil, httpx.HTTPException("RevenueCat is not configured", 400)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, revenueCatAPI+"/v1/subscribers/"+url.PathEscape(organizationID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, httpx.HTTPException(fmt.Sprintf("RevenueCat subscriber request failed (%d)", resp.StatusCode), 500)
	}

	var payload struct {
		Subscriber *struct {
			Subscriptions json.RawMessage `json:"subscriptions"`
		} `json:"subscriber"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	var entries []revenueCatEntry
	if payload.Subscriber != nil {
		if entries, err = orderedSubscriptions(payload.Subscriber.Subscriptions); err != nil {
			return nil, err
		}
	}

	rejectSandbox := os.Getenv("IN_APP_PURCHASE_REJECT_SANDBOX") != ""
	now := time.Now()

	var live []revenueCatEntry
	for _, e := range entries {
		if rejectSandbox && e.subscription.IsSandbox {
			continue
		}
		if e.subscription.ExpiresDate != nil && *e.subscription.ExpiresDate != "" {
			if t, ok := parseDate(*e.subscription.ExpiresDate); !ok || !t.After(now) {
				continue
			}
		}
		live = append(live, e)
	}

	far := time.Date(2999, 1, 1, 0, 0, 0, 0, time.UTC)
	expires := func(e revenueCatEntry) time.Time {
		if e.subscription.ExpiresDate == nil || *e.subscription.ExpiresDate == "" {
			return far
		}
		t, _ := parseDate(*e.subscription.ExpiresDate)
		return t
	}
	sort.SliceStable(live, func(i, j int) bool { return expires(live[i]).After(expires(live[j])) })

	if len(live) == 0 {
		return nil, nil
	}
	return &live[0], nil
}

// orderedSubscriptions decodes the subscriptions object keeping key order
// (Object.entries order), so ties in the sort resolve like the TS.
func orderedSubscriptions(raw json.RawMessage) ([]revenueCatEntry, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var out []revenueCatEntry
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		e := revenueCatEntry{productID: tok.(string)}
		if err := dec.Decode(&e.subscription); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

// parseDate parses the ISO dates RevenueCat sends (dayjs(string)).
func parseDate(s string) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339Nano, s)
	return t, err == nil
}

var productIDSplit = regexp.MustCompile(`[._]`)

func parseProductID(productID string) (billing, period string, err error) {
	parts := productIDSplit.Split(productID, -1)
	pop := func() string {
		if len(parts) == 0 {
			return ""
		}
		last := parts[len(parts)-1]
		parts = parts[:len(parts)-1]
		return last
	}
	period = strings.ToUpper(pop())
	billing = strings.ToUpper(pop())

	if !slices.Contains([]string{"MONTHLY", "YEARLY"}, period) ||
		!slices.Contains([]string{"STANDARD", "TEAM", "PRO", "ULTIMATE"}, billing) {
		return "", "", httpx.HTTPException("Unknown RevenueCat product identifier: "+productID, 400)
	}
	return billing, period, nil
}
