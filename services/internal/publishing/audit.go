package publishing

import (
	"context"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditdrain"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/lucsky/cuid"
)

type auditInput struct {
	Action       string
	Actor        Actor
	EntityID     string
	EntityType   string
	Metadata     map[string]any
	Outcome      auditlog.Outcome
	Organization string
}

func appendAudit(ctx context.Context, tx *ent.Tx, input auditInput) error {
	actorType := auditlog.ActorTypeSERVICE
	if input.Actor.Type == "USER" {
		actorType = auditlog.ActorTypeUSER
	}
	requestID := input.Actor.RequestID
	if requestID == "" {
		requestID = cuid.New()
	}
	searchText := strings.Join([]string{input.Action, input.Actor.Display, input.EntityType, input.EntityID}, " ")
	builder := tx.AuditLog.Create().
		SetID(cuid.New()).
		SetOrganizationID(input.Organization).
		SetRequestID(requestID).
		SetActorType(actorType).
		SetAction(input.Action).
		SetOutcome(input.Outcome).
		SetEntityType(input.EntityType).
		SetEntityID(input.EntityID).
		SetSearchText(searchText)
	if input.Actor.UserID != "" {
		builder.SetActorUserID(input.Actor.UserID)
	}
	if input.Actor.Display != "" {
		builder.SetActorDisplay(input.Actor.Display)
	}
	if input.Metadata != nil {
		builder.SetMetadata(input.Metadata)
	}
	log, err := builder.Save(ctx)
	if err != nil {
		return err
	}
	drains, err := tx.AuditDrain.Query().Where(
		auditdrain.OrganizationID(input.Organization),
		auditdrain.Enabled(true),
	).All(ctx)
	if err != nil || len(drains) == 0 {
		return err
	}
	outbox, err := tx.AuditOutbox.Create().SetID(cuid.New()).SetAuditLogID(log.ID).Save(ctx)
	if err != nil {
		return err
	}
	builders := make([]*ent.AuditDrainDeliveryCreate, 0, len(drains))
	for _, drain := range drains {
		builders = append(builders, tx.AuditDrainDelivery.Create().
			SetID(cuid.New()).
			SetDrainID(drain.ID).
			SetOutboxID(outbox.ID))
	}
	_, err = tx.AuditDrainDelivery.CreateBulk(builders...).Save(ctx)
	return err
}
