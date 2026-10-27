package payment

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

const (
	StripeProviderName     = "stripe"
	RevenueCatProviderName = "revenuecat"
)

// Platform is 'web' | 'mobile'.
type Platform string

const (
	PlatformWeb    Platform = "web"
	PlatformMobile Platform = "mobile"
)

// PaymentInvoice is one row of the billing history, in a provider neutral shape.
type PaymentInvoice struct {
	ID     string  `json:"id"`
	Number *string `json:"number"`
	// pricing key and MONTHLY / YEARLY the invoice was for, when the provider knows it
	Tier        *string `json:"tier"`
	Period      *string `json:"period"`
	Description *string `json:"description"`
	// minor units (cents)
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	// unix seconds
	Created     int64   `json:"created"`
	PeriodEnd   int64   `json:"periodEnd"`
	Status      string  `json:"status"` // paid | pending | failed | void
	DownloadURL *string `json:"downloadUrl"`
	ViewURL     *string `json:"viewUrl"`
}

// SyncResult is {active}.
type SyncResult struct {
	Active bool `json:"active"`
}

// PortalLink is {url} (the Stripe billing portal session's url).
type PortalLink struct {
	URL string `json:"url"`
}

// CancelResult is setToCancel's {id, cancel_at}.
type CancelResult struct {
	ID       string  `json:"id"`
	CancelAt *JSDate `json:"cancel_at,omitempty"`
}

// ChatbaseRefundResult is {refunded, reason} | {refunded, amount, currency, subscriptionCancelled}.
type ChatbaseRefundResult struct {
	Refunded              bool     `json:"refunded"`
	Reason                string   `json:"reason,omitempty"`
	Amount                *float64 `json:"amount,omitempty"`
	Currency              *string  `json:"currency,omitempty"`
	SubscriptionCancelled *bool    `json:"subscriptionCancelled,omitempty"`
}

// Account is {id, email} for syncCustomerEmailsAfterSwitch.
type Account struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// JSDate marshals like a JavaScript Date (toISOString).
type JSDate time.Time

func (d JSDate) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Time(d).UTC().Format(ent.JSTime))
}

// Provider is PaymentProviderAbstract. Every billing use-case goes through
// this contract. Webhooks and Platform are mandatory; everything else
// defaults (via Unsupported) to "not supported on this platform" so a
// provider only implements what its platform offers (e.g. app stores have no
// hosted checkout / portal / coupons).
type Provider interface {
	// Where the subscription is bought / managed. An organization can only be
	// subscribed on one platform at a time, the other platform is blocked.
	Platform() Platform

	// Turn the raw webhook request into a trusted event (error on bad signature / secret)
	ValidateWebhook(ctx context.Context, rawBody []byte, headers http.Header) (any, error)
	// Apply a validated webhook event to our subscriptions
	ProcessWebhook(ctx context.Context, event any) (any, error)

	// Client initiated re-check of the organization subscription against the
	// provider (mobile app after purchase / restore)
	SyncSubscription(ctx context.Context, organizationID string) (*SyncResult, error)
	// Hosted checkout page
	Subscribe(ctx context.Context, uniqueID, organizationID, userID string, body BillingSubscribeDTO, allowTrial bool) (any, error)
	// Embedded checkout (client secret rendered inside our page)
	Embedded(ctx context.Context, uniqueID, organizationID, userID string, body BillingSubscribeDTO, allowTrial bool) (any, error)
	// Price difference preview when switching plans
	Prorate(ctx context.Context, organizationID string, body BillingSubscribeDTO) (any, error)
	// Toggle cancel-at-period-end
	SetToCancel(ctx context.Context, organizationID string) (*CancelResult, error)
	// Cancel everything right now (account deletion). Must not fail when the
	// provider has nothing to cancel server side.
	CancelAllSubscriptions(ctx context.Context, organizationID string) error
	// Self-service portal (payment method / invoices)
	PortalLink(ctx context.Context, organizationID string) (*PortalLink, error)
	// Billing history (invoices) of the organization
	GetInvoices(ctx context.Context, organizationID string) ([]PaymentInvoice, error)
	// Post-checkout poll: is this subscription id active for the org
	CheckSubscription(ctx context.Context, organizationID, subscriptionID string) (int, error)
	// Available plans / prices
	GetPackages(ctx context.Context) (any, error)

	FinishTrial(ctx context.Context, organization *ent.Organization) (any, error)
	CheckDiscount(ctx context.Context, organization *ent.Organization) (bool, error)
	ApplyDiscount(ctx context.Context, organization *ent.Organization) (any, error)
	LifetimeDeal(ctx context.Context, organizationID, code string) (any, error)

	GetCharges(ctx context.Context, organizationID string) (any, error)
	RefundCharges(ctx context.Context, organizationID string, chargeIDs []string) (any, error)
	CancelSubscription(ctx context.Context, organizationID string) (any, error)
	GetCouponInfo(ctx context.Context, organizationID string) (any, error)
	ApplyCoupon(ctx context.Context, organizationID string, body AdminApplyCouponDTO) (any, error)
	CancelCoupon(ctx context.Context, organizationID string) (any, error)
	ChatbaseRefundPreview(ctx context.Context, organizationID string) (any, error)
	ChatbaseRefund(ctx context.Context, organizationID string) (*ChatbaseRefundResult, error)

	// After a login swap, keep the provider's customer email in sync (no-op by default)
	SyncCustomerEmailsAfterSwitch(ctx context.Context, accounts []Account) error
}

// Unsupported carries the abstract class defaults. Embed it and override
// what the platform supports.
type Unsupported struct{ P Platform }

func (u Unsupported) Platform() Platform { return u.P }

func (u Unsupported) notSupported() error {
	return httpx.HTTPException("This action is not supported on "+string(u.P), 400)
}

func (u Unsupported) SyncSubscription(context.Context, string) (*SyncResult, error) {
	return nil, u.notSupported()
}
func (u Unsupported) Subscribe(context.Context, string, string, string, BillingSubscribeDTO, bool) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) Embedded(context.Context, string, string, string, BillingSubscribeDTO, bool) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) Prorate(context.Context, string, BillingSubscribeDTO) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) SetToCancel(context.Context, string) (*CancelResult, error) {
	return nil, u.notSupported()
}
func (u Unsupported) CancelAllSubscriptions(context.Context, string) error { return u.notSupported() }
func (u Unsupported) PortalLink(context.Context, string) (*PortalLink, error) {
	return nil, u.notSupported()
}
func (u Unsupported) GetInvoices(context.Context, string) ([]PaymentInvoice, error) {
	return nil, u.notSupported()
}
func (u Unsupported) CheckSubscription(context.Context, string, string) (int, error) {
	return 0, u.notSupported()
}
func (u Unsupported) GetPackages(context.Context) (any, error) { return nil, u.notSupported() }
func (u Unsupported) FinishTrial(context.Context, *ent.Organization) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) CheckDiscount(context.Context, *ent.Organization) (bool, error) {
	return false, nil
}
func (u Unsupported) ApplyDiscount(context.Context, *ent.Organization) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) LifetimeDeal(context.Context, string, string) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) GetCharges(context.Context, string) (any, error) { return nil, u.notSupported() }
func (u Unsupported) RefundCharges(context.Context, string, []string) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) CancelSubscription(context.Context, string) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) GetCouponInfo(context.Context, string) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) ApplyCoupon(context.Context, string, AdminApplyCouponDTO) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) CancelCoupon(context.Context, string) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) ChatbaseRefundPreview(context.Context, string) (any, error) {
	return nil, u.notSupported()
}
func (u Unsupported) ChatbaseRefund(context.Context, string) (*ChatbaseRefundResult, error) {
	return nil, u.notSupported()
}
func (u Unsupported) SyncCustomerEmailsAfterSwitch(context.Context, []Account) error { return nil }

// BillingSubscribeDTO is the billing subscribe request body. Optional
// fields are pointers so the checkout metadata spread (`...body`) only sends
// keys the client sent.
type BillingSubscribeDTO struct {
	Period            string  `json:"period" validate:"oneof=MONTHLY YEARLY"`
	Billing           string  `json:"billing" validate:"oneof=STANDARD PRO TEAM ULTIMATE"`
	Utm               *string `json:"utm,omitempty"`
	Dub               *string `json:"dub,omitempty"`
	DatafastSessionID *string `json:"datafast_session_id,omitempty"`
	DatafastVisitorID *string `json:"datafast_visitor_id,omitempty"`
}

// AdminApplyCouponDTO is the admin apply coupon request body.
type AdminApplyCouponDTO struct {
	Type   string   `json:"type" validate:"oneof=percentage amount"`
	Value  *float64 `json:"value" validate:"required,min=1"`
	Months *int     `json:"months" validate:"required,min=1,max=12"`
}

// BillingSyncDTO is the billing sync request body.
type BillingSyncDTO struct {
	Provider string `json:"provider" validate:"required"`
}

// ResetCreditsDTO is the reset credits request body.
type ResetCreditsDTO struct {
	Type string `json:"type" validate:"oneof=ai_images ai_videos"`
}
