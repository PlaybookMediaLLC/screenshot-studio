package activities

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"go.temporal.io/sdk/temporal"
)

// Workflow snapshots identify the account; only the current database row authorizes use.
func (a *PostActivities) currentIntegration(ctx context.Context, in *Integration) (*Integration, error) {
	unavailable := func() (*Integration, error) {
		return nil, temporal.NewNonRetryableApplicationError("The connected account is no longer available", temporalx.TypeBadBody, nil)
	}
	if in == nil || in.ID == "" || in.OrganizationID == "" {
		return unavailable()
	}
	row, err := a.integrations.GetIntegrationByID(ctx, in.OrganizationID, in.ID)
	if err != nil {
		return nil, err
	}
	if row == nil || row.DeletedAt != nil || row.Disabled || row.RefreshNeeded || row.InBetweenSteps || row.Token == "" || row.ProviderIdentifier != in.ProviderIdentifier || row.InternalID != in.InternalID {
		return unavailable()
	}
	active, err := row.QueryOrganization().Where(organization.DeletedAtIsNil()).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !active {
		return unavailable()
	}
	if integrations.RequireVerifiedIdentity(row) != nil {
		return nil, temporal.NewNonRetryableApplicationError("Reconnect this account to verify its identity, publishing permissions and limits", temporalx.TypeBadBody, nil)
	}
	return toIntegration(row), nil
}
