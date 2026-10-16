package product

import (
	"context"
	"fmt"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspacecreditgrant"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// CreditGrantInput is a paid credit pack. The web facade verified the payment
// with the billing provider before forwarding it.
type CreditGrantInput struct {
	Credits        int    `json:"credits"`
	OrganizationID string `json:"organizationId"`
	Provider       string `json:"provider"`
	// Reference is the provider's id for the purchase, e.g. a Checkout session.
	Reference string `json:"reference"`
}

// CreditGrantResult is the workspace's purchased balance after the grant.
type CreditGrantResult struct {
	Balance  int  `json:"balance"`
	Replayed bool `json:"replayed"`
}

// GrantWorkspaceCredits adds a purchased credit pack once per provider
// reference; a replay changes nothing and answers with the current balance.
func (c *Configuration) GrantWorkspaceCredits(ctx context.Context, input CreditGrantInput) (*CreditGrantResult, error) {
	if input.Credits <= 0 || input.Credits > maxQuotaAmount(QuotaAICredits) ||
		input.OrganizationID == "" || len(input.OrganizationID) > 128 ||
		input.Provider == "" || len(input.Provider) > 80 || input.Reference == "" || len(input.Reference) > 255 {
		return nil, ErrInvalidInput
	}
	exists, err := c.client.Organization.Query().Where(organization.ID(input.OrganizationID)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("workspace not found: %w", publishing.ErrNotFound)
	}
	err = c.client.WorkspaceCreditGrant.Create().SetID(cuid.New()).SetOrganizationID(input.OrganizationID).
		SetProvider(input.Provider).SetReference(input.Reference).
		SetCredits(input.Credits).SetRemaining(input.Credits).Exec(ctx)
	replayed := ent.IsConstraintError(err)
	if err != nil && !replayed {
		return nil, err
	}
	balance, err := c.creditBalance(ctx, input.OrganizationID)
	if err != nil {
		return nil, err
	}
	return &CreditGrantResult{Balance: balance, Replayed: replayed}, nil
}

func (c *Configuration) creditGrants(ctx context.Context, org string) ([]*ent.WorkspaceCreditGrant, error) {
	return c.client.WorkspaceCreditGrant.Query().
		Where(workspacecreditgrant.OrganizationID(org), workspacecreditgrant.RemainingGT(0)).
		Order(ent.Asc(workspacecreditgrant.FieldCreatedAt), ent.Asc(workspacecreditgrant.FieldID)).All(ctx)
}

// creditBalance is what is left of a workspace's purchased packs.
func (c *Configuration) creditBalance(ctx context.Context, org string) (int, error) {
	grants, err := c.creditGrants(ctx, org)
	if err != nil {
		return 0, err
	}
	balance := 0
	for _, grant := range grants {
		balance += grant.Remaining
	}
	return balance, nil
}

// drawCredits takes up to amount from purchased packs, oldest first, and
// returns how much it took and the balance left. Each take is a conditional
// update, so concurrent draws never take the same credit twice.
func (c *Configuration) drawCredits(ctx context.Context, org string, amount int) (taken, balance int, err error) {
	// ponytail: one pass; a grant raced empty is skipped, not retried, so a
	// concurrent draw can refuse a call while another pack still has credit.
	grants, err := c.creditGrants(ctx, org)
	if err != nil {
		return 0, 0, err
	}
	for _, grant := range grants {
		take := min(amount-taken, grant.Remaining)
		if take > 0 {
			updated, err := c.client.WorkspaceCreditGrant.Update().
				Where(workspacecreditgrant.ID(grant.ID), workspacecreditgrant.RemainingGTE(take)).
				AddRemaining(-take).Save(ctx)
			if err != nil {
				return taken, 0, err
			}
			if updated == 1 {
				taken += take
				grant.Remaining -= take
			}
		}
		balance += grant.Remaining
	}
	return taken, balance, nil
}
