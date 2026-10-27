// Package thirdparty ports database/prisma/third-party.
package thirdparty

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	entthirdparty "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/thirdparty"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// ThirdPartySummary is getAllThirdPartiesByOrganization's select.
type ThirdPartySummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Identifier string `json:"identifier"`
}

// SaveIntegrationData is the provider's account info passed to saveIntegration.
type SaveIntegrationData struct {
	Name     string `json:"name"`
	Username string `json:"username"`
	ID       string `json:"id"`
}

func (r *Repository) GetAllThirdPartiesByOrganization(ctx context.Context, org string) ([]ThirdPartySummary, error) {
	out := []ThirdPartySummary{}
	err := r.client.ThirdParty.Query().
		Where(entthirdparty.OrganizationID(org), entthirdparty.DeletedAtIsNil()).
		Select(entthirdparty.FieldID, entthirdparty.FieldName, entthirdparty.FieldIdentifier).
		Scan(ctx, &out)
	return out, err
}

// DeleteIntegration soft deletes; a missing row is an error, like Prisma's update.
func (r *Repository) DeleteIntegration(ctx context.Context, org, id string) (*ent.ThirdParty, error) {
	row, err := r.client.ThirdParty.Query().Where(entthirdparty.ID(id), entthirdparty.OrganizationID(org)).Only(ctx)
	if err != nil {
		return nil, err
	}
	return row.Update().SetDeletedAt(time.Now()).Save(ctx)
}

// GetIntegrationByID returns nil when not found. APIKey is still encrypted.
func (r *Repository) GetIntegrationByID(ctx context.Context, org, id string) (*ent.ThirdParty, error) {
	row, err := r.client.ThirdParty.Query().
		Where(entthirdparty.ID(id), entthirdparty.OrganizationID(org), entthirdparty.DeletedAtIsNil()).
		First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return row, err
}

// SaveIntegration upserts on (organizationId, internalId) and revives a
// deleted row.
func (r *Repository) SaveIntegration(ctx context.Context, org, identifier, apiKey string, data SaveIntegrationData) (*ent.ThirdParty, error) {
	encrypted, err := helpers.FixedEncryption(apiKey)
	if err != nil {
		return nil, err
	}
	err = r.client.ThirdParty.Create().
		SetOrganizationID(org).SetName(data.Name).SetInternalID(data.ID).SetIdentifier(identifier).SetAPIKey(encrypted).
		OnConflictColumns(entthirdparty.FieldOrganizationID, entthirdparty.FieldInternalID).
		Update(func(u *ent.ThirdPartyUpsert) {
			u.SetOrganizationID(org).SetName(data.Name).SetInternalID(data.ID).SetIdentifier(identifier).
				SetAPIKey(encrypted).ClearDeletedAt().SetUpdatedAt(time.Now())
		}).
		Exec(ctx)
	if err != nil {
		return nil, err
	}
	return r.client.ThirdParty.Query().
		Where(entthirdparty.OrganizationID(org), entthirdparty.InternalID(data.ID)).Only(ctx)
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) GetAllThirdPartiesByOrganization(ctx context.Context, org string) ([]ThirdPartySummary, error) {
	return s.repo.GetAllThirdPartiesByOrganization(ctx, org)
}

func (s *Service) DeleteIntegration(ctx context.Context, org, id string) (*ent.ThirdParty, error) {
	return s.repo.DeleteIntegration(ctx, org, id)
}

func (s *Service) GetIntegrationByID(ctx context.Context, org, id string) (*ent.ThirdParty, error) {
	return s.repo.GetIntegrationByID(ctx, org, id)
}

func (s *Service) SaveIntegration(ctx context.Context, org, identifier, apiKey string, data SaveIntegrationData) (*ent.ThirdParty, error) {
	return s.repo.SaveIntegration(ctx, org, identifier, apiKey, data)
}
