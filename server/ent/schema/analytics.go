package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"time"
)

// AnalyticsSnapshot retains provider observations; absent counters stay absent.
type AnalyticsSnapshot struct{ ent.Schema }

func (AnalyticsSnapshot) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "analytics_snapshot"}}
}
func (AnalyticsSnapshot) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("connection_id").StorageKey("connectionId").Immutable(),
		field.String("subject_id").StorageKey("subjectId").Immutable(),
		field.Enum("kind").Values("account", "post").Immutable(),
		field.Time("observed_at").StorageKey("observedAt").Immutable(),
		field.Time("collected_at").StorageKey("collectedAt").Default(time.Now).Immutable(),
		field.JSON("counters", map[string]float64{}).Immutable(),
		field.String("payload_hash").StorageKey("payloadHash").Immutable(),
		field.Int("age_minutes").StorageKey("ageMinutes").Default(0).Immutable(),
	}
}
func (AnalyticsSnapshot) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "connection_id", "kind", "observed_at"),
		index.Fields("connection_id", "kind", "subject_id", "observed_at", "payload_hash").Unique(),
	}
}

// AnalyticsPost identifies an individual published provider post, never a thread rollup.
type AnalyticsPost struct{ ent.Schema }

func (AnalyticsPost) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "analytics_post"}}
}
func (AnalyticsPost) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("connection_id").StorageKey("connectionId").Immutable(),
		field.String("remote_id").StorageKey("remoteId").Immutable(),
		field.String("scheduled_post_id").StorageKey("scheduledPostId").Optional().Nillable(),
		field.Time("canonical_updated_at").StorageKey("canonicalUpdatedAt").Optional().Nillable(),
		field.String("thread_root_id").StorageKey("threadRootId").Optional().Nillable(),
		field.Int("thread_position").StorageKey("threadPosition").Default(0),
		field.Bool("is_reply").StorageKey("isReply").Default(false),
		field.String("excerpt").Default(""),
		field.String("url").Default(""),
		field.Time("published_at").StorageKey("publishedAt").Immutable(),
		field.Time("discovered_at").StorageKey("discoveredAt").Default(time.Now).Immutable(),
		field.Time("checked_at").StorageKey("checkedAt").Optional().Nillable(),
		field.Time("next_check_at").StorageKey("nextCheckAt").Default(time.Now),
		field.Enum("availability").Values("insufficient", "available", "failed", "forbidden", "unsupported", "deleted").Default("insufficient"),
	}
}
func (AnalyticsPost) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("connection_id", "remote_id").Unique(),
		index.Fields("organization_id", "connection_id", "published_at", "id"),
		index.Fields("availability", "next_check_at"),
	}
}

// AnalyticsAccount holds collection state and separately versioned opt-in settings.
type AnalyticsAccount struct{ ent.Schema }

func (AnalyticsAccount) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "analytics_account"}}
}
func (AnalyticsAccount) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), // channel connection ID
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.Int("version").Default(1),
		field.Enum("availability").Values("insufficient", "available", "failed", "forbidden", "unsupported").Default("insufficient"),
		field.Time("checked_at").StorageKey("checkedAt").Optional().Nillable(),
		field.Time("next_check_at").StorageKey("nextCheckAt").Default(time.Now),
		field.Time("lease_until").StorageKey("leaseUntil").Optional().Nillable(),
		field.String("public_token").StorageKey("publicToken").Optional().Nillable().Unique(),
		field.JSON("goal", map[string]any{}).Default(map[string]any{}),
	}
}
func (AnalyticsAccount) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id"), index.Fields("next_check_at")}
}

// CalendarMutation keeps an idempotent mutation result and its bounded inverse.
type CalendarMutation struct{ ent.Schema }

func (CalendarMutation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "calendar_mutation"}}
}
func (CalendarMutation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("actor_id").StorageKey("actorId").Immutable(),
		field.String("input_hash").StorageKey("inputHash").Immutable(),
		field.JSON("result", map[string]any{}).Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
func (CalendarMutation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "created_at")}
}
