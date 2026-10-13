package maintenance

import (
	"context"
	"database/sql"
	"fmt"
)

func (s *Store) AuditRetention(ctx context.Context) (int, error) {
	if s.RetentionDB == nil {
		return 0, fmt.Errorf("AUDIT_RETENTION_DATABASE_URL is required")
	}
	organizations, err := ids(ctx, s.RetentionDB, `SELECT id FROM organization ORDER BY id`)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, org := range organizations {
		err = transaction(ctx, s.RetentionDB, func(tx *sql.Tx) error {
			// Re-evaluate legal hold in the deletion statement; no cached policy list.
			result, e := tx.ExecContext(ctx, `DELETE FROM audit_log a WHERE "organizationId"=$1 AND NOT EXISTS (SELECT 1 FROM audit_retention_policy p WHERE p."organizationId"=$1 AND p."legalHold") AND "createdAt" < now() - make_interval(days => COALESCE((SELECT "retentionDays" FROM audit_retention_policy WHERE "organizationId"=$1),90))`, org)
			if e != nil {
				return e
			}
			n, e := result.RowsAffected()
			if e != nil {
				return e
			}
			if n > 0 {
				if e = audit(ctx, tx, org, "product.audit_retention_purged", "audit_log", org, "SUCCEEDED", map[string]any{"deletedCount": n}); e != nil {
					return e
				}
			}
			total += int(n)
			return nil
		})
		if err != nil {
			return total, err
		}
	}
	return total, nil
}
