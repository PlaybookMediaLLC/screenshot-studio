package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Project is a saved editor composition a workspace keeps working on. Every
// document write bumps revision, so a writer holding an older revision is
// refused instead of overwriting newer work.
type Project struct{ ent.Schema }

func (Project) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "project"}}
}

func (Project) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.JSON("document", map[string]any{}).StorageKey("document"),
		field.Int("document_version").StorageKey("documentVersion"),
		field.Int("revision").StorageKey("revision").Default(1),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.String("updated_by_user_id").StorageKey("updatedByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Project) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "updated_at")}
}

// ProjectVersion is a snapshot of a project's document: an autosave
// checkpoint, a version the user named, a restore, or a duplicate's origin.
type ProjectVersion struct{ ent.Schema }

func (ProjectVersion) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "project_version"}}
}

func (ProjectVersion) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("project_id").StorageKey("projectId").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.Int("revision").StorageKey("revision").Immutable(),
		field.Enum("kind").StorageKey("kind").Values("autosave", "named", "restore", "duplicate").Immutable(),
		field.String("name").StorageKey("name").Optional().Nillable(),
		field.JSON("document", map[string]any{}).StorageKey("document").Immutable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable().Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (ProjectVersion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("project_id", "created_at")}
}
