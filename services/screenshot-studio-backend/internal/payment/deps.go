package payment

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/subscriptions"
)

// Consumer-side views of the services payment uses. The lead wires the
// concrete database/* and track services. "Not found" is (nil, nil), like
// Prisma's findFirst returning null.

// SubscriptionService is the part of subscriptions.Service payment uses.
// cancelAt is unix seconds (nil = null). code/org "" mean undefined.
// CreateOrUpdate* return whatever the TS service returns ({} or the row),
// because the Stripe/RevenueCat webhook responds with it.
type SubscriptionService interface {
	GetSubscriptionByOrganizationID(ctx context.Context, organizationID string) (*ent.Subscription, error)
	GetSubscription(ctx context.Context, organizationID string) (*ent.Subscription, error)
	GetCode(ctx context.Context, code string) (*ent.UsedCodes, error)
	CheckSubscription(ctx context.Context, organizationID, subscriptionID string) (*ent.Subscription, error)
	CreateOrUpdateSubscription(ctx context.Context, provider string, isTrailing bool, identifier, customerID string, totalChannels int, billing, period string, cancelAt *int64, code, org string) (any, error)
	CreateOrUpdateSubscriptionByOrg(ctx context.Context, isTrailing bool, organizationID, provider, identifier string, totalChannels int, billing, period string, cancelAt *int64) (any, error)
	DeleteSubscription(ctx context.Context, customerID, provider string) error
	DeleteSubscriptionByOrgID(ctx context.Context, organizationID, provider string) error
	UpdateCustomerID(ctx context.Context, organizationID, customerID string) error
	UpdateCancelAt(ctx context.Context, organizationID string, cancelAt *int64) error
}

// OrganizationService is the part of organizations.Service payment uses.
// GetOrgsByUserID loads Edges.Users filtered to the user (role/disabled);
// GetTeam loads Edges.Users[].Edges.User.
type OrganizationService interface {
	GetOrgByID(ctx context.Context, id string) (*ent.Organization, error)
	GetOrgByCustomerID(ctx context.Context, customerID string) (*ent.Organization, error)
	GetOrgsByUserID(ctx context.Context, userID string) ([]*ent.Organization, error)
	GetTeam(ctx context.Context, orgID string) (*ent.Organization, error)
}

// UsersService is the part of users.Service payment uses.
type UsersService interface {
	GetUserByID(ctx context.Context, id string) (*ent.User, error)
}

// TrackService is the part of track.Service payment uses. tt is TrackEnum.
type TrackService interface {
	Track(ctx context.Context, uniqueID, ip, agent string, tt int, additional map[string]any, fbclid string, user *ent.User)
}

// TrackPurchase is TrackEnum.Purchase.
const TrackPurchase = 4

// pricing is the plan pricing table (payment reads channel, month_price
// and year_price).
type pricingInner = subscriptions.PricingInner

var pricing = subscriptions.Pricing
