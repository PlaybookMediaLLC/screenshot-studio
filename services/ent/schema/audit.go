package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AuditLog is the shared enterprise audit record projection.
type AuditLog struct{ ent.Schema }

func (AuditLog) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "audit_log"}}
}
func (AuditLog) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.String("request_id").StorageKey("requestId").Immutable(),
		field.Enum("actor_type").StorageKey("actorType").Values("USER", "SERVICE", "SUPPORT", "WEBHOOK"),
		field.String("actor_user_id").StorageKey("actorUserId").Optional().Nillable(),
		field.String("actor_display").StorageKey("actorDisplay").Optional().Nillable(),
		field.String("action").StorageKey("action"),
		field.Enum("outcome").StorageKey("outcome").Values("SUCCEEDED", "FAILED", "DENIED").Default("SUCCEEDED"),
		field.String("entity_type").StorageKey("entityType"),
		field.String("entity_id").StorageKey("entityId").Optional().Nillable(),
		field.JSON("metadata", map[string]any{}).StorageKey("metadata").Optional(),
		field.String("search_text").StorageKey("searchText").Default(""),
	}
}
func (AuditLog) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "created_at", "id"),
		index.Fields("organization_id", "action", "created_at"),
		index.Fields("organization_id", "actor_user_id", "created_at"),
	}
}

type AuditDrain struct{ ent.Schema }

func (AuditDrain) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "audit_drain"}}
}
func (AuditDrain) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.Bool("enabled").StorageKey("enabled").Default(true),
	}
}

type AuditOutbox struct{ ent.Schema }

func (AuditOutbox) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "audit_outbox"}}
}
func (AuditOutbox) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("audit_log_id").StorageKey("auditLogId").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
func (AuditOutbox) Indexes() []ent.Index { return []ent.Index{index.Fields("audit_log_id").Unique()} }

type AuditDrainDelivery struct{ ent.Schema }

func (AuditDrainDelivery) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "audit_drain_delivery"}}
}
func (AuditDrainDelivery) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("drain_id").StorageKey("drainId").Immutable(),
		field.String("outbox_id").StorageKey("outboxId").Immutable(),
		field.Enum("status").StorageKey("status").Values("PENDING", "PROCESSING", "DELIVERED", "FAILED").Default("PENDING"),
		field.Int("attempt_count").StorageKey("attemptCount").Default(0),
		field.Time("next_attempt_at").StorageKey("nextAttemptAt").Default(time.Now),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (AuditDrainDelivery) Indexes() []ent.Index {
	return []ent.Index{index.Fields("drain_id", "outbox_id").Unique()}
}
