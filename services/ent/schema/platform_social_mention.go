package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PlatformSocialMention remembers identities actually used in a social set,
// independently of draft retention. A cached identity never grants provider access.
type PlatformSocialMention struct{ ent.Schema }

func (PlatformSocialMention) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_social_mention"}}
}
func (PlatformSocialMention) Fields() []ent.Field {
	return []ent.Field{
		field.String("id"), field.String("organization_id").StorageKey("organizationId"),
		field.String("social_set_id").StorageKey("socialSetId"),
		field.Enum("kind").Values("organization", "person"),
		field.String("provider_id").StorageKey("providerId"), field.String("label"),
		field.Time("last_used_at").StorageKey("lastUsedAt"),
	}
}
func (PlatformSocialMention) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "social_set_id", "kind", "provider_id").Unique(), index.Fields("organization_id", "social_set_id", "kind", "last_used_at")}
}
