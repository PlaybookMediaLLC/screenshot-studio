package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/lucsky/cuid"
)

// Seen retains the old acknowledgment entry point for existing clients.
func (s *Service) Seen(ctx context.Context, p Principal, ids []string, all bool, key string) (*SeenResult, error) {
	return s.changeSeen(ctx, p, ids, all, key, false, true)
}

// SetSeen changes exactly one recipient row. A later explicit action supersedes bulk undo.
func (s *Service) SetSeen(ctx context.Context, p Principal, id string, seen bool) (*SeenResult, error) {
	return s.changeSeen(ctx, p, []string{id}, false, "", false, seen)
}

// UndoSeen reverses only still-current changes belonging to this member's bulk action.
func (s *Service) UndoSeen(ctx context.Context, p Principal, key string) (*SeenResult, error) {
	return s.changeSeen(ctx, p, nil, true, key, true, false)
}

func (s *Service) changeSeen(ctx context.Context, p Principal, ids []string, all bool, key string, undo, seen bool) (*SeenResult, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return nil, err
	}
	if len(ids) > 100 || all && (len(key) < 16 || len(key) > 128 || len(ids) > 0) || !all && len(ids) == 0 {
		return nil, ErrInvalid
	}
	for _, id := range ids {
		if len(id) == 0 || len(id) > 128 {
			return nil, ErrInvalid
		}
	}
	for attempt := 0; attempt < 5; attempt++ {
		result, err := s.changeSeenTx(ctx, p, ids, all, key, undo, seen)
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "40001" {
			return result, err
		}
	}
	return nil, errors.New("concurrent acknowledgment; retry the same request")
}

func (s *Service) changeSeenTx(ctx context.Context, p Principal, ids []string, all bool, key string, undo, seen bool) (*SeenResult, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, false); err != nil {
		return nil, err
	}
	result := &SeenResult{}
	var res sql.Result
	if all {
		var action string
		if undo {
			// Claim the receipt once. New arrivals and subsequent per-item actions have a different marker.
			err = tx.QueryRowContext(ctx, `UPDATE platform_notification_seen_action SET undone_at=now() WHERE "organizationId"=$1 AND "userId"=$2 AND request_key=$3 AND undone_at IS NULL RETURNING id`, p.OrganizationID, p.UserID, key).Scan(&action)
			if err == nil {
				res, err = tx.ExecContext(ctx, `UPDATE platform_notification_inbox SET seen_at=NULL,seen_action_id='' WHERE "organizationId"=$1 AND "userId"=$2 AND seen_action_id=$3`, p.OrganizationID, p.UserID, action)
			}
		} else {
			err = tx.QueryRowContext(ctx, `INSERT INTO platform_notification_seen_action(id,"organizationId","userId",request_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, cuid.New(), p.OrganizationID, p.UserID, key).Scan(&action)
			if err == nil {
				res, err = tx.ExecContext(ctx, `UPDATE platform_notification_inbox SET seen_at=now(),seen_action_id=$3 WHERE "organizationId"=$1 AND "userId"=$2 AND seen_at IS NULL`, p.OrganizationID, p.UserID, action)
				if err == nil {
					n, e := res.RowsAffected()
					err = e
					result.Updated = int(n)
				}
				if err == nil {
					_, err = tx.ExecContext(ctx, `UPDATE platform_notification_seen_action SET deleted_count=$2 WHERE id=$1`, action, result.Updated)
				}
			} else if errors.Is(err, sql.ErrNoRows) {
				err = tx.QueryRowContext(ctx, `SELECT deleted_count FROM platform_notification_seen_action WHERE "organizationId"=$1 AND "userId"=$2 AND request_key=$3`, p.OrganizationID, p.UserID, key).Scan(&result.Updated)
			}
		}
		if errors.Is(err, sql.ErrNoRows) && undo {
			err = nil
		}
	} else {
		raw, _ := json.Marshal(ids)
		var at *time.Time
		if seen {
			now := time.Now()
			at = &now
		}
		res, err = tx.ExecContext(ctx, `UPDATE platform_notification_inbox SET seen_at=$4,seen_action_id='' WHERE "organizationId"=$1 AND "userId"=$2 AND id IN (SELECT jsonb_array_elements_text($3::jsonb))`, p.OrganizationID, p.UserID, raw, at)
	}
	if err != nil {
		return nil, err
	}
	if res != nil {
		n, e := res.RowsAffected()
		if e != nil {
			return nil, e
		}
		result.Updated = int(n)
	}
	result.UnseenCount, err = count(ctx, tx, p)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
