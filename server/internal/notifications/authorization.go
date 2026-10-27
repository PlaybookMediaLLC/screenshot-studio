package notifications

import (
	"context"
	"database/sql"
	"errors"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Hold membership and session context through a settings or OAuth commit.
func lockSessionMember(ctx context.Context, tx *sql.Tx, p Principal, admin bool) error {
	var id string
	err := tx.QueryRowContext(ctx, `SELECT m.id FROM member m JOIN "user" u ON u.id=m."userId" JOIN session s ON s."userId"=m."userId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND s.id=$3 AND s."activeOrganizationId"=$1 AND s."expiresAt">now() AND NOT coalesce(u.banned,false) AND (NOT $4 OR m.role IN ('owner','admin')) AND NOT EXISTS(SELECT 1 FROM workspace_deletion WHERE "organizationId"=$1 AND status<>'CANCELLED') FOR SHARE OF m,u,s`, p.OrganizationID, p.UserID, p.SessionID, admin).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return publishing.ErrForbidden
	}
	return err
}
