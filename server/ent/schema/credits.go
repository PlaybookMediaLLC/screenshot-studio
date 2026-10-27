package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// WorkspaceCreditGrant is a purchased pack of AI credits. A workspace draws on
// its grants, oldest first, once its monthly allowance is spent; grants do not
// expire. One grant per provider reference, so a replayed purchase is a no-op.
type WorkspaceCreditGrant struct{ ent.Schema }

func (WorkspaceCreditGrant) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "workspace_credit_grant"}}
}

func (WorkspaceCreditGrant) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("provider").StorageKey("provider").Immutable(),
		field.String("reference").StorageKey("reference").Immutable(),
		field.Int("credits").StorageKey("credits").Immutable(),
		field.Int("remaining").StorageKey("remaining"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (WorkspaceCreditGrant) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("provider", "reference").Unique(),
		index.Fields("organization_id", "created_at"),
	}
}
