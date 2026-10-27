package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PlatformWorkspaceCreation records the committed outcome of a creation request.
// It survives organization deletion so a late retry cannot recreate the team.
type PlatformWorkspaceCreation struct{ ent.Schema }

func (PlatformWorkspaceCreation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_workspace_creation"}}
}

func (PlatformWorkspaceCreation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("user_id").StorageKey("userId").Immutable(),
		field.String("request_key").StorageKey("requestKey").MaxLen(128).Immutable(),
		field.String("request_hash").StorageKey("requestHash").MaxLen(64).Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (PlatformWorkspaceCreation) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "request_key").Unique(),
		index.Fields("organization_id").Unique(),
	}
}
