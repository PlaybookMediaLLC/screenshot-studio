package product

import (
	"context"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourceapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

// WebhookSource is what the web facade needs to verify a source webhook
// before any tenant is known. The secret itself stays in the facade's
// environment; only its reference name leaves the database.
type WebhookSource struct {
	ID              string  `json:"id"`
	OrganizationID  string  `json:"organizationId"`
	Provider        string  `json:"provider"`
	SecretReference *string `json:"secretReference"`
}

type IngestSourceReleaseInput struct {
	Audience         *string  `json:"audience"`
	BenefitStatement string   `json:"benefitStatement"`
	Description      *string  `json:"description"`
	EventID          string   `json:"eventId"`
	SourceAppID      string   `json:"sourceAppId"`
	SourceURLs       []string `json:"sourceUrls"`
	Title            string   `json:"title"`
}

type SourceReleaseIngest struct {
	Created   bool   `json:"created"`
	ReleaseID string `json:"releaseId"`
}

// GetWebhookSource is facade-only: it runs before the webhook signature, and
// therefore the tenant, is established.
func (c *Configuration) GetWebhookSource(ctx context.Context, sourceAppID string) (*WebhookSource, error) {
	row, err := c.client.SourceApp.Query().Where(sourceapp.ID(sourceAppID), sourceapp.StatusEQ(sourceapp.StatusACTIVE)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &WebhookSource{ID: row.ID, OrganizationID: row.OrganizationID, Provider: row.Provider, SecretReference: row.SecretReference}, nil
}

// IngestSourceRelease creates one release per source event. The release,
// its outbox event, and the audit record commit together; a replayed event
// returns the release it created.
func (c *Configuration) IngestSourceRelease(ctx context.Context, actor Actor, input IngestSourceReleaseInput) (*SourceReleaseIngest, error) {
	if actor.Kind != "webhook" {
		return nil, publishing.ErrForbidden
	}
	if err := c.authorizeRoles(ctx, actor); err != nil {
		return nil, err
	}
	input.Title = strings.TrimSpace(input.Title)
	input.BenefitStatement = strings.TrimSpace(input.BenefitStatement)
	if input.SourceURLs == nil {
		input.SourceURLs = []string{}
	}
	if input.SourceAppID == "" || input.EventID == "" || len(input.EventID) > 255 ||
		!validReleaseBrief(input.Title, input.BenefitStatement, input.Audience, input.Description, input.SourceURLs) {
		return nil, ErrInvalidInput
	}
	key := "source:" + input.SourceAppID + ":" + input.EventID
	for attempt := 0; attempt < 3; attempt++ {
		result, err := c.ingestSourceRelease(ctx, actor, input, key)
		if ent.IsConstraintError(err) {
			continue
		}
		return result, err
	}
	return nil, publishing.ErrConflict
}

func (c *Configuration) ingestSourceRelease(ctx context.Context, actor Actor, input IngestSourceReleaseInput, key string) (*SourceReleaseIngest, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	active, err := tx.SourceApp.Query().Where(sourceapp.ID(input.SourceAppID),
		sourceapp.OrganizationID(actor.OrganizationID), sourceapp.StatusEQ(sourceapp.StatusACTIVE)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !active {
		return nil, publishing.ErrNotFound
	}
	existing, err := tx.OutboxEvent.Query().Where(outboxevent.OrganizationID(actor.OrganizationID),
		outboxevent.IdempotencyKey(key)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if existing != nil {
		return &SourceReleaseIngest{Created: false, ReleaseID: existing.AggregateID}, nil
	}
	id := uuid.NewString()
	_, err = tx.OutboxEvent.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetType("release.ingested").SetAggregateType("release").SetAggregateID(id).
		SetPayload(map[string]any{"releaseId": id, "sourceAppId": input.SourceAppID}).
		SetIdempotencyKey(key).Save(ctx)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Release.Create().SetID(id).SetOrganizationID(actor.OrganizationID).SetTitle(input.Title).
		SetBenefitStatement(input.BenefitStatement).SetNillableAudience(input.Audience).
		SetNillableDescription(input.Description).SetSourceUrls(input.SourceURLs).Save(ctx); err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.release_ingested", "release", id); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &SourceReleaseIngest{Created: true, ReleaseID: id}, nil
}
