package notifications

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/lucsky/cuid"
)

func notificationCategory(def activity.Definition) string {
	switch def.Group {
	case "comments", "mentions", "reviews":
		return "inbox"
	default:
		return "activity"
	}
}

// StateInput changes only the authenticated recipient's receipts. A bulk action
// applies to a statement snapshot; replaying its key never consumes new arrivals.
type StateInput struct {
	Action string   `json:"action"`
	View   string   `json:"view"`
	IDs    []string `json:"ids"`
	All    bool     `json:"all"`
	Key    string   `json:"key"`
}

type StateResult struct {
	Changed     int `json:"changed"`
	UnseenCount int `json:"unseenCount"`
}

type inboxCursor struct {
	Version int       `json:"v"`
	Org     string    `json:"org"`
	User    string    `json:"user"`
	View    string    `json:"view"`
	Before  time.Time `json:"before"`
	ID      string    `json:"id"`
}

func validView(view string) bool {
	return view == "all" || view == "inbox" || view == "activity" || view == "archive"
}

// Count excludes both read and archived receipts.
func (s *Service) Count(ctx context.Context, p Principal) (int, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return 0, err
	}
	return count(ctx, s.DB, p)
}

func count(ctx context.Context, db queryer, p Principal) (int, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT count(*) FROM platform_notification_inbox WHERE "organizationId"=$1 AND "userId"=$2 AND read_at IS NULL AND archived_at IS NULL`, p.OrganizationID, p.UserID).Scan(&n)
	return n, err
}

// List preserves the existing combined-feed entry point.
func (s *Service) List(ctx context.Context, p Principal, cursor string) (*Page, error) {
	return s.ListFeed(ctx, p, "all", cursor)
}

// ListFeed reads persistent recipient state without acknowledging it. A cursor
// belongs to one recipient and view, even if the caller changes workspaces.
func (s *Service) ListFeed(ctx context.Context, p Principal, view, cursor string) (*Page, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return nil, err
	}
	if !validView(view) || len(cursor) > 2048 {
		return nil, ErrInvalid
	}
	c := inboxCursor{Version: 1, Org: p.OrganizationID, User: p.UserID, View: view, Before: time.Now().Add(24 * time.Hour), ID: "~"}
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || json.Unmarshal(raw, &c) != nil || c.Version != 1 || c.Org != p.OrganizationID || c.User != p.UserID || c.View != view || c.Before.IsZero() || c.ID == "" || len(c.ID) > 128 {
			return nil, ErrInvalid
		}
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT i.id,i.kind,i.description,i.href,i.created_at,i.resource_type,i.resource_id,o.name,i.category,i.read_at,i.archived_at
		FROM platform_notification_inbox i JOIN organization o ON o.id=i."organizationId"
		WHERE i."organizationId"=$1 AND i."userId"=$2 AND (i.created_at,i.id)<($3,$4)
		AND (($5='archive' AND i.archived_at IS NOT NULL) OR ($5<>'archive' AND i.archived_at IS NULL AND ($5='all' OR i.category=$5)))
		ORDER BY i.created_at DESC,i.id DESC LIMIT 21`, p.OrganizationID, p.UserID, c.Before, c.ID, view)
	if err != nil {
		return nil, err
	}
	items := []Item{}
	for rows.Next() {
		var i Item
		i.WorkspaceID = p.OrganizationID
		if err = rows.Scan(&i.ID, &i.Kind, &i.Description, &i.Href, &i.CreatedAt, &i.resourceType, &i.resourceID, &i.WorkspaceName, &i.Category, &i.ReadAt, &i.ArchivedAt); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, i)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	page := &Page{Items: items}
	if len(items) > 20 {
		page.Items = items[:20]
		last := page.Items[19]
		c.Before, c.ID = last.CreatedAt, last.ID
		raw, err := json.Marshal(c)
		if err != nil {
			return nil, err
		}
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	for idx := range page.Items {
		item := &page.Items[idx]
		ok, _, err := s.resource(ctx, p.OrganizationID, p.UserID, item.resourceType, item.resourceID)
		if err != nil {
			return nil, err
		}
		if !ok {
			item.Description = "This activity is no longer available."
			item.Href = ""
		}
	}
	page.UnseenCount, err = count(ctx, s.DB, p)
	return page, err
}

// Seen is the compatibility endpoint: deleted reports the number acknowledged,
// but receipts now remain available in their feed until explicitly archived.
func (s *Service) Seen(ctx context.Context, p Principal, ids []string, all bool, key string) (*SeenResult, error) {
	if !all && key == "" {
		key = cuid.New()
	}
	result, err := s.ChangeState(ctx, p, StateInput{Action: "read", View: "all", IDs: ids, All: all, Key: key})
	if err != nil {
		return nil, err
	}
	return &SeenResult{Deleted: result.Changed, UnseenCount: result.UnseenCount}, nil
}

// ChangeState authorizes before reading or mutating receipts. Invalid or foreign
// IDs never reveal whether a receipt exists. No audit or delivery row is changed.
func (s *Service) ChangeState(ctx context.Context, p Principal, input StateInput) (*StateResult, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return nil, err
	}
	if !validView(input.View) || len(input.Key) < 16 || len(input.Key) > 128 || len(input.IDs) > 100 || input.All && len(input.IDs) != 0 || !input.All && len(input.IDs) == 0 {
		return nil, ErrInvalid
	}
	var update string
	switch input.Action {
	case "read":
		update = "read_at=now()"
	case "unread":
		update = "read_at=NULL"
	case "archive":
		update = "archived_at=now()"
	case "restore":
		update = "archived_at=NULL"
	default:
		return nil, ErrInvalid
	}
	input.IDs = append([]string{}, input.IDs...)
	for _, id := range input.IDs {
		if id == "" || len(id) > 128 {
			return nil, ErrInvalid
		}
	}
	slices.Sort(input.IDs)
	input.IDs = slices.Compact(input.IDs)
	// The key is excluded from its own fingerprint, but every mutation parameter is bound.
	canonical := input
	canonical.Key = ""
	raw, err := json.Marshal(canonical)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(raw)
	fingerprint := hex.EncodeToString(hash[:])
	for range 5 {
		result, err := s.changeStateTx(ctx, p, input, update, fingerprint)
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "40001" {
			return result, err
		}
	}
	return nil, errors.New("concurrent notification change; retry the same request")
}

func (s *Service) changeStateTx(ctx context.Context, p Principal, input StateInput, update, fingerprint string) (*StateResult, error) {
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, false); err != nil {
		return nil, err
	}
	result := &StateResult{}
	var id string
	err = tx.QueryRowContext(ctx, `INSERT INTO platform_notification_seen_action(id,"organizationId","userId",request_key,request_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, cuid.New(), p.OrganizationID, p.UserID, input.Key, fingerprint).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		var prior string
		err = tx.QueryRowContext(ctx, `SELECT deleted_count,request_fingerprint FROM platform_notification_seen_action WHERE "organizationId"=$1 AND "userId"=$2 AND request_key=$3`, p.OrganizationID, p.UserID, input.Key).Scan(&result.Changed, &prior)
		// Empty fingerprints are historical mark-all-seen receipts, never new actions.
		if err == nil && prior != fingerprint && !(prior == "" && input.All && input.Action == "read" && input.View == "all") {
			return nil, ErrInvalid
		}
	} else if err == nil {
		ids, _ := json.Marshal(input.IDs)
		var res sql.Result
		// update is a fixed fragment selected above, never caller-provided SQL.
		res, err = tx.ExecContext(ctx, `UPDATE platform_notification_inbox SET `+update+`
			WHERE "organizationId"=$1 AND "userId"=$2
			AND ($3 OR id IN (SELECT jsonb_array_elements_text($4::jsonb)))
			AND (($5='archive' AND archived_at IS NOT NULL) OR ($5<>'archive' AND archived_at IS NULL AND ($5='all' OR category=$5)))
			AND (($6='read' AND read_at IS NULL) OR ($6='unread' AND read_at IS NOT NULL) OR ($6='archive' AND archived_at IS NULL) OR ($6='restore' AND archived_at IS NOT NULL))`, p.OrganizationID, p.UserID, input.All, ids, input.View, input.Action)
		if err == nil {
			n, e := res.RowsAffected()
			err = e
			result.Changed = int(n)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, `UPDATE platform_notification_seen_action SET deleted_count=$2 WHERE id=$1`, id, result.Changed)
		}
	}
	if err != nil {
		return nil, err
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
