package maintenance

import (
	"context"
	"database/sql"
	"errors"

	"github.com/lucsky/cuid"
)

// assetCleanupCandidates are assets nothing can still use. An upload reserved
// a day ago never completed (its signed URL lasted two minutes; a resumable
// upload a day); a refused upload is kept an hour for its error; a provider
// derivative nothing has referenced for 30 days is regenerated on demand.
// The same predicate is rechecked under the row lock before anything changes.
const assetCleanupCandidates = `
 (a.status = 'PENDING' AND a."updatedAt" < now() - interval '24 hours')
 OR (a.status = 'FAILED' AND a."updatedAt" < now() - interval '1 hour')
 OR (a.status = 'UPLOADED' AND a."objectKey" LIKE 'org/' || a."organizationId" || '/derived/provider-images/%'
     AND a."updatedAt" < now() - interval '30 days' AND NOT platform_asset_in_use_v1(a."organizationId", a.id, true))`

// AssetCleanup retires abandoned uploads and unused derivatives. Each becomes
// DELETED with an asset.deleted outbox event in one transaction; the outbox
// job then deletes the object and retries until storage confirms, so a crash
// between the database and R2 leaves a retry, never a live row without bytes.
func (s *Store) AssetCleanup(ctx context.Context) (int, error) {
	candidates, err := ids(ctx, s.DB, `SELECT a.id FROM asset a WHERE `+assetCleanupCandidates+` ORDER BY a."updatedAt" LIMIT 200`)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, id := range candidates {
		err := transaction(ctx, s.DB, func(tx *sql.Tx) error {
			var org, status string
			err := tx.QueryRowContext(ctx, `SELECT a."organizationId", a.status FROM asset a WHERE a.id = $1 AND (`+assetCleanupCandidates+`) FOR UPDATE`, id).Scan(&org, &status)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE asset SET status = 'DELETED', "updatedAt" = now() WHERE id = $1`, id); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO outbox_event (id, "organizationId", type, "aggregateType", "aggregateId", payload, "idempotencyKey")
				VALUES ($1, $2, 'asset.deleted', 'asset', $3, jsonb_build_object('assetId', $3::text), 'asset.deleted:' || $3)
				ON CONFLICT ("organizationId", "idempotencyKey") DO NOTHING`, cuid.New(), org, id); err != nil {
				return err
			}
			count++
			return audit(ctx, tx, org, "product.asset_cleaned_up", "asset", id, "SUCCEEDED", map[string]any{"previousStatus": status})
		})
		if err != nil {
			return count, err
		}
	}
	return count, nil
}
