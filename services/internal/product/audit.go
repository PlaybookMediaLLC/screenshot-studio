package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type AuditLogQuery struct {
	Action           string
	ActorUserID      string
	Cursor           string
	EndDate          *time.Time
	EntityType       string
	IPHash           string
	Limit            int
	Outcome          string
	Search           string
	StartDate        *time.Time
	UserAgentSummary string
}

type AuditLogItem struct {
	ID               string         `json:"id"`
	OrganizationID   string         `json:"organizationId"`
	CreatedAt        time.Time      `json:"createdAt"`
	RequestID        string         `json:"requestId"`
	ActorType        string         `json:"actorType"`
	ActorUserID      *string        `json:"actorUserId"`
	ActorDisplay     *string        `json:"actorDisplay"`
	Action           string         `json:"action"`
	Outcome          string         `json:"outcome"`
	EntityType       string         `json:"entityType"`
	EntityID         *string        `json:"entityId"`
	IPHash           *string        `json:"ipHash"`
	UserAgentSummary *string        `json:"userAgentSummary"`
	Metadata         map[string]any `json:"metadata"`
	SearchText       string         `json:"searchText"`
}

type AuditLogPage struct {
	Items      []AuditLogItem `json:"items"`
	NextCursor *string        `json:"nextCursor,omitempty"`
}

func (c *Configuration) ListAuditLogs(ctx context.Context, actor Actor, input AuditLogQuery) (*AuditLogPage, error) {
	if err := c.Authorize(ctx, actor); err != nil {
		return nil, err
	}
	if input.Limit < 1 || input.Limit > 100 {
		return nil, ErrInvalidInput
	}
	conditions := []predicate.AuditLog{auditlog.OrganizationID(actor.OrganizationID)}
	if input.Action != "" {
		conditions = append(conditions, auditlog.Action(input.Action))
	}
	if input.ActorUserID != "" {
		conditions = append(conditions, auditlog.ActorUserID(input.ActorUserID))
	}
	if input.EndDate != nil {
		conditions = append(conditions, auditlog.CreatedAtLTE(*input.EndDate))
	}
	if input.EntityType != "" {
		conditions = append(conditions, auditlog.EntityType(input.EntityType))
	}
	if input.Outcome != "" {
		conditions = append(conditions, auditlog.OutcomeEQ(auditlog.Outcome(input.Outcome)))
	}
	if input.Search != "" {
		conditions = append(conditions, auditlog.SearchTextContainsFold(input.Search))
	}
	if input.StartDate != nil {
		conditions = append(conditions, auditlog.CreatedAtGTE(*input.StartDate))
	}
	if input.Cursor != "" {
		cursor, err := c.client.AuditLog.Query().Where(auditlog.ID(input.Cursor), auditlog.OrganizationID(actor.OrganizationID)).Only(ctx)
		if ent.IsNotFound(err) {
			return nil, publishing.ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		conditions = append(conditions, auditlog.Or(auditlog.CreatedAtLT(cursor.CreatedAt),
			auditlog.And(auditlog.CreatedAtEQ(cursor.CreatedAt), auditlog.IDLT(cursor.ID))))
	}
	rows, err := c.client.AuditLog.Query().Where(conditions...).
		Order(ent.Desc(auditlog.FieldCreatedAt), ent.Desc(auditlog.FieldID)).Limit(input.Limit + 1).All(ctx)
	if err != nil {
		return nil, err
	}
	page := &AuditLogPage{Items: make([]AuditLogItem, 0, input.Limit)}
	hasMore := len(rows) > input.Limit
	if hasMore {
		rows = rows[:input.Limit]
	}
	for _, row := range rows {
		page.Items = append(page.Items, AuditLogItem{
			ID: row.ID, OrganizationID: row.OrganizationID, CreatedAt: row.CreatedAt,
			RequestID: row.RequestID, ActorType: string(row.ActorType), ActorUserID: row.ActorUserID,
			ActorDisplay: row.ActorDisplay, Action: row.Action, Outcome: string(row.Outcome),
			EntityType: row.EntityType, EntityID: row.EntityID, IPHash: row.IPHash,
			UserAgentSummary: row.UserAgentSummary, Metadata: row.Metadata, SearchText: row.SearchText,
		})
	}
	if hasMore {
		last := rows[len(rows)-1].ID
		page.NextCursor = &last
	}
	person, err := c.client.User.Get(ctx, actor.UserID)
	if err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := publishing.AppendAudit(ctx, tx, publishing.AuditInput{
		Action: "audit.log_read", Actor: publishing.Actor{Display: person.Email, RequestID: actor.RequestID, Type: "USER", UserID: actor.UserID},
		EntityType: "audit_log", IPHash: input.IPHash, Metadata: map[string]any{"resultCount": len(page.Items)},
		Organization: actor.OrganizationID, Outcome: auditlog.OutcomeSUCCEEDED, UserAgentSummary: input.UserAgentSummary,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return page, nil
}
