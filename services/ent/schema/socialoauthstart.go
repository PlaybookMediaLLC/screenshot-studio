package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// SocialOAuthStart is a single-use authorization grant tied to the tenant,
// user, and session that initiated a provider connection.
type SocialOAuthStart struct{ ent.Schema }

func (SocialOAuthStart) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "social_oauth_start"}}
}

func (SocialOAuthStart) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("state").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("user_id").StorageKey("userId").Immutable(),
		field.String("session_id").StorageKey("sessionId").Immutable(),
		field.String("provider").StorageKey("provider").Immutable(),
		field.String("secret_reference").StorageKey("secretReference").Immutable().Sensitive(),
		field.String("integration_id").StorageKey("integrationId").Optional().Nillable(),
		// The social set the account joins when the callback completes (RFC 043).
		field.String("social_set_id").StorageKey("socialSetId").Optional().Nillable().Immutable(),
		field.Time("expires_at").StorageKey("expiresAt").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (SocialOAuthStart) Indexes() []ent.Index {
	return []ent.Index{index.Fields("expires_at")}
}
