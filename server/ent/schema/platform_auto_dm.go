package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// These models mirror the durable, disabled-by-default Auto-DM ledger. Claims
// use a transaction and an account advisory lock in internal/autodm.
type PlatformAutoDMCampaign struct{ ent.Schema }

func (PlatformAutoDMCampaign) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_auto_dm_campaign"}}
}
func (PlatformAutoDMCampaign) Fields() []ent.Field {
	return []ent.Field{
		field.String("id"), field.String("organization_id").StorageKey("organizationId"), field.String("account_id"), field.String("post_id"), field.JSON("snapshot", map[string]any{}), field.Time("published_at"), field.Bool("disabled").Default(false), field.Bool("source_removed").Default(false),
	}
}
func (PlatformAutoDMCampaign) Indexes() []ent.Index {
	return []ent.Index{index.Fields("id", "organization_id", "account_id").Unique(), index.Fields("organization_id", "account_id", "post_id").Unique(), index.Fields("account_id", "published_at")}
}

type PlatformAutoDMRecipient struct{ ent.Schema }

func (PlatformAutoDMRecipient) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_auto_dm_recipient"}}
}
func (PlatformAutoDMRecipient) Fields() []ent.Field {
	return []ent.Field{
		field.String("id"), field.String("organization_id").StorageKey("organizationId"), field.String("account_id"), field.String("campaign_id"), field.String("recipient_id"), field.JSON("snapshot", map[string]any{}), field.Time("observed_at"),
	}
}
func (PlatformAutoDMRecipient) Indexes() []ent.Index {
	return []ent.Index{index.Fields("campaign_id", "recipient_id").Unique()}
}

type PlatformAutoDMOptOut struct{ ent.Schema }

func (PlatformAutoDMOptOut) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_auto_dm_opt_out"}}
}
func (PlatformAutoDMOptOut) Fields() []ent.Field {
	return []ent.Field{
		field.String("id"), field.String("account_id"), field.String("recipient_id"), field.String("evidence_id"), field.Time("observed_at"),
	}
}
func (PlatformAutoDMOptOut) Indexes() []ent.Index {
	return []ent.Index{index.Fields("account_id", "recipient_id").Unique()}
}

type PlatformAutoDMDelivery struct{ ent.Schema }

func (PlatformAutoDMDelivery) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_auto_dm_delivery"}}
}
func (PlatformAutoDMDelivery) Fields() []ent.Field {
	return []ent.Field{
		field.String("id"), field.String("organization_id").StorageKey("organizationId"), field.String("account_id"), field.String("campaign_id"), field.String("recipient_id"), field.Enum("status").Values("reserved", "sent", "unknown").Default("reserved"), field.String("remote_id").Default(""), field.Time("created_at"),
	}
}
func (PlatformAutoDMDelivery) Indexes() []ent.Index {
	return []ent.Index{index.Fields("campaign_id", "recipient_id").Unique(), index.Fields("account_id", "created_at")}
}
