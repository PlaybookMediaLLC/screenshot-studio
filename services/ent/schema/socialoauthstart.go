package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// SocialOAuthStart binds a provider authorization and its replayable outcome
// to the tenant, user, session, and target that initiated it.
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
		field.Enum("operation").Values("CREATE_SET", "ADD_ACCOUNT", "RECONNECT").Default("ADD_ACCOUNT").Immutable(),
		// Creation binds visibility now; the owner is the initiating user above.
		field.String("creation_visibility").StorageKey("creationVisibility").Default("").Immutable(),
		field.String("created_social_set_id").StorageKey("createdSocialSetId").Optional().Nillable(),
		// Only safe provider identities and page labels are retained, never credentials.
		field.Enum("exchange_status").StorageKey("exchangeStatus").Values("PENDING", "EXCHANGING", "EXCHANGED", "COMPLETED").Default("PENDING"),
		field.JSON("exchange_receipt", SocialOAuthExchange{}).StorageKey("exchangeReceipt").Optional(),
		field.String("expected_connection_id").StorageKey("expectedConnectionId").Optional().Nillable().Immutable(),
		field.String("return_path").StorageKey("returnPath").Default("").Immutable(),
		field.String("completed_connection_id").StorageKey("completedConnectionId").Optional().Nillable(),
		field.Time("completed_at").StorageKey("completedAt").Optional().Nillable(),
		field.Time("expires_at").StorageKey("expiresAt").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (SocialOAuthStart) Indexes() []ent.Index {
	return []ent.Index{index.Fields("expires_at")}
}

// SocialOAuthPage is a provider-verified destination selection, without tokens.
type SocialOAuthPage struct {
	ID     string  `json:"id"`
	PageID string  `json:"pageId"`
	Name   *string `json:"name,omitempty"`
}

// SocialOAuthExchange is the safe result of consuming one provider callback.
type SocialOAuthExchange struct {
	Completed bool              `json:"completed,omitempty"`
	ID        string            `json:"id"`
	Pages     []SocialOAuthPage `json:"pages,omitempty"`
}
