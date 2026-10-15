package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// CampaignPost is the canonical campaign post in the shared public schema.
type CampaignPost struct{ ent.Schema }

func (CampaignPost) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "campaign_post"}}
}
func (CampaignPost) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Immutable(),
		field.String("angle_id").StorageKey("angleId").Optional().Nillable(),
		field.String("channel").StorageKey("channel"),
		field.String("copy").StorageKey("copy"),
		field.String("call_to_action").StorageKey("callToAction").Optional().Nillable(),
		field.String("title").StorageKey("title").Optional().Nillable(),
		field.String("phase").StorageKey("phase").Optional().Nillable(),
		field.String("plan_item_key").StorageKey("planItemKey").Optional().Nillable(),
		field.Int("spec_version").StorageKey("specVersion").Optional().Nillable(),
		field.Int("plan_version").StorageKey("planVersion").Optional().Nillable(),
		field.JSON("claims", []map[string]any{}).StorageKey("claims").Default([]map[string]any{}),
		field.String("review_note").StorageKey("reviewNote").Optional().Nillable(),
		field.Enum("status").StorageKey("status").Values("DRAFT", "READY_FOR_REVIEW", "APPROVED", "REJECTED", "NEEDS_CHANGES", "SCHEDULED", "PUBLISHED"),
		field.Time("scheduled_at").StorageKey("scheduledAt").Optional().Nillable(),
		field.String("creative_variant_id").StorageKey("creativeVariantId").Optional().Nillable(),
		field.String("scheduled_post_id").StorageKey("scheduledPostId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (CampaignPost) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "status"),
		index.Fields("campaign_id"),
		index.Fields("scheduled_post_id").Unique(),
	}
}

// WorkspaceEntitlement contains the billing decision fields; provider IDs do
// not leave the backend through the bootstrap API.
type WorkspaceEntitlement struct{ ent.Schema }

func (WorkspaceEntitlement) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "workspace_entitlement"}}
}
func (WorkspaceEntitlement) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("organizationId").Immutable(),
		field.String("plan").StorageKey("plan").Default("free"),
		field.String("status").StorageKey("status").Default("active"),
		field.JSON("feature_overrides", map[string]any{}).StorageKey("featureOverrides").Optional(),
		field.Time("valid_until").StorageKey("validUntil").Optional().Nillable(),
		field.Time("grace_until").StorageKey("graceUntil").Optional().Nillable(),
		field.Int("version").StorageKey("version").Default(1),
		field.String("provider").StorageKey("provider").Optional().Nillable(),
		field.String("external_customer_id").StorageKey("externalCustomerId").Optional().Nillable(),
		field.String("external_subscription_id").StorageKey("externalSubscriptionId").Optional().Nillable(),
		field.Time("last_synced_at").StorageKey("lastSyncedAt").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
