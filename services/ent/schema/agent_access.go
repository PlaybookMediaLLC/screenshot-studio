package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AgentAuthorization is a member's consent for an AI agent, an OAuth client of
// the MCP authorization server, to act in their workspace (RFC 026). Its
// single-use code is exchanged for a workspace API key with exactly the
// approved scopes; the row then records which key it became.
type AgentAuthorization struct{ ent.Schema }

func (AgentAuthorization) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "agent_authorization"}}
}

func (AgentAuthorization) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("user_id").StorageKey("userId").Immutable(),
		field.String("client_id").StorageKey("clientId").Immutable(),
		field.String("client_name").StorageKey("clientName").Immutable(),
		field.String("redirect_uri").StorageKey("redirectUri").Immutable(),
		// SHA-256 of the code; the code itself is never stored.
		field.String("code_hash").StorageKey("codeHash").Immutable().Sensitive(),
		field.String("code_challenge").StorageKey("codeChallenge").Optional().Nillable().Immutable(),
		field.String("code_challenge_method").StorageKey("codeChallengeMethod").Optional().Nillable().Immutable(),
		field.Strings("scopes").StorageKey("scopes").Immutable(),
		field.String("resource").StorageKey("resource").Optional().Nillable().Immutable(),
		field.Int("key_expires_in_days").StorageKey("keyExpiresInDays").Optional().Nillable().Immutable(),
		field.Time("expires_at").StorageKey("expiresAt").Immutable(),
		field.Time("exchanged_at").StorageKey("exchangedAt").Optional().Nillable(),
		field.String("api_key_id").StorageKey("apiKeyId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (AgentAuthorization) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("code_hash").Unique(),
		index.Fields("organization_id", "created_at"),
	}
}
