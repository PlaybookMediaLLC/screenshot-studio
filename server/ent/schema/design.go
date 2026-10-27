package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Design is a versioned editor composition in the shared product database.
type Design struct{ ent.Schema }

func (Design) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "design"}}
}

func (Design) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Optional().Nillable(),
		field.String("parent_design_id").StorageKey("parentDesignId").Optional().Nillable(),
		field.String("name").StorageKey("name"),
		field.String("template_id").StorageKey("templateId").Optional().Nillable(),
		field.JSON("document", map[string]any{}).StorageKey("document"),
		field.String("rendered_asset_id").StorageKey("renderedAssetId").Optional().Nillable(),
		field.String("render_key").StorageKey("renderKey").Optional().Nillable(),
		field.String("plan_asset_key").StorageKey("planAssetKey").Optional().Nillable(),
		field.String("variant_label").StorageKey("variantLabel").Optional().Nillable(),
		field.Int("plan_version").StorageKey("planVersion").Optional().Nillable(),
		field.JSON("critique", map[string]any{}).StorageKey("critique").Optional(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Design) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "campaign_id", "created_at"),
		index.Fields("organization_id", "render_key"),
	}
}
