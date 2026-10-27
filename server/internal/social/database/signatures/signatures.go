// Package signatures ports database/prisma/signatures.
package signatures

import (
	"context"
	"time"

	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/signature"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	entsignatures "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/signatures"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// IDResponse is the {id} shape returned by createOrUpdateSignature.
type IDResponse struct {
	ID string `json:"id"`
}

func (r *Repository) GetSignaturesByOrgID(ctx context.Context, orgID string) ([]*ent.Signatures, error) {
	return r.client.Signatures.Query().
		Where(entsignatures.OrganizationID(orgID), entsignatures.DeletedAtIsNil()).All(ctx)
}

// GetDefaultSignature returns nil when the org has no auto-add signature.
func (r *Repository) GetDefaultSignature(ctx context.Context, orgID string) (*ent.Signatures, error) {
	row, err := r.client.Signatures.Query().
		Where(entsignatures.OrganizationID(orgID), entsignatures.AutoAdd(true), entsignatures.DeletedAtIsNil()).
		First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return row, err
}

// CreateOrUpdateSignature upserts on {id, organizationId} (a new row when id
// is empty or not the org's), then clears autoAdd on every other signature
// when this one is the default.
func (r *Repository) CreateOrUpdateSignature(ctx context.Context, orgID string, signature dto.SignatureDto, id string) (IDResponse, error) {
	autoAdd := signature.AutoAdd != nil && *signature.AutoAdd
	updatedID := ""
	if id != "" {
		n, err := r.client.Signatures.Update().Where(entsignatures.ID(id), entsignatures.OrganizationID(orgID)).
			SetOrganizationID(orgID).SetContent(signature.Content).SetAutoAdd(autoAdd).Save(ctx)
		if err != nil {
			return IDResponse{}, err
		}
		if n > 0 {
			updatedID = id
		}
	}
	if updatedID == "" {
		row, err := r.client.Signatures.Create().SetOrganizationID(orgID).SetContent(signature.Content).SetAutoAdd(autoAdd).Save(ctx)
		if err != nil {
			return IDResponse{}, err
		}
		updatedID = row.ID
	}

	if autoAdd {
		if _, err := r.client.Signatures.Update().
			Where(entsignatures.OrganizationID(orgID), entsignatures.IDNEQ(updatedID)).
			SetAutoAdd(false).Save(ctx); err != nil {
			return IDResponse{}, err
		}
	}
	return IDResponse{ID: updatedID}, nil
}

// DeleteSignature soft deletes; a missing row is an error, like Prisma's update.
func (r *Repository) DeleteSignature(ctx context.Context, orgID, id string) (*ent.Signatures, error) {
	row, err := r.client.Signatures.Query().Where(entsignatures.ID(id), entsignatures.OrganizationID(orgID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	return row.Update().SetDeletedAt(time.Now()).Save(ctx)
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) GetSignaturesByOrgID(ctx context.Context, orgID string) ([]*ent.Signatures, error) {
	return s.repo.GetSignaturesByOrgID(ctx, orgID)
}

func (s *Service) GetDefaultSignature(ctx context.Context, orgID string) (*ent.Signatures, error) {
	return s.repo.GetDefaultSignature(ctx, orgID)
}

func (s *Service) CreateOrUpdateSignature(ctx context.Context, orgID string, signature dto.SignatureDto, id string) (IDResponse, error) {
	return s.repo.CreateOrUpdateSignature(ctx, orgID, signature, id)
}

func (s *Service) DeleteSignature(ctx context.Context, orgID, id string) (*ent.Signatures, error) {
	return s.repo.DeleteSignature(ctx, orgID, id)
}
