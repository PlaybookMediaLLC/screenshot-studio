package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type ProductSurface struct{ ent.Schema }

func (ProductSurface) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "product_surface"}}
}
func (ProductSurface) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("url").StorageKey("url"),
		field.String("environment").StorageKey("environment").Default("production"),
		field.String("description").StorageKey("description").Optional().Nillable(),
		field.JSON("feature_tags", []string{}).StorageKey("featureTags"),
		field.JSON("screenshot_asset_ids", []string{}).StorageKey("screenshotAssetIds"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (ProductSurface) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "name").Unique(), index.Fields("organization_id", "created_at")}
}
