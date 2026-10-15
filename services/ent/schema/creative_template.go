package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type CreativeTemplate struct{ ent.Schema }

func (CreativeTemplate) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "creative_template"}}
}

func (CreativeTemplate) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.Int("version").StorageKey("version"),
		field.JSON("definition", map[string]any{}).StorageKey("definition"),
		field.Enum("status").StorageKey("status").Values("DRAFT", "ACTIVE", "ARCHIVED").Default("DRAFT"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (CreativeTemplate) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "name", "version").Unique(),
		index.Fields("organization_id", "created_at")}
}
