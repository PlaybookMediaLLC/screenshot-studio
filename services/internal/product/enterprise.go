package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/organizationenterprisesettings"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/supportaccessgrant"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type SupportGrantAccess struct {
	GrantID        string `json:"grantId"`
	OrganizationID string `json:"organizationId"`
}

func (c *Configuration) VerifySupportGrant(ctx context.Context, actor Actor, organizationID, scope string) (*SupportGrantAccess, error) {
	if organizationID == "" || scope == "" {
		return nil, ErrInvalidInput
	}
	if err := c.AuthorizeSession(ctx, actor); err != nil {
		return nil, err
	}
	grant, err := c.client.SupportAccessGrant.Query().Where(
		supportaccessgrant.OrganizationID(organizationID), supportaccessgrant.UserID(actor.UserID),
		supportaccessgrant.Scope(scope), supportaccessgrant.ExpiresAtGT(time.Now().UTC()),
		supportaccessgrant.RevokedAtIsNil(),
	).Order(ent.Desc(supportaccessgrant.FieldExpiresAt)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrForbidden
	}
	if err != nil {
		return nil, err
	}
	return &SupportGrantAccess{GrantID: grant.ID, OrganizationID: grant.OrganizationID}, nil
}

func (c *Configuration) RequireEnterpriseFeature(ctx context.Context, actor Actor, feature string) error {
	if feature != "ssoEnabled" && feature != "scimEnabled" {
		return ErrInvalidInput
	}
	if err := c.AuthorizeSensitive(ctx, actor); err != nil {
		return err
	}
	settings, err := c.client.OrganizationEnterpriseSettings.Query().Where(
		organizationenterprisesettings.ID(actor.OrganizationID),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrForbidden
	}
	if err != nil {
		return err
	}
	if (feature == "ssoEnabled" && !settings.SSOEnabled) || (feature == "scimEnabled" && !settings.ScimEnabled) {
		return publishing.ErrForbidden
	}
	return nil
}
