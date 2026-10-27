// Package subscriptions ports database/prisma/subscriptions: the
// SubscriptionRepository, SubscriptionService and the pricing table.
package subscriptions

import (
	"context"
	stdsql "database/sql"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/credits"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/subscription"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/usedcodes"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
)

type Repository struct {
	client *ent.Client
}

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// UserAccount is getUserAccount's select.
type UserAccount struct {
	Account          *string `json:"account"`
	ConnectedAccount bool    `json:"connectedAccount"`
}

func (r *Repository) GetUserAccount(ctx context.Context, userID string) (*UserAccount, error) {
	u, err := first(r.client.User.Query().Where(user.ID(userID)).
		Select(user.FieldAccount, user.FieldConnectedAccount).First(ctx))
	if err != nil || u == nil {
		return nil, err
	}
	return &UserAccount{Account: u.Account, ConnectedAccount: u.ConnectedAccount}, nil
}

func (r *Repository) GetCode(ctx context.Context, code string) (*ent.UsedCodes, error) {
	return first(r.client.UsedCodes.Query().Where(usedcodes.Code(code)).First(ctx))
}

func (r *Repository) UpdateAccount(ctx context.Context, userID, account string) (*ent.User, error) {
	return r.client.User.UpdateOneID(userID).SetAccount(account).Save(ctx)
}

func (r *Repository) GetSubscriptionByOrganizationID(ctx context.Context, organizationID string) (*ent.Subscription, error) {
	return first(r.client.Subscription.Query().
		Where(subscription.OrganizationID(organizationID), subscription.DeletedAtIsNil()).First(ctx))
}

func (r *Repository) UpdateConnectedStatus(ctx context.Context, account string, accountCharges bool) (int, error) {
	return r.client.User.Update().Where(user.Account(account)).SetConnectedAccount(accountCharges).Save(ctx)
}

// GetCustomerIDByOrgID loads only the organization's paymentId (nil when the
// organization does not exist).
func (r *Repository) GetCustomerIDByOrgID(ctx context.Context, organizationID string) (*ent.Organization, error) {
	return first(r.client.Organization.Query().Where(organization.ID(organizationID)).
		Select(organization.FieldPaymentID).First(ctx))
}

func (r *Repository) CheckSubscription(ctx context.Context, organizationID, subscriptionID string) (*ent.Subscription, error) {
	return first(r.client.Subscription.Query().Where(
		subscription.OrganizationID(organizationID),
		subscription.Identifier(subscriptionID),
		subscription.DeletedAtIsNil(),
	).First(ctx))
}

// DeleteSubscriptionByCustomerID hard deletes, like Prisma's deleteMany.
func (r *Repository) DeleteSubscriptionByCustomerID(ctx context.Context, customerID, provider string) (int, error) {
	return r.client.Subscription.Delete().Where(
		subscription.Provider(provider),
		subscription.HasOrganizationWith(organization.PaymentID(customerID)),
	).Exec(ctx)
}

func (r *Repository) DeleteSubscriptionByOrgID(ctx context.Context, organizationID, provider string) (int, error) {
	return r.client.Subscription.Delete().Where(
		subscription.OrganizationID(organizationID),
		subscription.Provider(provider),
	).Exec(ctx)
}

func (r *Repository) UpdateCustomerID(ctx context.Context, organizationID, customerID string) (*ent.Organization, error) {
	return r.client.Organization.UpdateOneID(organizationID).SetPaymentID(customerID).Save(ctx)
}

// UpdateCancelAt sets cancelAt from Unix seconds (nil or 0 clears it).
func (r *Repository) UpdateCancelAt(ctx context.Context, organizationID string, cancelAt *int64) (int, error) {
	update := r.client.Subscription.Update().
		Where(subscription.OrganizationID(organizationID), subscription.DeletedAtIsNil())
	if at := cancelAtTime(cancelAt); at != nil {
		update.SetCancelAt(*at)
	} else {
		update.ClearCancelAt()
	}
	return update.Save(ctx)
}

func (r *Repository) GetSubscriptionByOrgID(ctx context.Context, orgID string) (*ent.Subscription, error) {
	return first(r.client.Subscription.Query().Where(subscription.OrganizationID(orgID)).First(ctx))
}

func (r *Repository) GetSubscriptionByCustomerID(ctx context.Context, customerID string) (*ent.Subscription, error) {
	return first(r.client.Subscription.Query().
		Where(subscription.HasOrganizationWith(organization.PaymentID(customerID))).First(ctx))
}

func (r *Repository) GetOrganizationByCustomerID(ctx context.Context, customerID string) (*ent.Organization, error) {
	return first(r.client.Organization.Query().Where(organization.PaymentID(customerID)).First(ctx))
}

// CreateOrUpdateSubscription upserts the organization's subscription.
// orgID "" means "find the organization by customerID"; code "" means no
// lifetime code. cancelAt is Unix seconds.
func (r *Repository) CreateOrUpdateSubscription(ctx context.Context, provider string, isTrailing bool, identifier, customerID string, totalChannels int, billing, period string, cancelAt *int64, code, orgID string) error {
	if orgID == "" {
		org, err := r.GetOrganizationByCustomerID(ctx, customerID)
		if err != nil || org == nil {
			return err
		}
		orgID = org.ID
	}

	// Prisma upsert: the where may add organization.paymentId, so an existing
	// row of another customer is not matched and the create then fails on the
	// unique organizationId, exactly like Prisma.
	query := r.client.Subscription.Query().Where(subscription.OrganizationID(orgID))
	if code == "" && customerID != "" {
		query.Where(subscription.HasOrganizationWith(organization.PaymentID(customerID)))
	}
	current, err := first(query.First(ctx))
	if err != nil {
		return err
	}
	cancel := cancelAtTime(cancelAt)
	if current != nil {
		update := r.client.Subscription.UpdateOne(current).
			SetSubscriptionTier(subscription.SubscriptionTier(billing)).
			SetProvider(provider).
			SetTotalChannels(totalChannels).
			SetPeriod(subscription.Period(period)).
			SetIdentifier(identifier).
			SetIsLifetime(code != "").
			ClearDeletedAt()
		if cancel != nil {
			update.SetCancelAt(*cancel)
		} else {
			update.ClearCancelAt()
		}
		err = update.Exec(ctx)
	} else {
		err = r.client.Subscription.Create().
			SetOrganizationID(orgID).
			SetSubscriptionTier(subscription.SubscriptionTier(billing)).
			SetProvider(provider).
			SetIsLifetime(code != "").
			SetTotalChannels(totalChannels).
			SetPeriod(subscription.Period(period)).
			SetNillableCancelAt(cancel).
			SetIdentifier(identifier).
			Exec(ctx)
	}
	if err != nil {
		return err
	}

	if err := r.client.Organization.UpdateOneID(orgID).SetIsTrailing(isTrailing).SetAllowTrial(false).Exec(ctx); err != nil {
		return err
	}

	if code != "" {
		return r.client.UsedCodes.Create().SetCode(code).SetOrgID(orgID).Exec(ctx)
	}
	return nil
}

func (r *Repository) GetSubscriptionByIdentifier(ctx context.Context, identifier string) (*ent.Subscription, error) {
	return first(r.client.Subscription.Query().
		Where(subscription.Identifier(identifier), subscription.DeletedAtIsNil()).
		WithOrganization().First(ctx))
}

func (r *Repository) GetSubscription(ctx context.Context, organizationID string) (*ent.Subscription, error) {
	return first(r.client.Subscription.Query().
		Where(subscription.OrganizationID(organizationID), subscription.DeletedAtIsNil()).First(ctx))
}

// GetCreditsFrom sums the organization's credits of type since from.
func (r *Repository) GetCreditsFrom(ctx context.Context, organizationID string, from time.Time, typ string) (int, error) {
	rows, err := r.client.QueryContext(ctx,
		`SELECT SUM("credits") FROM "Credits" WHERE "organizationId" = $1 AND "type" = $2 AND "createdAt" >= $3 GROUP BY "organizationId"`,
		organizationID, typ, from)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var total stdsql.NullInt64
	if rows.Next() {
		if err := rows.Scan(&total); err != nil {
			return 0, err
		}
	}
	return int(total.Int64), rows.Err()
}

// UseCredit records one credit, runs fn, and gives the credit back when fn
// fails.
func (r *Repository) UseCredit(ctx context.Context, org *ent.Organization, typ string, fn func(ctx context.Context) error) error {
	data, err := r.client.Credits.Create().SetOrganizationID(org.ID).SetCredits(1).SetType(typ).Save(ctx)
	if err != nil {
		return err
	}
	if err := fn(ctx); err != nil {
		if derr := r.client.Credits.DeleteOneID(data.ID).Exec(ctx); derr != nil {
			return derr
		}
		return err
	}
	return nil
}

// ChargeCredits: the caller picks the id, so charging the same work twice is
// one row. It returns the id.
func (r *Repository) ChargeCredits(ctx context.Context, id, organizationID, typ string, amount int) (string, error) {
	err := r.client.Credits.Create().SetID(id).SetOrganizationID(organizationID).SetCredits(amount).SetType(typ).
		OnConflictColumns(credits.FieldID).Ignore().Exec(ctx)
	return id, err
}

func (r *Repository) RefundCredits(ctx context.Context, organizationID, id string) (int, error) {
	return r.client.Credits.Delete().Where(credits.ID(id), credits.OrganizationID(organizationID)).Exec(ctx)
}

func (r *Repository) DeleteCreditsFrom(ctx context.Context, organizationID string, from time.Time, typ string) (int, error) {
	return r.client.Credits.Delete().Where(
		credits.OrganizationID(organizationID),
		credits.Type(typ),
		credits.CreatedAtGTE(from),
	).Exec(ctx)
}

func (r *Repository) SetCustomerID(ctx context.Context, orgID, customerID string) (*ent.Organization, error) {
	return r.client.Organization.UpdateOneID(orgID).SetPaymentID(customerID).Save(ctx)
}

// cancelAtTime is `cancelAt ? new Date(cancelAt * 1000) : null`.
func cancelAtTime(cancelAt *int64) *time.Time {
	if cancelAt == nil || *cancelAt == 0 {
		return nil
	}
	t := time.Unix(*cancelAt, 0)
	return &t
}

func first[T any](v *T, err error) (*T, error) {
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return v, err
}
