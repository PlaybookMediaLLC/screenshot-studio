// Package webhooks ports database/prisma/webhooks.
package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"time"

	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/integrationswebhooks"
	entwebhooks "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/webhooks"
	"github.com/google/uuid"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// IDResponse is the {id} shape returned by createWebhook.
type IDResponse struct {
	ID string `json:"id"`
}

// IntegrationRef is the integration select {id, picture, name}.
type IntegrationRef struct {
	ID      string  `json:"id"`
	Picture *string `json:"picture"`
	Name    string  `json:"name"`
}

type WebhookIntegration struct {
	Integration IntegrationRef `json:"integration"`
}

// Webhook is a webhook row with integrations: [{integration: {id, picture, name}}].
type Webhook struct {
	*ent.Webhooks
	Integrations []WebhookIntegration
}

func (w Webhook) MarshalJSON() ([]byte, error) {
	base, err := json.Marshal(w.Webhooks)
	if err != nil {
		return nil, err
	}
	list := w.Integrations
	if list == nil {
		list = []WebhookIntegration{}
	}
	extra, err := json.Marshal(list)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	buf.Write(base[:len(base)-1])
	buf.WriteString(`,"integrations":`)
	buf.Write(extra)
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func (r *Repository) GetTotal(ctx context.Context, orgID string) (int, error) {
	return r.client.Webhooks.Query().Where(entwebhooks.OrganizationID(orgID), entwebhooks.DeletedAtIsNil()).Count(ctx)
}

func (r *Repository) GetWebhooks(ctx context.Context, orgID string) ([]Webhook, error) {
	rows, err := r.client.Webhooks.Query().
		Where(entwebhooks.OrganizationID(orgID), entwebhooks.DeletedAtIsNil()).
		WithIntegrations(func(q *ent.IntegrationsWebhooksQuery) { q.WithIntegration() }).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Webhook, 0, len(rows))
	for _, row := range rows {
		hook := Webhook{Webhooks: row, Integrations: []WebhookIntegration{}}
		for _, link := range row.Edges.Integrations {
			if i := link.Edges.Integration; i != nil {
				hook.Integrations = append(hook.Integrations, WebhookIntegration{IntegrationRef{ID: i.ID, Picture: i.Picture, Name: i.Name}})
			}
		}
		out = append(out, hook)
	}
	return out, nil
}

// DeleteWebhook soft deletes; a missing row is an error, like Prisma's update.
func (r *Repository) DeleteWebhook(ctx context.Context, orgID, id string) (*ent.Webhooks, error) {
	row, err := r.client.Webhooks.Query().Where(entwebhooks.ID(id), entwebhooks.OrganizationID(orgID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	return row.Update().SetDeletedAt(time.Now()).Save(ctx)
}

// CreateWebhook upserts on {id, organizationId} (a new row when body.id is
// empty or not the org's), then replaces the webhook's integrations.
func (r *Repository) CreateWebhook(ctx context.Context, orgID string, body dto.WebhooksDto) (IDResponse, error) {
	id := ""
	if body.ID != "" {
		n, err := r.client.Webhooks.Update().Where(entwebhooks.ID(body.ID), entwebhooks.OrganizationID(orgID)).
			SetURL(body.URL).SetName(body.Name).Save(ctx)
		if err != nil {
			return IDResponse{}, err
		}
		if n > 0 {
			id = body.ID
		}
	}
	if id == "" {
		row, err := r.client.Webhooks.Create().SetID(uuid.NewString()).SetOrganizationID(orgID).
			SetURL(body.URL).SetName(body.Name).Save(ctx)
		if err != nil {
			return IDResponse{}, err
		}
		id = row.ID
	}

	// integrations: { deleteMany: {}, create: [...] } runs in one transaction.
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return IDResponse{}, err
	}
	if _, err := tx.IntegrationsWebhooks.Delete().Where(integrationswebhooks.WebhookID(id)).Exec(ctx); err != nil {
		return IDResponse{}, rollback(tx, err)
	}
	if len(body.Integrations) > 0 {
		builders := make([]*ent.IntegrationsWebhooksCreate, 0, len(body.Integrations))
		for _, integration := range body.Integrations {
			builders = append(builders, tx.IntegrationsWebhooks.Create().SetWebhookID(id).SetIntegrationID(integration.ID))
		}
		if err := tx.IntegrationsWebhooks.CreateBulk(builders...).Exec(ctx); err != nil {
			return IDResponse{}, rollback(tx, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return IDResponse{}, err
	}
	return IDResponse{ID: id}, nil
}

func rollback(tx *ent.Tx, err error) error {
	_ = tx.Rollback()
	return err
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) GetTotal(ctx context.Context, orgID string) (int, error) {
	return s.repo.GetTotal(ctx, orgID)
}

func (s *Service) GetWebhooks(ctx context.Context, orgID string) ([]Webhook, error) {
	return s.repo.GetWebhooks(ctx, orgID)
}

func (s *Service) CreateWebhook(ctx context.Context, orgID string, body dto.WebhooksDto) (IDResponse, error) {
	return s.repo.CreateWebhook(ctx, orgID, body)
}

func (s *Service) DeleteWebhook(ctx context.Context, orgID, id string) (*ent.Webhooks, error) {
	return s.repo.DeleteWebhook(ctx, orgID, id)
}
