package subscriptions

import (
	"context"
	"log/slog"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
)

// IntegrationService is the part of integration.Service subscriptions use.
type IntegrationService interface {
	GetIntegrationsList(ctx context.Context, org string) ([]*ent.Integration, error)
	DisableIntegrations(ctx context.Context, org string, totalChannels int) error
	EnableAllIntegrations(ctx context.Context, org string) (int, error)
	ChangeActiveCron(ctx context.Context, orgID string) (bool, error)
}

// OrganizationService is the part of organizations.Service subscriptions use.
type OrganizationService interface {
	DisableOrEnableNonSuperAdminUsers(ctx context.Context, orgID string, disable bool) (int, error)
}

type Service struct {
	repo          *Repository
	integrations  IntegrationService
	organizations OrganizationService
}

func NewService(repo *Repository, integrations IntegrationService, organizations OrganizationService) *Service {
	return &Service{repo: repo, integrations: integrations, organizations: organizations}
}

func (s *Service) GetSubscriptionByOrganizationID(ctx context.Context, organizationID string) (*ent.Subscription, error) {
	return s.repo.GetSubscriptionByOrganizationID(ctx, organizationID)
}

// UseCredit charges one credit of typ (default "ai_images") around fn.
func (s *Service) UseCredit(ctx context.Context, org *ent.Organization, typ string, fn func(ctx context.Context) error) error {
	if typ == "" {
		typ = "ai_images"
	}
	return s.repo.UseCredit(ctx, org, typ, fn)
}

func (s *Service) GetCode(ctx context.Context, code string) (*ent.UsedCodes, error) {
	return s.repo.GetCode(ctx, code)
}

// Customer-keyed flows must never touch a subscription owned by another provider
func (s *Service) isManagedBy(ctx context.Context, customerID, provider string) (bool, error) {
	current, err := s.repo.GetSubscriptionByCustomerID(ctx, customerID)
	if err != nil {
		return false, err
	}
	return current == nil || current.Provider == provider, nil
}

// DeleteSubscription downgrades the customer's organization to FREE and
// deletes its subscriptions of provider, returning the deleted count.
func (s *Service) DeleteSubscription(ctx context.Context, customerID, provider string) (int, error) {
	managed, err := s.isManagedBy(ctx, customerID, provider)
	if err != nil || !managed {
		return 0, err
	}
	if _, err := s.ModifySubscription(ctx, customerID, Pricing["FREE"].Channel, "FREE"); err != nil {
		return 0, err
	}
	return s.repo.DeleteSubscriptionByCustomerID(ctx, customerID, provider)
}

// DeleteSubscriptionByOrgID is for store-managed subscriptions (RevenueCat
// etc.), which have no Stripe customer and are keyed by org. It returns false
// when the subscription is missing, owned by another provider, or lifetime.
func (s *Service) DeleteSubscriptionByOrgID(ctx context.Context, organizationID, provider string) (bool, error) {
	current, err := s.repo.GetSubscriptionByOrgID(ctx, organizationID)
	if err != nil {
		return false, err
	}
	if current == nil || current.Provider != provider || current.IsLifetime {
		return false, nil
	}
	if _, err := s.ModifySubscriptionByOrg(ctx, organizationID, Pricing["FREE"].Channel, "FREE"); err != nil {
		return false, err
	}
	if _, err := s.repo.DeleteSubscriptionByOrgID(ctx, organizationID, provider); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) UpdateCustomerID(ctx context.Context, organizationID, customerID string) (*ent.Organization, error) {
	return s.repo.UpdateCustomerID(ctx, organizationID, customerID)
}

func (s *Service) UpdateCancelAt(ctx context.Context, organizationID string, cancelAt *int64) (int, error) {
	return s.repo.UpdateCancelAt(ctx, organizationID, cancelAt)
}

func (s *Service) CheckSubscription(ctx context.Context, organizationID, subscriptionID string) (*ent.Subscription, error) {
	return s.repo.CheckSubscription(ctx, organizationID, subscriptionID)
}

func (s *Service) ModifySubscriptionByOrg(ctx context.Context, organizationID string, totalChannels int, billing string) (bool, error) {
	if organizationID == "" {
		return false, nil
	}
	current, err := s.repo.GetSubscriptionByOrgID(ctx, organizationID)
	if err != nil {
		return false, err
	}
	if err := s.applyPlan(ctx, organizationID, current, totalChannels, billing); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) ModifySubscription(ctx context.Context, customerID string, totalChannels int, billing string) (bool, error) {
	if customerID == "" {
		return false, nil
	}
	org, err := s.repo.GetOrganizationByCustomerID(ctx, customerID)
	if err != nil {
		return false, err
	}
	current, err := s.repo.GetSubscriptionByCustomerID(ctx, customerID)
	if err != nil {
		return false, err
	}
	if org == nil || (current != nil && current.IsLifetime) {
		return false, nil
	}
	if err := s.applyPlan(ctx, org.ID, current, totalChannels, billing); err != nil {
		return false, err
	}
	return true, nil
}

// applyPlan is the shared body of modifySubscription and
// modifySubscriptionByOrg: fit the channels and team to the new plan.
func (s *Service) applyPlan(ctx context.Context, orgID string, current *ent.Subscription, totalChannels int, billing string) error {
	fromTier := "FREE"
	currentChannels := 0
	if current != nil {
		fromTier = string(current.SubscriptionTier)
		currentChannels = current.TotalChannels
	}
	from, to := Pricing[fromTier], Pricing[billing]

	allChannels, err := s.integrations.GetIntegrationsList(ctx, orgID)
	if err != nil {
		return err
	}
	enabled := 0
	for _, channel := range allChannels {
		if !channel.Disabled {
			enabled++
		}
	}

	if enabled > totalChannels {
		if err := s.integrations.DisableIntegrations(ctx, orgID, enabled-totalChannels); err != nil {
			return err
		}
	}

	// channels are auto-disabled when a subscription lapses; once the new plan
	// can hold all of them and the limit grew, enable everything back (partial
	// enabling or same-plan updates would risk enabling channels the user
	// disabled on purpose)
	if billing != "FREE" && enabled < len(allChannels) && len(allChannels) <= totalChannels && totalChannels > currentChannels {
		if _, err := s.integrations.EnableAllIntegrations(ctx, orgID); err != nil {
			slog.Error("Error enabling channels after subscription change:", "error", err)
		}
	}

	if from.TeamMembers && !to.TeamMembers {
		if _, err := s.organizations.DisableOrEnableNonSuperAdminUsers(ctx, orgID, true); err != nil {
			return err
		}
	}
	if !from.TeamMembers && to.TeamMembers {
		if _, err := s.organizations.DisableOrEnableNonSuperAdminUsers(ctx, orgID, false); err != nil {
			return err
		}
	}

	if billing == "FREE" {
		if _, err := s.integrations.ChangeActiveCron(ctx, orgID); err != nil {
			return err
		}
	}
	return nil
}

// CreateOrUpdateSubscription applies the plan (unless it is a lifetime code)
// and upserts the subscription. A plan change failure is logged and skips the
// upsert, like the TS `return {}`. org "" means "find it by customerID".
func (s *Service) CreateOrUpdateSubscription(ctx context.Context, provider string, isTrailing bool, identifier, customerID string, totalChannels int, billing, period string, cancelAt *int64, code, org string) error {
	if code == "" {
		managed, err := s.isManagedBy(ctx, customerID, provider)
		if err != nil {
			return err
		}
		if !managed {
			return nil
		}
		load, err := s.ModifySubscription(ctx, customerID, totalChannels, billing)
		if err != nil {
			slog.Error("Error modifying subscription:", "error", err)
			return nil
		}
		if !load {
			return nil
		}
	}
	return s.repo.CreateOrUpdateSubscription(ctx, provider, isTrailing, identifier, customerID, totalChannels, billing, period, cancelAt, code, org)
}

func (s *Service) CreateOrUpdateSubscriptionByOrg(ctx context.Context, isTrailing bool, organizationID, provider, identifier string, totalChannels int, billing, period string, cancelAt *int64) error {
	current, err := s.repo.GetSubscriptionByOrgID(ctx, organizationID)
	if err != nil {
		return err
	}
	if current != nil && (current.IsLifetime || current.Provider != provider) {
		return nil
	}

	load, err := s.ModifySubscriptionByOrg(ctx, organizationID, totalChannels, billing)
	if err != nil {
		slog.Error("Error modifying subscription:", "error", err)
		return nil
	}
	if !load {
		return nil
	}

	return s.repo.CreateOrUpdateSubscription(ctx, provider, isTrailing, identifier, "", totalChannels, billing, period, cancelAt, "", organizationID)
}

func (s *Service) GetSubscriptionByIdentifier(ctx context.Context, identifier string) (*ent.Subscription, error) {
	return s.repo.GetSubscriptionByIdentifier(ctx, identifier)
}

// ChargeCredits is for work that is metered (minutes) and outlives a single
// call, so it can't be wrapped in UseCredit: the caller picks the id, charging
// twice is one row, and the same id refunds it on failure.
func (s *Service) ChargeCredits(ctx context.Context, id, organizationID, typ string, amount int) (string, error) {
	return s.repo.ChargeCredits(ctx, id, organizationID, typ, amount)
}

func (s *Service) RefundCredits(ctx context.Context, organizationID, id string) (int, error) {
	return s.repo.RefundCredits(ctx, organizationID, id)
}

func (s *Service) GetSubscription(ctx context.Context, organizationID string) (*ent.Subscription, error) {
	return s.repo.GetSubscription(ctx, organizationID)
}

// currentPeriodStart walks monthly from the subscription's creation to the
// start of the current billing month.
func currentPeriodStart(subscriptionCreatedAt time.Time, now time.Time) time.Time {
	date := subscriptionCreatedAt
	for date.Before(now) {
		date = addMonths(date, 1)
	}
	return addMonths(date, -1)
}

// addMonths is dayjs add(n, 'month'): the day is clamped to the target
// month's length instead of overflowing (Jan 31 + 1 month = Feb 28).
func addMonths(t time.Time, n int) time.Time {
	firstOfMonth := time.Date(t.Year(), t.Month()+time.Month(n), 1, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
	daysInMonth := time.Date(firstOfMonth.Year(), firstOfMonth.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
	return firstOfMonth.AddDate(0, 0, min(t.Day(), daysInMonth)-1)
}

// ResetCreditsResult is resetCredits' result.
type ResetCreditsResult struct {
	Deleted int `json:"deleted"`
}

// ResetCredits deletes this period's credits of typ; nil without a
// subscription.
func (s *Service) ResetCredits(ctx context.Context, organizationID, typ string) (*ResetCreditsResult, error) {
	sub, err := s.repo.GetSubscription(ctx, organizationID)
	if err != nil || sub == nil {
		return nil, err
	}
	count, err := s.repo.DeleteCreditsFrom(ctx, organizationID, currentPeriodStart(sub.CreatedAt, time.Now()), typ)
	if err != nil {
		return nil, err
	}
	return &ResetCreditsResult{Deleted: count}, nil
}

// CreditsLeft is checkCredits' result.
type CreditsLeft struct {
	Credits int `json:"credits"`
}

// CheckCredits returns the credits of checkType (default "ai_images") left
// this period. organization must carry Edges.Subscription when it has one.
func (s *Service) CheckCredits(ctx context.Context, organization *ent.Organization, checkType string) (*CreditsLeft, error) {
	if checkType == "" {
		checkType = "ai_images"
	}
	sub := organization.Edges.Subscription
	if sub == nil {
		return &CreditsLeft{Credits: 0}, nil
	}
	tier := Pricing[string(sub.SubscriptionTier)]

	checkFromMonth := currentPeriodStart(sub.CreatedAt, time.Now())
	limit := tier.GenerateVideos
	switch checkType {
	case "ai_images":
		limit = tier.ImageGenerationCount
	case "clipping_minutes":
		limit = tier.ClippingMinutes
	}

	totalUse, err := s.repo.GetCreditsFrom(ctx, organization.ID, checkFromMonth, checkType)
	if err != nil {
		return nil, err
	}
	return &CreditsLeft{Credits: limit - totalUse}, nil
}

// AddSubscription gives the organization a monthly plan with the customer id
// set to userID.
func (s *Service) AddSubscription(ctx context.Context, orgID, userID, plan, provider string) error {
	if _, err := s.repo.SetCustomerID(ctx, orgID, userID); err != nil {
		return err
	}
	return s.CreateOrUpdateSubscription(ctx, provider, false, ids.Make(5), userID, Pricing[plan].Channel, plan, "MONTHLY", nil, "", orgID)
}
