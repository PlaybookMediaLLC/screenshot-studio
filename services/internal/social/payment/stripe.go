package payment

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/stripe/stripe-go/v84"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
)

// stripeBackends overrides the Stripe API backend in tests (nil = api.stripe.com).
var stripeBackends *stripe.Backends

var errNoOrganization = errors.New("organization not found")

// StripeService is the web payment provider.
type StripeService struct {
	Unsupported
	sc            *stripe.Client
	subscriptions SubscriptionService
	organizations OrganizationService
	users         UsersService
	track         TrackService
}

func NewStripeService(subscriptions SubscriptionService, organizations OrganizationService, users UsersService, track TrackService) *StripeService {
	key := os.Getenv("STRIPE_SECRET_KEY")
	if key == "" {
		key = "sk_nothing"
	}
	return &StripeService{
		Unsupported:   Unsupported{P: PlatformWeb},
		sc:            stripe.NewClient(key, stripe.WithBackends(stripeBackends)),
		subscriptions: subscriptions,
		organizations: organizations,
		users:         users,
		track:         track,
	}
}

// firstPage is `(await stripe.x.list(params)).data`: one page, no auto-pagination.
func firstPage[P interface{ GetListParams() *stripe.ListParams }, T any](ctx context.Context, list func(context.Context, P) stripe.Seq2[T, error], params P) ([]T, error) {
	params.GetListParams().Single = true
	var out []T
	for item, err := range list(ctx, params) {
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

func customerOf(c *stripe.Customer) string {
	if c == nil {
		return ""
	}
	return c.ID
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func unixOrNull(v int64) *int64 {
	if v == 0 {
		return nil
	}
	return &v
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func emailOrPostiz(email string) string {
	if strings.Contains(email, "@") {
		return email
	}
	return email + "@postiz.com"
}

func isActiveOrTrialing(s *stripe.Subscription) bool {
	return s.Status == stripe.SubscriptionStatusActive || s.Status == stripe.SubscriptionStatusTrialing
}

// ValidateRequest is stripe-node 20.4.0's `stripe.webhooks.constructEvent`
// (default tolerance), ported instead of stripe-go's webhook package, which
// also rejects unknown API versions, non-"event" objects and malformed header
// pairs, and checks the age before the signature.
func (s *StripeService) ValidateRequest(rawBody []byte, signature, endpointSecret string) (stripe.Event, error) {
	var event stripe.Event
	if err := verifyStripeSignature(rawBody, signature, endpointSecret, time.Now()); err != nil {
		return event, err
	}
	err := json.Unmarshal(rawBody, &event)
	return event, err
}

// stripe-node Webhook.DEFAULT_TOLERANCE, in seconds.
const stripeWebhookTolerance = 300

// verifyStripeSignature is stripe-node's signature.verifyHeader.
func verifyStripeSignature(payload []byte, header, secret string, now time.Time) error {
	if len(payload) == 0 {
		return errors.New("No webhook payload was provided.")
	}
	if header == "" {
		return errors.New("No stripe-signature header value was provided.")
	}

	timestamp, hasTimestamp := int64(0), false
	var signatures []string
	for _, item := range strings.Split(header, ",") {
		kv := strings.Split(item, "=")
		value := ""
		if len(kv) > 1 {
			value = kv[1]
		}
		switch kv[0] {
		case "t":
			// parseInt: an unparsable t can't verify either way
			ts, err := strconv.ParseInt(value, 10, 64)
			timestamp, hasTimestamp = ts, err == nil
		case "v1":
			signatures = append(signatures, value)
		}
	}
	if !hasTimestamp {
		return errors.New("Unable to extract timestamp and signatures from header")
	}
	if len(signatures) == 0 {
		return errors.New("No signatures found with expected scheme")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.%s", timestamp, payload)
	expectedSignature := hex.EncodeToString(mac.Sum(nil))
	signatureFound := false
	for _, sig := range signatures {
		if hmac.Equal([]byte(expectedSignature), []byte(sig)) {
			signatureFound = true
		}
	}
	if !signatureFound {
		whitespaceMessage := ""
		if strings.IndexFunc(secret, unicode.IsSpace) >= 0 {
			whitespaceMessage = "\n\nNote: The provided signing secret contains whitespace. This often indicates an extra newline or space is in the value"
		}
		return errors.New("No signatures found matching the expected signature for payload." +
			" Are you passing the raw request body you received from Stripe? \n" +
			" If a webhook request is being forwarded by a third-party tool," +
			" ensure that the exact request body, including JSON formatting and new line style, is preserved.\n" +
			"\nLearn more about webhook signing and explore webhook integration examples for various frameworks at https://docs.stripe.com/webhooks/signature" +
			"\n" + whitespaceMessage)
	}

	// only old timestamps are rejected, future ones pass
	if now.Unix()-timestamp > stripeWebhookTolerance {
		return errors.New("Timestamp outside the tolerance zone")
	}
	return nil
}

func (s *StripeService) ValidateWebhook(_ context.Context, rawBody []byte, headers http.Header) (any, error) {
	secret, ok := os.LookupEnv("STRIPE_SIGNING_KEY")
	if !ok {
		// stripe-node throws on an undefined HMAC key; an empty one still signs
		return nil, errors.New(`The "key" argument must be of type string. Received undefined`)
	}
	// Node joins repeated headers with ", "
	return s.ValidateRequest(rawBody, strings.Join(headers.Values("Stripe-Signature"), ", "), secret)
}

func (s *StripeService) ProcessWebhook(ctx context.Context, e any) (any, error) {
	ok := map[string]any{"ok": true}
	var event stripe.Event
	switch v := e.(type) {
	case stripe.Event:
		event = v
	case *stripe.Event:
		event = *v
	default:
		return nil, fmt.Errorf("unexpected stripe event %T", e)
	}

	// Maybe it comes from another stripe webhook
	service := ""
	if event.Data != nil {
		if metadata, isMap := event.Data.Object["metadata"].(map[string]any); isMap {
			service, _ = metadata["service"].(string)
		}
	}
	if service != "gitroom" && event.Type != stripe.EventTypeInvoicePaymentSucceeded {
		return ok, nil
	}

	switch event.Type {
	case stripe.EventTypeInvoicePaymentSucceeded:
		return s.PaymentSucceeded(ctx, event)
	case stripe.EventTypeCustomerSubscriptionCreated:
		return s.CreateSubscription(ctx, event)
	case stripe.EventTypeCustomerSubscriptionUpdated:
		return s.UpdateSubscription(ctx, event)
	case stripe.EventTypeCustomerSubscriptionDeleted:
		return s.DeleteSubscription(ctx, event)
	default:
		return ok, nil
	}
}

func eventSubscription(event stripe.Event) (*stripe.Subscription, error) {
	var sub stripe.Subscription
	if event.Data == nil {
		return &sub, nil
	}
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return nil, err
	}
	return &sub, nil
}

// CheckValidCard authorizes $1 on the newest card of a trial customer and
// cancels the subscription when the card can't be charged.
func (s *StripeService) CheckValidCard(ctx context.Context, sub *stripe.Subscription) (bool, error) {
	if sub.Status == stripe.SubscriptionStatusIncomplete {
		return false, nil
	}

	customer := customerOf(sub.Customer)
	getOrgFromCustomer, err := s.organizations.GetOrgByCustomerID(ctx, customer)
	if err != nil {
		return false, err
	}
	if getOrgFromCustomer == nil || !getOrgFromCustomer.AllowTrial {
		return true, nil
	}

	slog.Info("Checking card")

	paymentMethods, err := firstPage(ctx, s.sc.V1PaymentMethods.List, &stripe.PaymentMethodListParams{
		Customer: stripe.String(customer),
	})
	if err != nil {
		return false, err
	}

	// find the last one created
	var latestMethod *stripe.PaymentMethod
	latestCreated := int64(-100)
	for _, current := range paymentMethods {
		if latestCreated < current.Created {
			latestMethod, latestCreated = current, current.Created
		}
	}
	if latestMethod == nil || latestMethod.ID == "" {
		return false, nil
	}

	detachAndCancel := func() error {
		if _, err := s.sc.V1PaymentMethods.Detach(ctx, paymentMethods[0].ID, nil); err != nil {
			return err
		}
		_, err := s.sc.V1Subscriptions.Cancel(ctx, sub.ID, nil)
		return err
	}

	valid, err := func() (bool, error) {
		paymentIntent, err := s.sc.V1PaymentIntents.Create(ctx, &stripe.PaymentIntentCreateParams{
			Amount:        stripe.Int64(100),
			Currency:      stripe.String("usd"),
			PaymentMethod: stripe.String(latestMethod.ID),
			Customer:      stripe.String(customer),
			OffSession:    stripe.Bool(true),
			CaptureMethod: stripe.String("manual"), // Authorize without capturing
			Confirm:       stripe.Bool(true),       // Confirm the PaymentIntent
		})
		if err != nil {
			return false, err
		}

		if paymentIntent.Status != stripe.PaymentIntentStatusRequiresCapture {
			slog.Error("Cant charge")
			if err := detachAndCancel(); err != nil {
				return false, err
			}
			return false, nil
		}

		if _, err := s.sc.V1PaymentIntents.Cancel(ctx, paymentIntent.ID, nil); err != nil {
			return false, err
		}
		return true, nil
	}()
	if err != nil {
		_ = detachAndCancel() // dont do anything
		return false, nil
	}
	return valid, nil
}

func (s *StripeService) CreateSubscription(ctx context.Context, event stripe.Event) (any, error) {
	sub, err := eventSubscription(event)
	if err != nil {
		return nil, err
	}
	uniqueID, billing, period := sub.Metadata["uniqueId"], sub.Metadata["billing"], sub.Metadata["period"]
	customer := customerOf(sub.Customer)

	liveSubscriptions, err := s.getLiveSubscriptions(ctx, customer)
	if err != nil {
		return nil, err
	}
	isDuplicate, isLive := false, false
	for _, f := range liveSubscriptions {
		if f.ID != sub.ID && (f.Created < sub.Created || (f.Created == sub.Created && f.ID < sub.ID)) {
			isDuplicate = true
		}
		if f.ID == sub.ID {
			isLive = true
		}
	}
	if isDuplicate {
		if isLive {
			if _, err := s.sc.V1Subscriptions.Cancel(ctx, sub.ID, nil); err != nil {
				return nil, err
			}
		}
		slog.Info("stripe_duplicate_subscription_cancelled",
			"stripe_event_type", string(event.Type),
			"stripe_event_id", event.ID,
			"stripe_subscription_id", sub.ID,
		)
		return map[string]any{"ok": true}, nil
	}

	if check, err := s.CheckValidCard(ctx, sub); err != nil || !check {
		return map[string]any{"ok": false}, nil
	}

	price, found := pricing[billing]
	if !found {
		return nil, fmt.Errorf("unknown billing %q", billing)
	}
	return s.subscriptions.CreateOrUpdateSubscription(ctx, StripeProviderName, sub.Status != stripe.SubscriptionStatusActive,
		uniqueID, customer, price.Channel, billing, period, unixOrNull(sub.CancelAt), "", "")
}

func (s *StripeService) UpdateSubscription(ctx context.Context, event stripe.Event) (any, error) {
	sub, err := eventSubscription(event)
	if err != nil {
		return nil, err
	}
	uniqueID, billing, period := sub.Metadata["uniqueId"], sub.Metadata["billing"], sub.Metadata["period"]

	check, err := s.CheckValidCard(ctx, sub)
	if err != nil {
		return nil, err
	}
	if !check {
		return map[string]any{"ok": false}, nil
	}

	price, found := pricing[billing]
	if !found {
		return nil, fmt.Errorf("unknown billing %q", billing)
	}
	return s.subscriptions.CreateOrUpdateSubscription(ctx, StripeProviderName, sub.Status != stripe.SubscriptionStatusActive,
		uniqueID, customerOf(sub.Customer), price.Channel, billing, period, unixOrNull(sub.CancelAt), "", "")
}

func (s *StripeService) DeleteSubscription(ctx context.Context, event stripe.Event) (any, error) {
	sub, err := eventSubscription(event)
	if err != nil {
		return nil, err
	}
	customer := customerOf(sub.Customer)
	live, err := s.getLiveSubscriptions(ctx, customer)
	if err != nil {
		return nil, err
	}
	if len(live) == 0 {
		return nil, s.subscriptions.DeleteSubscription(ctx, customer, StripeProviderName)
	}

	survivor := live[0]
	uniqueID, billing, period := survivor.Metadata["uniqueId"], survivor.Metadata["billing"], survivor.Metadata["period"]
	price, found := pricing[billing]
	outcome := "resynced"
	if !found || period == "" {
		outcome = "metadata_missing"
	}
	slog.Info("stripe_subscription_deleted_survivor_kept",
		"stripe_event_type", string(event.Type),
		"stripe_event_id", event.ID,
		"stripe_subscription_id", sub.ID,
		"stripe_survivor_id", survivor.ID,
		"outcome", outcome,
	)
	if !found || period == "" {
		return nil, nil
	}

	return s.subscriptions.CreateOrUpdateSubscription(ctx, StripeProviderName, survivor.Status != stripe.SubscriptionStatusActive,
		uniqueID, customer, price.Channel, billing, period, unixOrNull(survivor.CancelAt), "", "")
}

// SyncCustomerEmailsAfterSwitch: after a login swap, move each Stripe
// customer's email to the login that now owns it. Owner-only so a member's
// switch can't rewrite a shared org's billing email, deduped per customer,
// and skipping admin-granted subscriptions (their paymentId is a user id,
// not a `cus_...` customer).
func (s *StripeService) SyncCustomerEmailsAfterSwitch(ctx context.Context, accounts []Account) error {
	if os.Getenv("STRIPE_PUBLISHABLE_KEY") == "" {
		return nil
	}
	var customers []string
	emailByCustomer := map[string]string{}
	for _, account := range accounts {
		organizations, err := s.organizations.GetOrgsByUserID(ctx, account.ID)
		if err != nil {
			return err
		}
		for _, org := range organizations {
			paymentID := deref(org.PaymentID)
			if len(org.Edges.Users) > 0 && org.Edges.Users[0].Role == userorganization.RoleSUPERADMIN &&
				strings.HasPrefix(paymentID, "cus_") {
				if _, seen := emailByCustomer[paymentID]; !seen {
					emailByCustomer[paymentID] = account.Email
					customers = append(customers, paymentID)
				}
			}
		}
	}
	for _, customerID := range customers {
		_, _ = s.sc.V1Customers.Update(ctx, customerID, &stripe.CustomerUpdateParams{
			Email: stripe.String(emailOrPostiz(emailByCustomer[customerID])),
		})
	}
	return nil
}

func (s *StripeService) CreateOrGetCustomer(ctx context.Context, organization *ent.Organization) (string, error) {
	if organization == nil {
		return "", errNoOrganization
	}
	if deref(organization.PaymentID) != "" {
		return *organization.PaymentID, nil
	}

	users, err := s.organizations.GetTeam(ctx, organization.ID)
	if err != nil {
		return "", err
	}
	if users == nil || len(users.Edges.Users) == 0 || users.Edges.Users[0].Edges.User == nil {
		return "", errors.New("organization has no users")
	}
	customer, err := s.sc.V1Customers.Create(ctx, &stripe.CustomerCreateParams{
		Email: stripe.String(emailOrPostiz(users.Edges.Users[0].Edges.User.Email)),
		Name:  stripe.String(organization.Name),
	})
	if err != nil {
		return "", err
	}
	if err := s.subscriptions.UpdateCustomerID(ctx, organization.ID, customer.ID); err != nil {
		return "", err
	}
	return customer.ID, nil
}

// Package is one entry of getPackages' groupBy(recurring).
type Package struct {
	Name      string   `json:"name"`
	Recurring string   `json:"recurring"`
	Price     *float64 `json:"price"`
}

func (s *StripeService) GetPackages(ctx context.Context) (any, error) {
	params := &stripe.PriceListParams{
		Active:     stripe.Bool(true),
		LookupKeys: stripe.StringSlice([]string{"standard_monthly", "standard_yearly", "pro_monthly", "pro_yearly"}),
	}
	params.AddExpand("data.tiers")
	params.AddExpand("data.product")
	products, err := firstPage(ctx, s.sc.V1Prices.List, params)
	if err != nil {
		return nil, err
	}

	productsList := map[string][]Package{}
	for _, p := range products {
		item := Package{Recurring: "undefined"}
		if p.Product != nil {
			item.Name = p.Product.Name
		}
		if p.Recurring != nil {
			item.Recurring = string(p.Recurring.Interval)
		}
		if len(p.Tiers) > 0 {
			price := float64(p.Tiers[0].UnitAmount) / 100
			item.Price = &price
		}
		productsList[item.Recurring] = append(productsList[item.Recurring], item)
	}
	return productsList, nil
}

// findOrCreatePrice finds (or creates) the product named after the tier and
// its recurring price. Prorate additionally matches the price nickname.
func (s *StripeService) findOrCreatePrice(ctx context.Context, body BillingSubscribeDTO, matchNickname bool) (*stripe.Price, error) {
	priceData := pricing[body.Billing]
	productParams := &stripe.ProductListParams{Active: stripe.Bool(true)}
	productParams.AddExpand("data.prices")
	allProducts, err := firstPage(ctx, s.sc.V1Products.List, productParams)
	if err != nil {
		return nil, err
	}

	var findProduct *stripe.Product
	for _, product := range allProducts {
		if strings.ToUpper(product.Name) == strings.ToUpper(body.Billing) {
			findProduct = product
			break
		}
	}
	if findProduct == nil {
		if findProduct, err = s.sc.V1Products.Create(ctx, &stripe.ProductCreateParams{
			Active: stripe.Bool(true),
			Name:   stripe.String(body.Billing),
		}); err != nil {
			return nil, err
		}
	}

	pricesList, err := firstPage(ctx, s.sc.V1Prices.List, &stripe.PriceListParams{
		Active:  stripe.Bool(true),
		Product: stripe.String(findProduct.ID),
	})
	if err != nil {
		return nil, err
	}

	interval, amount := "year", int64(priceData.YearPrice)*100
	if body.Period == "MONTHLY" {
		interval, amount = "month", int64(priceData.MonthPrice)*100
	}
	nickname := body.Billing + " " + body.Period
	for _, p := range pricesList {
		if p.Recurring != nil && strings.ToLower(string(p.Recurring.Interval)) == interval &&
			(!matchNickname || p.Nickname == nickname) &&
			p.UnitAmount == amount {
			return p, nil
		}
	}

	return s.sc.V1Prices.Create(ctx, &stripe.PriceCreateParams{
		Active:     stripe.Bool(true),
		Product:    stripe.String(findProduct.ID),
		Currency:   stripe.String("usd"),
		Nickname:   stripe.String(nickname),
		UnitAmount: stripe.Int64(amount),
		Recurring: &stripe.PriceCreateRecurringParams{
			Interval: stripe.String(interval),
		},
	})
}

func (s *StripeService) activeOrTrialing(ctx context.Context, customer string) ([]*stripe.Subscription, error) {
	list, err := firstPage(ctx, s.sc.V1Subscriptions.List, &stripe.SubscriptionListParams{
		Customer: stripe.String(customer),
		Status:   stripe.String("all"),
	})
	if err != nil {
		return nil, err
	}
	var out []*stripe.Subscription
	for _, f := range list {
		if isActiveOrTrialing(f) {
			out = append(out, f)
		}
	}
	return out, nil
}

func firstItemID(sub *stripe.Subscription) string {
	if sub == nil || sub.Items == nil || len(sub.Items.Data) == 0 {
		return ""
	}
	return sub.Items.Data[0].ID
}

// ProrateResult is {price}.
type ProrateResult struct {
	Price float64 `json:"price"`
}

func (s *StripeService) Prorate(ctx context.Context, organizationID string, body BillingSubscribeDTO) (any, error) {
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	customer, err := s.CreateOrGetCustomer(ctx, org)
	if err != nil {
		return nil, err
	}
	findPrice, err := s.findOrCreatePrice(ctx, body, true)
	if err != nil {
		return nil, err
	}

	currentUserSubscription, err := s.activeOrTrialing(ctx, customer)
	if err != nil {
		return nil, err
	}

	item := &stripe.InvoiceCreatePreviewSubscriptionDetailsItemParams{
		Price:    stripe.String(findPrice.ID),
		Quantity: stripe.Int64(1),
	}
	params := &stripe.InvoiceCreatePreviewParams{
		Customer: stripe.String(customer),
		SubscriptionDetails: &stripe.InvoiceCreatePreviewSubscriptionDetailsParams{
			ProrationBehavior: stripe.String("always_invoice"),
			Items:             []*stripe.InvoiceCreatePreviewSubscriptionDetailsItemParams{item},
		},
	}
	if len(currentUserSubscription) > 0 {
		params.Subscription = stripe.String(currentUserSubscription[0].ID)
		if id := firstItemID(currentUserSubscription[0]); id != "" {
			item.ID = stripe.String(id)
		}
	}

	price, err := s.sc.V1Invoices.CreatePreview(ctx, params)
	if err != nil {
		slog.Error("Error calculating proration:", "error", err)
		return ProrateResult{Price: 0}, nil
	}
	return ProrateResult{Price: float64(price.AmountDue) / 100}, nil
}

func (s *StripeService) GetCustomerSubscriptions(ctx context.Context, organizationID string) ([]*stripe.Subscription, error) {
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if org == nil {
		return nil, errNoOrganization
	}
	return firstPage(ctx, s.sc.V1Subscriptions.List, &stripe.SubscriptionListParams{
		Customer: stripe.String(deref(org.PaymentID)),
		Status:   stripe.String("all"),
	})
}

func (s *StripeService) getLiveSubscriptions(ctx context.Context, customer string) ([]*stripe.Subscription, error) {
	if !strings.HasPrefix(customer, "cus_") {
		return nil, nil
	}

	params := &stripe.SubscriptionListParams{
		Customer: stripe.String(customer),
		Status:   stripe.String("all"),
	}
	params.AddExpand("data.latest_invoice")
	list, err := firstPage(ctx, s.sc.V1Subscriptions.List, params)
	if err != nil {
		return nil, err
	}
	var out []*stripe.Subscription
	for _, f := range list {
		if f.Status != stripe.SubscriptionStatusCanceled &&
			f.Status != stripe.SubscriptionStatusIncomplete &&
			f.Status != stripe.SubscriptionStatusIncompleteExpired {
			out = append(out, f)
		}
	}
	return out, nil
}

func cancelAtResult(id string, cancelAt *int64) *CancelResult {
	res := &CancelResult{ID: id}
	if cancelAt != nil {
		d := JSDate(time.Unix(*cancelAt, 0))
		res.CancelAt = &d
	}
	return res
}

func (s *StripeService) SetToCancel(ctx context.Context, organizationID string) (*CancelResult, error) {
	id := ids.Make(10)
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	customer, err := s.CreateOrGetCustomer(ctx, org)
	if err != nil {
		return nil, err
	}
	subscriptions, err := s.getLiveSubscriptions(ctx, customer)
	if err != nil {
		return nil, err
	}

	if len(subscriptions) == 0 {
		return nil, httpx.BadRequest("No active subscription found")
	}
	sub := subscriptions[0]

	// If the user is toggling back (un-cancelling), just remove the cancel
	if sub.CancelAtPeriodEnd {
		var cancelAt *int64
		for _, s2 := range subscriptions {
			updated, err := s.sc.V1Subscriptions.Update(ctx, s2.ID, &stripe.SubscriptionUpdateParams{
				CancelAtPeriodEnd: stripe.Bool(false),
				Metadata:          map[string]string{"service": "gitroom", "id": id},
			})
			if err != nil {
				return nil, err
			}
			if cancelAt == nil {
				cancelAt = unixOrNull(updated.CancelAt)
			}
		}
		if err := s.subscriptions.UpdateCancelAt(ctx, organizationID, cancelAt); err != nil {
			return nil, err
		}
		return cancelAtResult(id, cancelAt), nil
	}

	// Check if the latest invoice has a failed payment
	latestInvoice := sub.LatestInvoice
	hasFailedPayment := sub.Status == stripe.SubscriptionStatusPastDue ||
		(latestInvoice != nil && (latestInvoice.Status == stripe.InvoiceStatusOpen || latestInvoice.Status == stripe.InvoiceStatusUncollectible))

	if hasFailedPayment {
		// Payment already failed — cancel immediately and delete subscription
		for _, s2 := range subscriptions {
			if _, err := s.sc.V1Subscriptions.Cancel(ctx, s2.ID, nil); err != nil {
				return nil, err
			}
		}
		if err := s.subscriptions.DeleteSubscription(ctx, customer, StripeProviderName); err != nil {
			return nil, err
		}
		now := JSDate(time.Now())
		return &CancelResult{ID: id, CancelAt: &now}, nil
	}

	// Payment succeeded — cancel at end of billing period
	var cancelAt *int64
	for _, s2 := range subscriptions {
		updated, err := s.sc.V1Subscriptions.Update(ctx, s2.ID, &stripe.SubscriptionUpdateParams{
			CancelAtPeriodEnd: stripe.Bool(true),
			Metadata:          map[string]string{"service": "gitroom", "id": id},
		})
		if err != nil {
			return nil, err
		}
		if updated.CancelAt != 0 && (cancelAt == nil || updated.CancelAt < *cancelAt) {
			v := updated.CancelAt
			cancelAt = &v
		}
	}
	if err := s.subscriptions.UpdateCancelAt(ctx, organizationID, cancelAt); err != nil {
		return nil, err
	}
	return cancelAtResult(id, cancelAt), nil
}

func (s *StripeService) CancelAllSubscriptions(ctx context.Context, organizationID string) error {
	if os.Getenv("STRIPE_PUBLISHABLE_KEY") == "" {
		return nil
	}
	// getOrgById must not filter deletedAt, this can run for an organization
	// that was already soft deleted by an account deletion
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return err
	}
	if org == nil || deref(org.PaymentID) == "" {
		return nil
	}

	subscriptions, err := firstPage(ctx, s.sc.V1Subscriptions.List, &stripe.SubscriptionListParams{
		Customer:   stripe.String(*org.PaymentID),
		Status:     stripe.String("all"),
		ListParams: stripe.ListParams{Limit: stripe.Int64(100)},
	})
	if err != nil {
		return err
	}
	for _, subscription := range subscriptions {
		if subscription.Status == stripe.SubscriptionStatusCanceled {
			continue
		}
		if _, err := s.sc.V1Subscriptions.Cancel(ctx, subscription.ID, nil); err != nil {
			return err
		}
	}

	return s.subscriptions.DeleteSubscription(ctx, *org.PaymentID, StripeProviderName)
}

func (s *StripeService) GetCustomerByOrganizationID(ctx context.Context, organizationID string) (string, error) {
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return "", err
	}
	if org == nil {
		return "", errNoOrganization
	}
	return deref(org.PaymentID), nil
}

func (s *StripeService) CreateBillingPortalLink(ctx context.Context, customer string) (*stripe.BillingPortalSession, error) {
	return s.sc.V1BillingPortalSessions.Create(ctx, &stripe.BillingPortalSessionCreateParams{
		Customer:  stripe.String(customer),
		ReturnURL: stripe.String(os.Getenv("FRONTEND_URL") + "/billing"),
	})
}

// findAutoApplyPromotionCode finds an active promotion code with
// autoapply: true metadata. Only returns codes that are active and not
// expired. Returns the promotion code string (not the ID) for frontend
// auto-apply.
func (s *StripeService) findAutoApplyPromotionCode(ctx context.Context) string {
	promotionCodes, err := firstPage(ctx, s.sc.V1PromotionCodes.List, &stripe.PromotionCodeListParams{
		Active:     stripe.Bool(true),
		ListParams: stripe.ListParams{Limit: stripe.Int64(100)},
	})
	if err != nil {
		slog.Error("Error finding auto-apply promotion code:", "error", err)
		return ""
	}

	now := time.Now().Unix()
	for _, promoCode := range promotionCodes {
		var coupon *stripe.Coupon
		if promoCode.Promotion != nil {
			coupon = promoCode.Promotion.Coupon
		}

		// Check if it has autoapply metadata set to true (check both promo and coupon metadata)
		autoApply, found := "", false
		if coupon != nil {
			autoApply, found = coupon.Metadata["autoapply"]
		}
		if !found {
			autoApply = promoCode.Metadata["autoapply"]
		}
		if autoApply != "true" {
			continue
		}

		// Check if the promotion code has expired
		if promoCode.ExpiresAt != 0 && promoCode.ExpiresAt < now {
			continue
		}

		// Check if the coupon has expired (redeem_by)
		if coupon != nil && coupon.RedeemBy != 0 && coupon.RedeemBy < now {
			continue
		}

		// Check if max redemptions reached
		if promoCode.MaxRedemptions != 0 && promoCode.TimesRedeemed >= promoCode.MaxRedemptions {
			continue
		}

		// Found a valid auto-apply promotion code - return the code string for frontend
		return promoCode.Code
	}
	return ""
}

// subscriptionMetadata is {service: 'gitroom', ...body, ...extra}.
func subscriptionMetadata(body BillingSubscribeDTO, extra ...string) map[string]string {
	metadata := map[string]string{"service": "gitroom", "period": body.Period, "billing": body.Billing}
	for key, value := range map[string]*string{
		"utm":                 body.Utm,
		"dub":                 body.Dub,
		"datafast_session_id": body.DatafastSessionID,
		"datafast_visitor_id": body.DatafastVisitorID,
	} {
		if value != nil {
			metadata[key] = *value
		}
	}
	for i := 0; i+1 < len(extra); i += 2 {
		// undefined values (no track cookie) are dropped by stripe-node
		if extra[i+1] != "" {
			metadata[extra[i]] = extra[i+1]
		}
	}
	return metadata
}

func utmSuffix(body BillingSubscribeDTO) string {
	if deref(body.Utm) == "" {
		return ""
	}
	return "&utm_source=" + *body.Utm
}

// EmbeddedCheckout is {client_secret, auto_apply_coupon?}.
type EmbeddedCheckout struct {
	ClientSecret    string `json:"client_secret"`
	AutoApplyCoupon string `json:"auto_apply_coupon,omitempty"`
}

func (s *StripeService) createEmbeddedCheckout(ctx context.Context, ud, uniqueID, customer string, body BillingSubscribeDTO, price, userID string, allowTrial bool) (any, error) {
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, errors.New("user not found")
	}

	update := &stripe.CustomerUpdateParams{Email: stripe.String(emailOrPostiz(user.Email))}
	if deref(body.Dub) != "" {
		update.Metadata = map[string]string{"dubCustomerExternalId": userID, "dubClickId": *body.Dub}
	}
	_, _ = s.sc.V1Customers.Update(ctx, customer, update)

	// Check for auto-apply promotion code (only for monthly plans)
	autoApplyPromoCode := ""
	if body.Period == "MONTHLY" {
		autoApplyPromoCode = s.findAutoApplyPromotionCode(ctx)
	}

	params := &stripe.CheckoutSessionCreateParams{
		UIMode:    stripe.String("custom"),
		Customer:  stripe.String(customer),
		ReturnURL: stripe.String(os.Getenv("FRONTEND_URL") + "/launches?onboarding=true&trialStart=true&check=" + uniqueID + utmSuffix(body)),
		Mode:      stripe.String("subscription"),
		SubscriptionData: &stripe.CheckoutSessionCreateSubscriptionDataParams{
			Metadata: subscriptionMetadata(body, "userId", userID, "uniqueId", uniqueID, "ud", ud),
		},
		AllowPromotionCodes: stripe.Bool(body.Period == "MONTHLY"),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
			{Price: stripe.String(price), Quantity: stripe.Int64(1)},
		},
	}
	if allowTrial {
		params.SubscriptionData.TrialPeriodDays = stripe.Int64(7)
	}
	if deref(body.DatafastSessionID) != "" && deref(body.DatafastVisitorID) != "" {
		params.Metadata = map[string]string{
			"datafast_visitor_id": *body.DatafastVisitorID,
			"datafast_session_id": *body.DatafastSessionID,
		}
	}
	session, err := s.sc.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return nil, err
	}

	// Return auto-apply promo code for frontend to apply
	return EmbeddedCheckout{ClientSecret: session.ClientSecret, AutoApplyCoupon: autoApplyPromoCode}, nil
}

func (s *StripeService) createCheckoutSession(ctx context.Context, ud, uniqueID, customer string, body BillingSubscribeDTO, price, userID string, allowTrial bool) (any, error) {
	isUtm := utmSuffix(body)

	if deref(body.Dub) != "" {
		if _, err := s.sc.V1Customers.Update(ctx, customer, &stripe.CustomerUpdateParams{
			Metadata: map[string]string{"dubCustomerExternalId": userID, "dubClickId": *body.Dub},
		}); err != nil {
			return nil, err
		}
	}

	params := &stripe.CheckoutSessionCreateParams{
		Customer:   stripe.String(customer),
		CancelURL:  stripe.String(os.Getenv("FRONTEND_URL") + "/billing?cancel=true" + isUtm),
		SuccessURL: stripe.String(os.Getenv("FRONTEND_URL") + "/launches?onboarding=true&trialStart=true&check=" + uniqueID + isUtm),
		Mode:       stripe.String("subscription"),
		SubscriptionData: &stripe.CheckoutSessionCreateSubscriptionDataParams{
			Metadata: subscriptionMetadata(body, "userId", userID, "uniqueId", uniqueID, "ud", ud),
		},
		AllowPromotionCodes: stripe.Bool(body.Period == "MONTHLY"),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
			{Price: stripe.String(price), Quantity: stripe.Int64(1)},
		},
	}
	if allowTrial {
		params.SubscriptionData.TrialPeriodDays = stripe.Int64(7)
	}
	session, err := s.sc.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return nil, err
	}
	return map[string]any{"url": session.URL}, nil
}

func (s *StripeService) PortalLink(ctx context.Context, organizationID string) (*PortalLink, error) {
	customer, err := s.GetCustomerByOrganizationID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	session, err := s.CreateBillingPortalLink(ctx, customer)
	if err != nil {
		return nil, err
	}
	return &PortalLink{URL: session.URL}, nil
}

func (s *StripeService) GetInvoices(ctx context.Context, organizationID string) ([]PaymentInvoice, error) {
	customer, err := s.GetCustomerByOrganizationID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	out := []PaymentInvoice{}
	if !strings.HasPrefix(customer, "cus_") {
		return out, nil
	}

	invoices, err := firstPage(ctx, s.sc.V1Invoices.List, &stripe.InvoiceListParams{
		Customer:   stripe.String(customer),
		ListParams: stripe.ListParams{Limit: stripe.Int64(100)},
	})
	if err != nil {
		return nil, err
	}

	for _, invoice := range invoices {
		if invoice.Status == stripe.InvoiceStatusDraft {
			continue
		}
		// snapshot of the subscription metadata ({ billing, period }) when the invoice was finalized
		var metadata map[string]string
		if invoice.Parent != nil && invoice.Parent.SubscriptionDetails != nil {
			metadata = invoice.Parent.SubscriptionDetails.Metadata
		}
		var lines []*stripe.InvoiceLineItem
		if invoice.Lines != nil {
			lines = invoice.Lines.Data
		}
		var description *string
		periodEnd := invoice.PeriodEnd
		for i, line := range lines {
			if i == 0 {
				description = nullable(line.Description)
			}
			if line.Period != nil && line.Period.End > periodEnd {
				periodEnd = line.Period.End
			}
		}

		// an open invoice that was already attempted is a failed charge waiting for a retry
		status := "pending"
		switch {
		case invoice.Status == stripe.InvoiceStatusPaid:
			status = "paid"
		case invoice.Status == stripe.InvoiceStatusVoid:
			status = "void"
		case invoice.Status == stripe.InvoiceStatusUncollectible || invoice.Attempted:
			status = "failed"
		}

		out = append(out, PaymentInvoice{
			ID:          invoice.ID,
			Number:      nullable(invoice.Number),
			Tier:        nullable(metadata["billing"]),
			Period:      nullable(metadata["period"]),
			Description: description,
			Amount:      invoice.Total,
			Currency:    string(invoice.Currency),
			Created:     invoice.Created,
			PeriodEnd:   periodEnd,
			Status:      status,
			DownloadURL: nullable(invoice.InvoicePDF),
			ViewURL:     nullable(invoice.HostedInvoiceURL),
		})
	}
	return out, nil
}

func (s *StripeService) FinishTrial(ctx context.Context, organization *ent.Organization) (any, error) {
	list, err := firstPage(ctx, s.sc.V1Subscriptions.List, &stripe.SubscriptionListParams{
		Customer: stripe.String(deref(organization.PaymentID)),
	})
	if err != nil {
		return nil, err
	}
	for _, f := range list {
		if f.Status == stripe.SubscriptionStatusTrialing {
			return s.sc.V1Subscriptions.Update(ctx, f.ID, &stripe.SubscriptionUpdateParams{
				TrialEndNow: stripe.Bool(true),
			})
		}
	}
	return nil, errors.New("no trialing subscription")
}

func (s *StripeService) discountedSubscription(ctx context.Context, customer string) (*stripe.Subscription, error) {
	params := &stripe.SubscriptionListParams{
		Customer: stripe.String(customer),
		Status:   stripe.String("all"),
	}
	params.AddExpand("data.discounts")
	list, err := firstPage(ctx, s.sc.V1Subscriptions.List, params)
	if err != nil {
		return nil, err
	}
	for _, f := range list {
		if isActiveOrTrialing(f) {
			return f, nil
		}
	}
	return nil, nil
}

func (s *StripeService) CheckDiscount(ctx context.Context, organization *ent.Organization) (bool, error) {
	customer := deref(organization.PaymentID)
	if os.Getenv("STRIPE_DISCOUNT_ID") == "" || customer == "" {
		return false, nil
	}

	list, err := firstPage(ctx, s.sc.V1Charges.List, &stripe.ChargeListParams{
		Customer:   stripe.String(customer),
		ListParams: stripe.ListParams{Limit: stripe.Int64(1)},
	})
	if err != nil {
		return false, err
	}
	paid := false
	for _, f := range list {
		if f.Amount > 1000 {
			paid = true
		}
	}
	if !paid {
		return false, nil
	}

	current, err := s.discountedSubscription(ctx, customer)
	if err != nil {
		return false, err
	}
	// TS wraps the find() result in an object, so a missing subscription
	// falls through to true.
	if current != nil {
		if (current.Items != nil && len(current.Items.Data) > 0 && current.Items.Data[0].Price != nil &&
			current.Items.Data[0].Price.Recurring != nil && current.Items.Data[0].Price.Recurring.Interval == stripe.PriceRecurringIntervalYear) ||
			len(current.Discounts) > 0 {
			return false, nil
		}
	}
	return true, nil
}

func (s *StripeService) ApplyDiscount(ctx context.Context, organization *ent.Organization) (any, error) {
	customer := deref(organization.PaymentID)
	// TS forgets to await checkDiscount, so a pending Promise always passed
	// this gate; it gates for real here, as intended.
	check, err := s.CheckDiscount(ctx, organization)
	if err != nil {
		return nil, err
	}
	if !check {
		return false, nil
	}

	current, err := s.discountedSubscription(ctx, customer)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, errors.New("no active subscription")
	}

	if _, err := s.sc.V1Subscriptions.Update(ctx, current.ID, &stripe.SubscriptionUpdateParams{
		Discounts: []*stripe.SubscriptionUpdateDiscountParams{{Coupon: stripe.String(os.Getenv("STRIPE_DISCOUNT_ID"))}},
	}); err != nil {
		return nil, err
	}
	return true, nil
}

// CheckSubscription: 2 = active in our db, 1 = cancelled in Stripe, 0 = pending.
func (s *StripeService) CheckSubscription(ctx context.Context, organizationID, subscriptionID string) (int, error) {
	orgValue, err := s.subscriptions.CheckSubscription(ctx, organizationID, subscriptionID)
	if err != nil {
		return 0, err
	}
	if orgValue != nil {
		return 2, nil
	}

	getCustomerSubscriptions, err := s.GetCustomerSubscriptions(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	for _, p := range getCustomerSubscriptions {
		if p.Metadata["uniqueId"] == subscriptionID {
			if p.CanceledAt != 0 {
				return 1, nil
			}
			break
		}
	}
	return 0, nil
}

func (s *StripeService) Embedded(ctx context.Context, uniqueID, organizationID, userID string, body BillingSubscribeDTO, allowTrial bool) (any, error) {
	id := ids.Make(10)
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	customer, err := s.CreateOrGetCustomer(ctx, org)
	if err != nil {
		return nil, err
	}
	live, err := s.getLiveSubscriptions(ctx, customer)
	if err != nil {
		return nil, err
	}
	if len(live) > 0 {
		return map[string]any{"blocked": true}, nil
	}
	findPrice, err := s.findOrCreatePrice(ctx, body, false)
	if err != nil {
		return nil, err
	}
	return s.createEmbeddedCheckout(ctx, uniqueID, id, customer, body, findPrice.ID, userID, allowTrial)
}

func (s *StripeService) Subscribe(ctx context.Context, uniqueID, organizationID, userID string, body BillingSubscribeDTO, allowTrial bool) (any, error) {
	id := ids.Make(10)
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	customer, err := s.CreateOrGetCustomer(ctx, org)
	if err != nil {
		return nil, err
	}
	findPrice, err := s.findOrCreatePrice(ctx, body, false)
	if err != nil {
		return nil, err
	}

	getCurrentSubscriptions, err := s.subscriptions.GetSubscription(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if getCurrentSubscriptions == nil {
		return s.createCheckoutSession(ctx, uniqueID, id, customer, body, findPrice.ID, userID, allowTrial)
	}

	currentUserSubscription, err := s.activeOrTrialing(ctx, customer)
	if err != nil {
		return nil, err
	}

	err = func() error {
		if len(currentUserSubscription) == 0 || firstItemID(currentUserSubscription[0]) == "" {
			return errors.New("no active subscription")
		}
		_, err := s.sc.V1Subscriptions.Update(ctx, currentUserSubscription[0].ID, &stripe.SubscriptionUpdateParams{
			CancelAtPeriodEnd: stripe.Bool(false),
			Metadata:          subscriptionMetadata(body, "userId", userID, "id", id, "ud", uniqueID),
			ProrationBehavior: stripe.String("always_invoice"),
			Items: []*stripe.SubscriptionUpdateItemParams{{
				ID:       stripe.String(firstItemID(currentUserSubscription[0])),
				Price:    stripe.String(findPrice.ID),
				Quantity: stripe.Int64(1),
			}},
		})
		return err
	}()
	if err == nil {
		return map[string]any{"id": id}, nil
	}

	portal, err := s.CreateBillingPortalLink(ctx, customer)
	if err != nil {
		return nil, err
	}
	return map[string]any{"portal": portal.URL}, nil
}

func (s *StripeService) PaymentSucceeded(ctx context.Context, event stripe.Event) (any, error) {
	ok := map[string]any{"ok": true}
	var invoice stripe.Invoice
	if event.Data != nil {
		if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
			return nil, err
		}
	}

	// get subscription from payment
	if invoice.Parent == nil || invoice.Parent.SubscriptionDetails == nil ||
		invoice.Parent.SubscriptionDetails.Subscription == nil || invoice.Parent.SubscriptionDetails.Subscription.ID == "" {
		return ok, nil
	}
	subscription, err := s.sc.V1Subscriptions.Retrieve(ctx, invoice.Parent.SubscriptionDetails.Subscription.ID, nil)
	if err != nil {
		return nil, err
	}

	userID, ud := subscription.Metadata["userId"], subscription.Metadata["ud"]
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user != nil && deref(user.IP) != "" && deref(user.Agent) != "" {
		// not awaited in the TS
		go s.track.Track(context.WithoutCancel(ctx), ud, *user.IP, *user.Agent, TrackPurchase,
			map[string]any{"value": float64(invoice.AmountPaid) / 100}, "", nil)
	}

	return ok, nil
}

// Charge is one row of getCharges.
type Charge struct {
	ID             string  `json:"id"`
	Amount         int64   `json:"amount"`
	Currency       string  `json:"currency"`
	Created        int64   `json:"created"`
	Status         string  `json:"status"`
	Refunded       bool    `json:"refunded"`
	AmountRefunded int64   `json:"amount_refunded"`
	Description    *string `json:"description"`
	ReceiptURL     *string `json:"receipt_url"`
	Invoice        *string `json:"invoice"`
	InvoicePDF     *string `json:"invoice_pdf"`
}

// chargeInvoice reads `(charge as any).invoice` from the raw list item: the
// API dropped Charge.invoice in 2025-03-31.basil, so neither stripe-node
// 20.4.0 nor stripe-go v84 types it.
func chargeInvoice(charge *stripe.Charge) string {
	if charge.LastResponse == nil {
		return ""
	}
	var raw struct {
		Invoice any `json:"invoice"`
	}
	_ = json.Unmarshal(charge.LastResponse.RawJSON, &raw)
	id, _ := raw.Invoice.(string)
	return id
}

func (s *StripeService) succeededCharges(ctx context.Context, customer string) ([]*stripe.Charge, error) {
	list, err := firstPage(ctx, s.sc.V1Charges.List, &stripe.ChargeListParams{
		Customer:   stripe.String(customer),
		ListParams: stripe.ListParams{Limit: stripe.Int64(100)},
	})
	if err != nil {
		return nil, err
	}
	var out []*stripe.Charge
	for _, f := range list {
		if f.Status == stripe.ChargeStatusSucceeded {
			out = append(out, f)
		}
	}
	return out, nil
}

func (s *StripeService) GetCharges(ctx context.Context, organizationID string) (any, error) {
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	chargeList := []Charge{}
	if org == nil || deref(org.PaymentID) == "" {
		return chargeList, nil
	}

	charges, err := s.succeededCharges(ctx, *org.PaymentID)
	if err != nil {
		return nil, err
	}

	invoicePdfMap := map[string]string{}
	for _, charge := range charges {
		chargeList = append(chargeList, Charge{
			ID:             charge.ID,
			Amount:         charge.Amount,
			Currency:       string(charge.Currency),
			Created:        charge.Created,
			Status:         string(charge.Status),
			Refunded:       charge.Refunded,
			AmountRefunded: charge.AmountRefunded,
			Description:    nullable(charge.Description),
			ReceiptURL:     nullable(charge.ReceiptURL),
			Invoice:        nullable(chargeInvoice(charge)),
		})
	}
	for _, charge := range chargeList {
		if charge.Invoice == nil {
			continue
		}
		inv, err := s.sc.V1Invoices.Retrieve(ctx, *charge.Invoice, nil)
		if err != nil {
			continue // ignore if invoice can't be fetched
		}
		if inv.InvoicePDF != "" {
			invoicePdfMap[*charge.Invoice] = inv.InvoicePDF
		}
	}
	for i, charge := range chargeList {
		if charge.Invoice != nil {
			chargeList[i].InvoicePDF = nullable(invoicePdfMap[*charge.Invoice])
		}
	}
	return chargeList, nil
}

func (s *StripeService) RefundCharges(ctx context.Context, organizationID string, chargeIDs []string) (any, error) {
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if org == nil || deref(org.PaymentID) == "" {
		return nil, errors.New("No payment customer found for this organization")
	}

	refunded, failed := []string{}, []string{}
	for _, chargeID := range chargeIDs {
		if _, err := s.sc.V1Refunds.Create(ctx, &stripe.RefundCreateParams{Charge: stripe.String(chargeID)}); err != nil {
			failed = append(failed, chargeID)
			continue
		}
		refunded = append(refunded, chargeID)
	}
	return map[string]any{"refunded": refunded, "failed": failed}, nil
}

func (s *StripeService) CancelSubscription(ctx context.Context, organizationID string) (any, error) {
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if org == nil || deref(org.PaymentID) == "" {
		return nil, errors.New("No payment customer found for this organization")
	}
	customer := *org.PaymentID

	subscriptions, err := s.getLiveSubscriptions(ctx, customer)
	if err != nil {
		return nil, err
	}
	if len(subscriptions) == 0 {
		return nil, errors.New("No active subscription found")
	}

	for _, subscription := range subscriptions {
		if _, err := s.sc.V1Subscriptions.Cancel(ctx, subscription.ID, nil); err != nil {
			return nil, err
		}
	}
	if err := s.subscriptions.DeleteSubscription(ctx, customer, StripeProviderName); err != nil {
		return nil, err
	}
	return map[string]any{"cancelled": true}, nil
}

// Coupon is one entry of getCouponInfo().coupons.
type Coupon struct {
	Type             string  `json:"type"`
	Value            float64 `json:"value"`
	Duration         string  `json:"duration"`
	DurationInMonths *int64  `json:"durationInMonths"`
	RemainingMonths  *int64  `json:"remainingMonths"`
}

func mapSubscriptionDiscounts(subscription *stripe.Subscription) []Coupon {
	out := []Coupon{}
	if subscription == nil {
		return out
	}
	for _, discount := range subscription.Discounts {
		if discount == nil {
			continue
		}
		var coupon *stripe.Coupon
		if discount.Source != nil {
			coupon = discount.Source.Coupon
		}
		c := Coupon{Type: "amount", Duration: "once"}
		if coupon != nil {
			if coupon.PercentOff != 0 {
				c.Type, c.Value = "percentage", coupon.PercentOff
			} else {
				c.Value = float64(coupon.AmountOff) / 100
			}
			if coupon.Duration != "" {
				c.Duration = string(coupon.Duration)
			}
			c.DurationInMonths = unixOrNull(coupon.DurationInMonths)
		}
		if discount.End != 0 {
			remaining := int64(math.Max(0, math.Ceil((float64(discount.End)-float64(time.Now().UnixMilli())/1000)/(30*24*60*60))))
			c.RemainingMonths = &remaining
		}
		out = append(out, c)
	}
	return out
}

func (s *StripeService) getActiveStripeSubscription(ctx context.Context, paymentID string) (*stripe.Subscription, error) {
	if !strings.HasPrefix(paymentID, "cus_") {
		return nil, nil
	}
	params := &stripe.SubscriptionListParams{
		Customer: stripe.String(paymentID),
		Status:   stripe.String("all"),
	}
	params.AddExpand("data.discounts.source.coupon")
	list, err := firstPage(ctx, s.sc.V1Subscriptions.List, params)
	if err != nil {
		return nil, err
	}
	for _, f := range list {
		if isActiveOrTrialing(f) {
			return f, nil
		}
	}
	return nil, nil
}

// CouponInfo is getCouponInfo's response.
type CouponInfo struct {
	Tier         *string  `json:"tier"`
	Period       *string  `json:"period"`
	IsLifetime   bool     `json:"isLifetime"`
	MonthlyPrice int      `json:"monthlyPrice"`
	PlanPrice    int      `json:"planPrice"`
	NextPayment  *float64 `json:"nextPayment"`
	Coupons      []Coupon `json:"coupons"`
	Supported    bool     `json:"supported"`
}

func orgPaymentID(org *ent.Organization) string {
	if org == nil {
		return ""
	}
	return deref(org.PaymentID)
}

func (s *StripeService) couponInfo(ctx context.Context, organizationID string) (*CouponInfo, error) {
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	subscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	stripeSubscription, err := s.getActiveStripeSubscription(ctx, orgPaymentID(org))
	if err != nil {
		return nil, err
	}

	info := &CouponInfo{Coupons: mapSubscriptionDiscounts(stripeSubscription)}
	var priceData pricingInner
	if subscription != nil {
		priceData = pricing[string(subscription.SubscriptionTier)]
		tier, period := string(subscription.SubscriptionTier), string(subscription.Period)
		info.Tier, info.Period = nullable(tier), nullable(period)
		info.IsLifetime = subscription.IsLifetime
	}
	info.MonthlyPrice = priceData.MonthPrice
	info.PlanPrice = info.MonthlyPrice
	if subscription != nil && subscription.Period == "YEARLY" {
		info.PlanPrice = priceData.YearPrice
	}

	if stripeSubscription != nil {
		preview, err := s.sc.V1Invoices.CreatePreview(ctx, &stripe.InvoiceCreatePreviewParams{
			Customer:     stripe.String(orgPaymentID(org)),
			Subscription: stripe.String(stripeSubscription.ID),
		})
		if err == nil { // no upcoming invoice otherwise
			next := float64(preview.Total) / 100
			info.NextPayment = &next
		}
	}

	info.Supported = subscription != nil && stripeSubscription != nil &&
		subscription.Period == "MONTHLY" && !subscription.IsLifetime && len(info.Coupons) == 0
	return info, nil
}

func (s *StripeService) GetCouponInfo(ctx context.Context, organizationID string) (any, error) {
	return s.couponInfo(ctx, organizationID)
}

func (s *StripeService) ApplyCoupon(ctx context.Context, organizationID string, body AdminApplyCouponDTO) (any, error) {
	type result struct {
		Applied bool   `json:"applied"`
		Reason  string `json:"reason,omitempty"`
	}
	info, err := s.couponInfo(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if !info.Supported {
		return result{Reason: "Applying a coupon is not supported for this user"}, nil
	}

	var value float64
	var months int
	if body.Value != nil {
		value = *body.Value
	}
	if body.Months != nil {
		months = *body.Months
	}
	if body.Type == "percentage" && (value < 1 || value > 100) ||
		body.Type != "percentage" && (value < 1 || value > float64(info.MonthlyPrice)) {
		return result{Reason: "Invalid coupon value"}, nil
	}

	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	stripeSubscription, err := s.getActiveStripeSubscription(ctx, orgPaymentID(org))
	if err != nil {
		return nil, err
	}
	if stripeSubscription == nil {
		return result{Reason: "No active subscription found for this customer"}, nil
	}

	params := &stripe.CouponCreateParams{
		Name:     stripe.String("Admin coupon for " + org.Name),
		Metadata: map[string]string{"service": "gitroom", "organizationId": organizationID},
	}
	if body.Type == "percentage" {
		params.PercentOff = stripe.Float64(value)
	} else {
		params.AmountOff = stripe.Int64(int64(math.Round(value * 100)))
		params.Currency = stripe.String("usd")
	}
	if months == 1 {
		params.Duration = stripe.String("once")
	} else {
		params.Duration = stripe.String("repeating")
		params.DurationInMonths = stripe.Int64(int64(months))
	}
	coupon, err := s.sc.V1Coupons.Create(ctx, params)
	if err != nil {
		return nil, err
	}

	if _, err := s.sc.V1Subscriptions.Update(ctx, stripeSubscription.ID, &stripe.SubscriptionUpdateParams{
		Discounts: []*stripe.SubscriptionUpdateDiscountParams{{Coupon: stripe.String(coupon.ID)}},
	}); err != nil {
		return nil, err
	}
	return result{Applied: true}, nil
}

func (s *StripeService) CancelCoupon(ctx context.Context, organizationID string) (any, error) {
	type result struct {
		Cancelled bool   `json:"cancelled"`
		Reason    string `json:"reason,omitempty"`
	}
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	stripeSubscription, err := s.getActiveStripeSubscription(ctx, orgPaymentID(org))
	if err != nil {
		return nil, err
	}
	if stripeSubscription == nil {
		return result{Reason: "No active subscription found for this customer"}, nil
	}
	if len(stripeSubscription.Discounts) == 0 {
		return result{Reason: "No coupon is applied to this subscription"}, nil
	}

	if _, err := s.sc.V1Subscriptions.DeleteDiscount(ctx, stripeSubscription.ID, nil); err != nil {
		return nil, err
	}
	return result{Cancelled: true}, nil
}

// ChatbaseRefundPreview is {eligible: false, reason} or the eligible preview.
type ChatbaseRefundPreview struct {
	Eligible        bool
	Reason          string
	ChargeID        string
	Amount          float64
	Currency        string
	Tier            *string
	Period          *string
	SubscriptionIDs []string
}

func (p ChatbaseRefundPreview) MarshalJSON() ([]byte, error) {
	if !p.Eligible {
		return json.Marshal(struct {
			Eligible bool   `json:"eligible"`
			Reason   string `json:"reason"`
		}{false, p.Reason})
	}
	return json.Marshal(struct {
		Eligible        bool     `json:"eligible"`
		ChargeID        string   `json:"chargeId"`
		Amount          float64  `json:"amount"`
		Currency        string   `json:"currency"`
		Tier            *string  `json:"tier"`
		Period          *string  `json:"period"`
		SubscriptionIDs []string `json:"subscriptionIds"`
	}{true, p.ChargeID, p.Amount, p.Currency, p.Tier, p.Period, p.SubscriptionIDs})
}

func (s *StripeService) chatbaseRefundPreview(ctx context.Context, organizationID string) (*ChatbaseRefundPreview, error) {
	notEligible := func(reason string) (*ChatbaseRefundPreview, error) {
		return &ChatbaseRefundPreview{Reason: reason}, nil
	}
	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if orgPaymentID(org) == "" {
		return notEligible("No payment customer found for this organization")
	}
	customer := *org.PaymentID

	all, err := firstPage(ctx, s.sc.V1Subscriptions.List, &stripe.SubscriptionListParams{
		Customer: stripe.String(customer),
		Status:   stripe.String("all"),
	})
	if err != nil {
		return nil, err
	}
	var subscriptions []*stripe.Subscription
	for _, f := range all {
		if f.Status != stripe.SubscriptionStatusCanceled {
			subscriptions = append(subscriptions, f)
		}
	}
	if len(subscriptions) == 0 {
		return notEligible("No active subscription found for this customer")
	}

	charges, err := s.succeededCharges(ctx, customer)
	if err != nil {
		return nil, err
	}
	for _, f := range charges {
		if f.Refunded || f.AmountRefunded > 0 {
			return notEligible("A refund was already issued for this customer")
		}
	}

	// only refund a charge that was created by the active subscription,
	// never a one-off payment
	var lastCharge *stripe.Charge
	var chargeSubscription *stripe.Subscription
	for _, charge := range charges {
		invoiceID := chargeInvoice(charge)
		if invoiceID == "" {
			continue
		}
		invoice, err := s.sc.V1Invoices.Retrieve(ctx, invoiceID, nil)
		if err != nil {
			continue // ignore if invoice can't be fetched
		}
		subscriptionID := ""
		if invoice.Parent != nil && invoice.Parent.SubscriptionDetails != nil && invoice.Parent.SubscriptionDetails.Subscription != nil {
			subscriptionID = invoice.Parent.SubscriptionDetails.Subscription.ID
		}
		chargeSubscription = nil
		for _, f := range subscriptions {
			if f.ID == subscriptionID {
				chargeSubscription = f
				break
			}
		}
		if chargeSubscription != nil {
			lastCharge = charge
			break
		}
	}
	if lastCharge == nil || chargeSubscription == nil {
		return notEligible("No subscription payment found for this customer")
	}

	sixtyDaysAgo := time.Now().Unix() - 60*24*60*60
	if lastCharge.Created < sixtyDaysAgo {
		return notEligible("The last subscription payment is older than 60 days")
	}

	// maximum refund is one month worth of the subscription
	amount := lastCharge.Amount
	if chargeSubscription.Items != nil && len(chargeSubscription.Items.Data) > 0 && chargeSubscription.Items.Data[0].Price != nil &&
		chargeSubscription.Items.Data[0].Price.Recurring != nil && chargeSubscription.Items.Data[0].Price.Recurring.Interval == stripe.PriceRecurringIntervalYear {
		amount = int64(math.Floor(float64(lastCharge.Amount) / 12))
	}

	currentSubscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	preview := &ChatbaseRefundPreview{
		Eligible: true,
		ChargeID: lastCharge.ID,
		Amount:   float64(amount) / 100,
		Currency: string(lastCharge.Currency),
	}
	if currentSubscription != nil {
		preview.Tier = nullable(string(currentSubscription.SubscriptionTier))
		preview.Period = nullable(string(currentSubscription.Period))
	}
	for _, f := range subscriptions {
		preview.SubscriptionIDs = append(preview.SubscriptionIDs, f.ID)
	}
	return preview, nil
}

func (s *StripeService) ChatbaseRefundPreview(ctx context.Context, organizationID string) (any, error) {
	return s.chatbaseRefundPreview(ctx, organizationID)
}

func (s *StripeService) ChatbaseRefund(ctx context.Context, organizationID string) (*ChatbaseRefundResult, error) {
	preview, err := s.chatbaseRefundPreview(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if !preview.Eligible {
		return &ChatbaseRefundResult{Refunded: false, Reason: preview.Reason}, nil
	}

	org, err := s.organizations.GetOrgByID(ctx, organizationID)
	if err != nil {
		return nil, err
	}

	if _, err := s.sc.V1Refunds.Create(ctx, &stripe.RefundCreateParams{
		Charge:   stripe.String(preview.ChargeID),
		Amount:   stripe.Int64(int64(math.Round(preview.Amount * 100))),
		Metadata: map[string]string{"reason": "chatbase_refund", "organizationId": organizationID},
	}); err != nil {
		return nil, err
	}

	for _, subscriptionID := range preview.SubscriptionIDs {
		if _, err := s.sc.V1Subscriptions.Cancel(ctx, subscriptionID, nil); err != nil {
			return nil, err
		}
	}

	if len(preview.SubscriptionIDs) > 0 {
		if err := s.subscriptions.DeleteSubscription(ctx, orgPaymentID(org), StripeProviderName); err != nil {
			return nil, err
		}
	}

	cancelled := len(preview.SubscriptionIDs) > 0
	return &ChatbaseRefundResult{
		Refunded:              true,
		Amount:                &preview.Amount,
		Currency:              &preview.Currency,
		SubscriptionCancelled: &cancelled,
	}, nil
}

func (s *StripeService) LifetimeDeal(ctx context.Context, organizationID, code string) (any, error) {
	getCurrentSubscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if getCurrentSubscription != nil && !getCurrentSubscription.IsLifetime {
		return nil, errors.New("You already have a non lifetime subscription")
	}

	success, err := func() (bool, error) {
		testCode, err := helpers.FixedDecryption(code)
		if err != nil {
			return false, err
		}
		findCode, err := s.subscriptions.GetCode(ctx, testCode)
		if err != nil {
			return false, err
		}
		if findCode != nil {
			return false, nil
		}

		nextPackage := "PRO"
		if getCurrentSubscription == nil {
			nextPackage = "STANDARD"
		}
		totalChannels := pricing[nextPackage].Channel
		if getCurrentSubscription != nil && getCurrentSubscription.SubscriptionTier == "PRO" {
			totalChannels = getCurrentSubscription.TotalChannels + 5
		}

		if _, err := s.subscriptions.CreateOrUpdateSubscription(ctx, StripeProviderName, false, ids.Make(10),
			organizationID, totalChannels, nextPackage, "MONTHLY", nil, testCode, organizationID); err != nil {
			return false, err
		}
		return true, nil
	}()
	if err != nil {
		slog.Error("lifetime deal failed", "error", err)
	}
	return map[string]any{"success": success}, nil
}
