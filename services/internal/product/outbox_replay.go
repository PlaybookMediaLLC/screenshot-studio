package product

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// ReplayOutboxEvent returns a dead-lettered, undelivered event to the queue
// with a fresh retry budget; the maintenance worker dispatches it next.
// Facade-only: an operator replays by event ID, outside any tenant session.
func (c *Configuration) ReplayOutboxEvent(ctx context.Context, eventID string) error {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// The conditional update is the claim: concurrent replays audit once.
	replayed, err := tx.OutboxEvent.Update().Where(outboxevent.ID(eventID),
		outboxevent.DeadLetteredAtNotNil(), outboxevent.DeliveredAtIsNil()).
		SetAttempts(0).ClearDeadLetteredAt().ClearLastError().ClearProcessingAt().Save(ctx)
	if err != nil {
		return err
	}
	if replayed == 0 {
		return publishing.ErrNotFound
	}
	event, err := tx.OutboxEvent.Get(ctx, eventID)
	if err != nil {
		return err
	}
	if err := publishing.AppendAudit(ctx, tx, publishing.AuditInput{
		Action: "product.outbox_replayed", Actor: publishing.Actor{Display: event.ID, RequestID: event.ID, Type: "SERVICE"},
		EntityID: event.ID, EntityType: "outbox_event", Organization: event.OrganizationID,
		Outcome: auditlog.OutcomeSUCCEEDED,
	}); err != nil {
		return err
	}
	return tx.Commit()
}
