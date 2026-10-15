package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Campaign is the canonical product campaign in the shared public schema.
type Campaign struct{ ent.Schema }

func (Campaign) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "campaign"}}
}

func (Campaign) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("objective").StorageKey("objective"),
		field.String("audience").StorageKey("audience").Optional().Nillable(),
		field.String("feature").StorageKey("feature").Optional().Nillable(),
		field.String("messaging").StorageKey("messaging").Optional().Nillable(),
		field.Enum("status").StorageKey("status").Values("DRAFT", "READY_FOR_REVIEW", "APPROVED", "ARCHIVED").Default("DRAFT"),
		field.String("release_id").StorageKey("releaseId").Optional().Nillable(),
		field.String("product_surface_id").StorageKey("productSurfaceId").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Campaign) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "created_at"),
		index.Fields("organization_id", "release_id"),
		index.Fields("organization_id", "product_surface_id"),
	}
}

type ContentAngle struct{ ent.Schema }

func (ContentAngle) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "content_angle"}}
}

func (ContentAngle) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Immutable(),
		field.String("title").StorageKey("title"),
		field.String("hook").StorageKey("hook"),
		field.Int("position").StorageKey("position"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (ContentAngle) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("campaign_id", "position").Unique(),
		index.Fields("organization_id", "created_at"),
	}
}

type CampaignAsset struct{ ent.Schema }

func (CampaignAsset) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "campaign_asset"}}
}

func (CampaignAsset) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Immutable(),
		field.String("asset_id").StorageKey("assetId").Immutable(),
		field.String("kind").StorageKey("kind"),
		field.String("caption").StorageKey("caption").Optional().Nillable(),
		field.String("plan_asset_key").StorageKey("planAssetKey").Optional().Nillable(),
		field.String("variant_label").StorageKey("variantLabel").Optional().Nillable(),
		field.Int("plan_version").StorageKey("planVersion").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (CampaignAsset) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("campaign_id", "asset_id").Unique(),
		index.Fields("organization_id", "campaign_id", "created_at"),
	}
}
