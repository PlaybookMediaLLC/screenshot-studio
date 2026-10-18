// Package sets ports database/prisma/sets.
package sets

import (
	"context"

	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/sets"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	entsets "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/sets"
	"github.com/google/uuid"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// IDResponse is the {id} shape returned by createSet.
type IDResponse struct {
	ID string `json:"id"`
}

func (r *Repository) GetTotal(ctx context.Context, orgID string) (int, error) {
	return r.client.Sets.Query().Where(entsets.OrganizationID(orgID)).Count(ctx)
}

func (r *Repository) GetSets(ctx context.Context, orgID string) ([]*ent.Sets, error) {
	return r.client.Sets.Query().Where(entsets.OrganizationID(orgID)).Order(ent.Desc(entsets.FieldCreatedAt)).All(ctx)
}

// DeleteSet hard deletes and returns the row; a missing row is an error, like
// Prisma's delete.
func (r *Repository) DeleteSet(ctx context.Context, orgID, id string) (*ent.Sets, error) {
	row, err := r.client.Sets.Query().Where(entsets.ID(id), entsets.OrganizationID(orgID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	return row, r.client.Sets.DeleteOne(row).Exec(ctx)
}

// CreateSet is Prisma's upsert on {id, organizationId}: update the org's set
// when it exists, otherwise create one (with body.id when given).
func (r *Repository) CreateSet(ctx context.Context, orgID string, body dto.SetsDto) (IDResponse, error) {
	id := body.ID
	if id == "" {
		id = uuid.NewString()
	}
	n, err := r.client.Sets.Update().Where(entsets.ID(id), entsets.OrganizationID(orgID)).
		SetName(body.Name).SetContent(body.Content).Save(ctx)
	if err != nil {
		return IDResponse{}, err
	}
	if n > 0 {
		return IDResponse{ID: id}, nil
	}
	createID := body.ID
	if createID == "" {
		createID = uuid.NewString()
	}
	row, err := r.client.Sets.Create().SetID(createID).SetOrganizationID(orgID).SetName(body.Name).SetContent(body.Content).Save(ctx)
	if err != nil {
		return IDResponse{}, err
	}
	return IDResponse{ID: row.ID}, nil
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) GetTotal(ctx context.Context, orgID string) (int, error) {
	return s.repo.GetTotal(ctx, orgID)
}

func (s *Service) GetSets(ctx context.Context, orgID string) ([]*ent.Sets, error) {
	return s.repo.GetSets(ctx, orgID)
}

func (s *Service) CreateSet(ctx context.Context, orgID string, body dto.SetsDto) (IDResponse, error) {
	return s.repo.CreateSet(ctx, orgID, body)
}

func (s *Service) DeleteSet(ctx context.Context, orgID, id string) (*ent.Sets, error) {
	return s.repo.DeleteSet(ctx, orgID, id)
}
