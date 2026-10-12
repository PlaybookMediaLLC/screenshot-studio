// Package autopost ports database/prisma/autopost: RSS autoposting, run by
// the autoPostWorkflow Temporal workflow.
package autopost

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	entautopost "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/autopost"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/autopost"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// CreateResponse is createAutopost's {id, active}.
type CreateResponse struct {
	ID     string `json:"id"`
	Active bool   `json:"active"`
}

func (r *Repository) GetTotal(ctx context.Context, orgID string) (int, error) {
	return r.client.AutoPost.Query().Where(entautopost.OrganizationID(orgID), entautopost.DeletedAtIsNil()).Count(ctx)
}

func (r *Repository) GetAutoposts(ctx context.Context, orgID string) ([]*ent.AutoPost, error) {
	return r.client.AutoPost.Query().Where(entautopost.OrganizationID(orgID), entautopost.DeletedAtIsNil()).All(ctx)
}

// orgRow finds {id, organizationId} or fails like Prisma's update.
func (r *Repository) orgRow(ctx context.Context, orgID, id string) (*ent.AutoPost, error) {
	return r.client.AutoPost.Query().Where(entautopost.ID(id), entautopost.OrganizationID(orgID)).Only(ctx)
}

func (r *Repository) DeleteAutopost(ctx context.Context, orgID, id string) (*ent.AutoPost, error) {
	row, err := r.orgRow(ctx, orgID, id)
	if err != nil {
		return nil, err
	}
	return row.Update().SetDeletedAt(time.Now()).Save(ctx)
}

// GetAutopost returns nil when missing or deleted.
func (r *Repository) GetAutopost(ctx context.Context, id string) (*ent.AutoPost, error) {
	row, err := r.client.AutoPost.Query().Where(entautopost.ID(id), entautopost.DeletedAtIsNil()).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return row, err
}

// UpdateURL sets lastUrl; a nil url (an undefined feed link) only touches
// updatedAt, like Prisma with an undefined value.
func (r *Repository) UpdateURL(ctx context.Context, id string, url *string) (*ent.AutoPost, error) {
	update := r.client.AutoPost.UpdateOneID(id)
	if url != nil {
		update.SetLastURL(*url)
	}
	return update.Save(ctx)
}

func (r *Repository) ChangeActive(ctx context.Context, orgID, id string, active bool) (*ent.AutoPost, error) {
	row, err := r.orgRow(ctx, orgID, id)
	if err != nil {
		return nil, err
	}
	return row.Update().SetActive(active).Save(ctx)
}

func boolOf(b *bool) bool { return b != nil && *b }

// CreateAutopost upserts on {id, organizationId}: update the org's autopost
// when id matches, otherwise create a new one.
func (r *Repository) CreateAutopost(ctx context.Context, orgID string, body dto.AutopostDto, id string) (CreateResponse, error) {
	integrations := body.Integrations
	if integrations == nil {
		integrations = []dto.Integrations{}
	}
	encoded, err := json.Marshal(integrations)
	if err != nil {
		return CreateResponse{}, err
	}

	if id != "" {
		row, err := r.client.AutoPost.Query().Where(entautopost.ID(id), entautopost.OrganizationID(orgID)).Only(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return CreateResponse{}, err
		}
		if row != nil {
			update := row.Update().
				SetURL(body.URL).SetTitle(body.Title).SetIntegrations(string(encoded)).SetActive(boolOf(body.Active)).
				SetGenerateContent(boolOf(body.GenerateContent)).SetAddPicture(boolOf(body.AddPicture)).
				SetSyncLast(boolOf(body.SyncLast)).SetOnSlot(boolOf(body.OnSlot))
			if body.Content != nil {
				update.SetContent(*body.Content)
			}
			if body.LastURL != nil {
				update.SetLastURL(*body.LastURL)
			}
			saved, err := update.Save(ctx)
			if err != nil {
				return CreateResponse{}, err
			}
			return CreateResponse{ID: saved.ID, Active: saved.Active}, nil
		}
	}

	// lastUrl is a required column; Prisma rejects a create without it.
	if body.LastURL == nil {
		return CreateResponse{}, errors.New("Argument `lastUrl` is missing.")
	}
	saved, err := r.client.AutoPost.Create().
		SetOrganizationID(orgID).SetURL(body.URL).SetTitle(body.Title).SetIntegrations(string(encoded)).
		SetActive(boolOf(body.Active)).SetNillableContent(body.Content).SetGenerateContent(boolOf(body.GenerateContent)).
		SetAddPicture(boolOf(body.AddPicture)).SetSyncLast(boolOf(body.SyncLast)).SetOnSlot(boolOf(body.OnSlot)).
		SetLastURL(*body.LastURL).
		Save(ctx)
	if err != nil {
		return CreateResponse{}, err
	}
	return CreateResponse{ID: saved.ID, Active: saved.Active}, nil
}
