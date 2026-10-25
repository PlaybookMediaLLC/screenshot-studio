package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ChannelConnection maps the application-owned social destination record.
type ChannelConnection struct{ ent.Schema }

func (ChannelConnection) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "channel_connection"}}
}

func (ChannelConnection) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("provider").StorageKey("provider").Default("social").Immutable(),
		field.String("external_account_id").StorageKey("externalAccountId").NotEmpty().Immutable(),
		field.String("platform").StorageKey("platform").Default("x"),
		field.JSON("provider_settings", map[string]any{}).StorageKey("providerSettings").Default(map[string]any{}),
		field.String("secret_reference").StorageKey("secretReference").NotEmpty(),
		field.Enum("status").StorageKey("status").Values("ACTIVE", "DISABLED", "REVOKED").Default("ACTIVE"),
		// The account as its platform shows it, read from the social API: name, @handle, avatar.
		field.String("display_name").StorageKey("displayName").Optional().Nillable(),
		field.String("handle").StorageKey("handle").Optional().Nillable(),
		field.String("avatar_url").StorageKey("avatarUrl").Optional().Nillable(),
		// The social set the account belongs to (RFC 024); one active account per platform in a set.
		field.String("social_set_id").StorageKey("socialSetId").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (ChannelConnection) Edges() []ent.Edge {
	return []ent.Edge{edge.To("scheduled_posts", ScheduledPost.Type)}
}

func (ChannelConnection) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "provider", "external_account_id").Unique(),
		index.Fields("organization_id", "created_at"),
	}
}
