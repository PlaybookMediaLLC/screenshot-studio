package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/lucsky/cuid"
	"golang.org/x/net/html"
)

// LegacyMapping is an operator-verified identity mapping, never an email match.
type LegacyMapping struct {
	LegacyUserID string `json:"legacyUserId"`
	UserID       string `json:"userId"`
	Evidence     string `json:"evidence"`
}
type LegacyImport struct {
	WorkspaceID   string          `json:"workspaceId"`
	OperatorID    string          `json:"operatorId"`
	PreserveEmail bool            `json:"preserveEmail"`
	Mappings      []LegacyMapping `json:"mappings"`
}
type ImportResult struct{ Items, Copies, ReviewEvents int }

// ImportLegacy previews by default. Applying requires all active legacy recipients to be mapped.
// The caller must stop and drain old activity senders before applying this transaction.
func (s *Service) ImportLegacy(ctx context.Context, input LegacyImport, apply bool) (ImportResult, error) {
	result := ImportResult{}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var administrator string
	err = tx.QueryRowContext(ctx, `SELECT "userId" FROM member WHERE "organizationId"=$1 AND "userId"=$2 AND role IN ('owner','admin') FOR SHARE`, input.WorkspaceID, input.OperatorID).Scan(&administrator)
	if err != nil {
		return result, invalid("current administrator is required")
	}
	if len(input.Mappings) > 0 {
		var legacyOrg string
		err = tx.QueryRowContext(ctx, `SELECT "goOrganizationId" FROM social_tenant_binding WHERE "organizationId"=$1 FOR SHARE`, input.WorkspaceID).Scan(&legacyOrg)
		if err != nil {
			return result, invalid("verified tenant binding is required")
		}
		type member struct {
			user             string
			success, failure bool
		}
		members := map[string]member{}
		rows, err := tx.QueryContext(ctx, `SELECT u.id,u."sendSuccessEmails",u."sendFailureEmails" FROM "UserOrganization" m JOIN "User" u ON u.id=m."userId" WHERE m."organizationId"=$1 AND NOT m.disabled AND u."deletedAt" IS NULL FOR SHARE OF m,u`, legacyOrg)
		if err != nil {
			return result, err
		}
		for rows.Next() {
			var id string
			var m member
			if err = rows.Scan(&id, &m.success, &m.failure); err != nil {
				rows.Close()
				return result, err
			}
			members[id] = m
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return result, err
		}
		seen := map[string]bool{}
		for _, mapping := range input.Mappings {
			m, exists := members[mapping.LegacyUserID]
			if !exists || m.user != "" || seen[mapping.UserID] || strings.TrimSpace(mapping.Evidence) == "" {
				return result, invalid("identity mappings must be unique and have verification evidence")
			}
			var id string
			err = tx.QueryRowContext(ctx, `SELECT m."userId" FROM member m JOIN "user" u ON u.id=m."userId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND NOT coalesce(u.banned,false) FOR SHARE OF m,u`, input.WorkspaceID, mapping.UserID).Scan(&id)
			if err != nil {
				return result, invalid("mapped recipient must be a current workspace member")
			}
			m.user = id
			members[mapping.LegacyUserID] = m
			seen[id] = true
		}
		for _, m := range members {
			if m.user == "" {
				return result, invalid("unmapped legacy recipients remain; shared content was preserved")
			}
		}
		if len(members) == 0 {
			return result, invalid("no verified recipients; shared content was preserved")
		}
		type item struct {
			id, content string
			created     time.Time
		}
		items := []item{}
		rows, err = tx.QueryContext(ctx, `SELECT id,content,"createdAt" FROM "Notifications" WHERE "organizationId"=$1 AND "deletedAt" IS NULL ORDER BY id FOR UPDATE`, legacyOrg)
		if err != nil {
			return result, err
		}
		for rows.Next() {
			var i item
			if err = rows.Scan(&i.id, &i.content, &i.created); err != nil {
				rows.Close()
				return result, err
			}
			items = append(items, i)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return result, err
		}
		for _, item := range items {
			var event string
			err = tx.QueryRowContext(ctx, `INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey",notification_version,notification_fanned,"deliveredAt") VALUES($1,$2,'activity.legacy.imported','legacy_activity',$3,'{}',$4,0,true,now()) ON CONFLICT("organizationId","idempotencyKey") DO UPDATE SET notification_fanned=true RETURNING id`, cuid.New(), input.WorkspaceID, item.id, "legacy-notification:"+item.id).Scan(&event)
			if err != nil {
				return result, err
			}
			for _, m := range members {
				var receipt string
				err = tx.QueryRowContext(ctx, `INSERT INTO platform_notification_delivery(id,"organizationId",event_id,kind,channel,destination,status) VALUES($1,$2,$3,'legacy.imported','in_app',$4,'SUCCEEDED') ON CONFLICT DO NOTHING RETURNING id`, cuid.New(), input.WorkspaceID, event, m.user).Scan(&receipt)
				if errors.Is(err, sql.ErrNoRows) {
					continue
				}
				if err != nil {
					return result, err
				}
				_, err = tx.ExecContext(ctx, `INSERT INTO platform_notification_inbox(id,"organizationId","userId",event_id,kind,resource_type,resource_id,description,href,created_at) VALUES($1,$2,$3,$4,'legacy.imported','legacy_activity',$5,$6,'',$7)`, receipt, input.WorkspaceID, m.user, event, item.id, legacyText(item.content), item.created)
				if err != nil {
					return result, err
				}
				result.Copies++
			}
			if _, err = tx.ExecContext(ctx, `DELETE FROM "Notifications" WHERE id=$1 AND "organizationId"=$2`, item.id, legacyOrg); err != nil {
				return result, err
			}
			result.Items++
		}
		if input.PreserveEmail {
			defaults := map[string]Channels{"post.published": {InApp: true, Email: true}, "post.publish_failed": {InApp: true, Email: true}, "post.publish_recovery_required": {InApp: true, Email: true}}
			raw, _ := json.Marshal(defaults)
			_, err = tx.ExecContext(ctx, `INSERT INTO platform_notification_policy("organizationId",events,generation) VALUES($1,$2,2) ON CONFLICT("organizationId") DO UPDATE SET events=EXCLUDED.events||platform_notification_policy.events,generation=platform_notification_policy.generation+1`, input.WorkspaceID, raw)
			if err != nil {
				return result, err
			}
			for _, m := range members {
				raw, _ = json.Marshal(map[string]Channels{"post.published": {InApp: true, Email: m.success}, "post.publish_failed": {InApp: true, Email: m.failure}, "post.publish_recovery_required": {InApp: true, Email: m.failure}})
				_, err = tx.ExecContext(ctx, `INSERT INTO platform_notification_preference(id,"organizationId","userId",events,generation) VALUES($1,$2,$3,$4,2) ON CONFLICT("organizationId","userId") DO UPDATE SET events=EXCLUDED.events||platform_notification_preference.events,generation=platform_notification_preference.generation+1`, cuid.New(), input.WorkspaceID, m.user, raw)
				if err != nil {
					return result, err
				}
			}
		}
	}
	res, err := tx.ExecContext(ctx, `UPDATE outbox_event SET notification_version=1,payload=CASE WHEN attempts>0 THEN payload||'{"notificationLegacyUncertain":true}'::jsonb ELSE payload END WHERE "organizationId"=$1 AND notification_version=0 AND type IN ('campaign_posts.submitted','campaign_posts.decided') AND "deliveredAt" IS NULL`, input.WorkspaceID)
	if err != nil {
		return result, err
	}
	n, _ := res.RowsAffected()
	result.ReviewEvents = int(n)
	if !apply {
		return result, nil
	}
	if err = audit(ctx, tx, Principal{OrganizationID: input.WorkspaceID, UserID: input.OperatorID}, "notification.legacy_imported", input.WorkspaceID); err != nil {
		return result, err
	}
	return result, tx.Commit()
}

func legacyText(source string) string {
	tokens := html.NewTokenizer(strings.NewReader(source))
	var text strings.Builder
	for {
		switch tokens.Next() {
		case html.ErrorToken:
			return strings.Join(strings.Fields(text.String()), " ")
		case html.TextToken:
			text.Write(tokens.Text())
			text.WriteByte(' ')
		}
	}
}
