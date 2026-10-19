package maintenance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func (s *Store) Outbox(ctx context.Context) (int, error) {
	// A crashed eighth attempt must become dead-lettered, not stranded forever.
	_, err := s.DB.ExecContext(ctx, `UPDATE outbox_event SET "processingAt"=NULL WHERE "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "processingAt" < now()-interval '10 minutes'`)
	if err != nil {
		return 0, err
	}
	candidates, err := ids(ctx, s.DB, `SELECT id FROM outbox_event WHERE "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "processingAt" IS NULL ORDER BY "createdAt" LIMIT 100`)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, id := range candidates {
		var org, kind, aggregate, resource string
		var attempts int
		err = s.DB.QueryRowContext(ctx, `UPDATE outbox_event e SET "processingAt"=now(),attempts=attempts+1 WHERE id=$1 AND "deliveredAt" IS NULL AND "deadLetteredAt" IS NULL AND "processingAt" IS NULL AND (("aggregateType"='asset' AND type='asset.deleted') OR NOT EXISTS(SELECT 1 FROM workspace_deletion w WHERE w."organizationId"=e."organizationId" AND w.status <> 'CANCELLED')) RETURNING "organizationId",type,"aggregateType","aggregateId",attempts`, id).Scan(&org, &kind, &aggregate, &resource, &attempts)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return count, err
		}
		var failure error
		switch {
		case attempts > 8:
			failure = fmt.Errorf("outbox retry budget exhausted after worker interruption")
		case strings.HasPrefix(kind, "activity."):
		// Notification delivery has independent processing state.
		case aggregate == "asset" && kind == "asset.deleted":
			var key string
			failure = s.DB.QueryRowContext(ctx, `SELECT "objectKey" FROM asset WHERE id=$1 AND "organizationId"=$2 AND status='DELETED'`, resource, org).Scan(&key)
			if failure == nil {
				failure = s.Objects.Delete(ctx, org, key)
			}
		case s.Events != nil && productEvent(kind):
			_, failure = s.Events.HandleOutboxEvent(ctx, id, org, kind, resource)
		default:
			var eligible bool
			if aggregate == "asset" && (kind == "asset.uploaded" || kind == "asset.generated") {
				failure = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM asset WHERE id=$1 AND "organizationId"=$2 AND status='UPLOADED')`, resource, org).Scan(&eligible)
			} else if aggregate == "release" {
				failure = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM release WHERE id=$1 AND "organizationId"=$2 AND status <> 'CANCELLED')`, resource, org).Scan(&eligible)
			}
			if failure == nil && !eligible {
				failure = fmt.Errorf("tenant resource is no longer eligible for dispatch")
			}
		}
		if ctx.Err() != nil {
			return count, ctx.Err()
		}
		err = transaction(ctx, s.DB, func(tx *sql.Tx) error {
			if failure == nil {
				if _, e := tx.ExecContext(ctx, `UPDATE outbox_event SET "deliveredAt"=now(),"lastError"=NULL,"processingAt"=NULL WHERE id=$1`, id); e != nil {
					return e
				}
				return audit(ctx, tx, org, "product.outbox_dispatched", "outbox_event", id, "SUCCEEDED", nil)
			}
			// Persist a stable error code; network errors may include credentialed URLs.
			if _, e := tx.ExecContext(ctx, `UPDATE outbox_event SET "processingAt"=NULL,"lastError"='DISPATCH_FAILED',"deadLetteredAt"=CASE WHEN attempts>=8 THEN now() ELSE NULL END WHERE id=$1`, id); e != nil {
				return e
			}
			if attempts >= 8 {
				return audit(ctx, tx, org, "product.outbox_dead_lettered", "outbox_event", id, "FAILED", map[string]any{"attempts": attempts, "failureCode": "DISPATCH_FAILED"})
			}
			return nil
		})
		if err != nil {
			return count, err
		}
		if failure == nil {
			count++
		}
	}
	return count, nil
}

// productEvent reports whether the product handles an event's side effect.
func productEvent(kind string) bool {
	switch kind {
	case "source_change.collected", "release.ingested", "source_app.connected", "deployment.succeeded",
		"campaign_posts.submitted", "campaign_posts.decided":
		return true
	}
	return false
}
