package maintenance

import (
	"context"
	"database/sql"
	"errors"
)

// AccountDeletions carries out account deletion requests whose grace period
// has ended (RFC 043). A person who owns a live workspace again keeps the
// request open; it waits until they no longer do. Deletion signs the person out
// everywhere, removes their sign-in methods, preferences and memberships, and
// anonymizes the user row, which stays as the stable actor of audit history.
func (s *Store) AccountDeletions(ctx context.Context) (int, error) {
	due, err := ids(ctx, s.DB, `SELECT id FROM account_deletion_request WHERE status='REQUESTED' AND "executeAfter" <= now() ORDER BY "executeAfter" LIMIT 20`)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, id := range due {
		completed := false
		err := transaction(ctx, s.DB, func(tx *sql.Tx) error {
			var userID string
			err := tx.QueryRowContext(ctx, `SELECT "userId" FROM account_deletion_request WHERE id=$1 AND status='REQUESTED' AND "executeAfter" <= now() FOR UPDATE`, id).Scan(&userID)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			var owns bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM member m WHERE m."userId"=$1 AND m.role LIKE '%owner%'
				AND NOT EXISTS(SELECT 1 FROM workspace_deletion w WHERE w."organizationId"=m."organizationId" AND w.status IN ('PURGED','PROCESSING')))`, userID).Scan(&owns); err != nil {
				return err
			}
			if owns {
				return nil
			}
			rows, err := tx.QueryContext(ctx, `SELECT "organizationId" FROM member WHERE "userId"=$1`, userID)
			if err != nil {
				return err
			}
			var workspaces []string
			for rows.Next() {
				var org string
				if err := rows.Scan(&org); err != nil {
					rows.Close()
					return err
				}
				workspaces = append(workspaces, org)
			}
			if err := rows.Close(); err != nil {
				return err
			}
			for _, statement := range []string{
				`DELETE FROM session WHERE "userId"=$1`,
				`DELETE FROM account WHERE "userId"=$1`,
				`DELETE FROM "twoFactor" WHERE "userId"=$1`,
				`DELETE FROM social_oauth_start WHERE "userId"=$1`,
				`DELETE FROM user_preference WHERE "userId"=$1`,
				`DELETE FROM member WHERE "userId"=$1`,
				`UPDATE "user" SET name='Deleted user', email='deleted-' || id || '@deleted.invalid', "emailVerified"=false,
					image=NULL, "twoFactorEnabled"=false, "updatedAt"=now() WHERE id=$1`,
				`UPDATE account_deletion_request SET status='COMPLETED', "completedAt"=now() WHERE "userId"=$1 AND status='REQUESTED'`,
			} {
				if _, err := tx.ExecContext(ctx, statement, userID); err != nil {
					return err
				}
			}
			for _, org := range workspaces {
				if err := audit(ctx, tx, org, "product.account_deleted", "user", userID, "SUCCEEDED", nil); err != nil {
					return err
				}
			}
			completed = true
			return nil
		})
		if err != nil {
			return count, err
		}
		if completed {
			count++
		}
	}
	return count, nil
}
