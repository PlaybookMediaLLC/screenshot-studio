package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// OutboxEvent is the canonical product event queue projection.
type OutboxEvent struct{ ent.Schema }

func (OutboxEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "outbox_event"}}
}
func (OutboxEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("type").StorageKey("type"),
		field.String("aggregate_type").StorageKey("aggregateType"),
		field.String("aggregate_id").StorageKey("aggregateId"),
		field.JSON("payload", map[string]any{}).StorageKey("payload"),
		field.String("idempotency_key").StorageKey("idempotencyKey"),
		field.Time("delivered_at").StorageKey("deliveredAt").Optional().Nillable(),
		field.Time("processing_at").StorageKey("processingAt").Optional().Nillable(),
		field.Int("notification_version").Default(1),
		field.Bool("notification_fanned").Default(false),
		field.Int("attempts").StorageKey("attempts").Default(0),
		field.String("last_error").StorageKey("lastError").Optional().Nillable(),
		field.Time("dead_lettered_at").StorageKey("deadLetteredAt").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
func (OutboxEvent) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "idempotency_key").Unique(), index.Fields("organization_id", "created_at")}
}
