package schema

import (
	"encoding/json"
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Conversation is a workspace-visible chat that drives agent runs
// (docs/rfcs/017-conversational-campaign-creation.md). It is history, not
// state: the campaign it produced survives it.
type Conversation struct{ ent.Schema }

func (Conversation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "conversation"}}
}

func (Conversation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable().Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Optional().Nillable(),
		field.String("title").StorageKey("title"),
		field.Enum("status").StorageKey("status").Values("ACTIVE", "ARCHIVED").Default("ACTIVE"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Conversation) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "updated_at"),
		index.Fields("organization_id", "campaign_id", "updated_at"),
	}
}

// ConversationMessage is one turn of a conversation. The tool trace lives on
// the referenced run's steps, not here.
type ConversationMessage struct{ ent.Schema }

func (ConversationMessage) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "conversation_message"}}
}

func (ConversationMessage) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("conversation_id").StorageKey("conversationId").Immutable(),
		field.Enum("role").StorageKey("role").Values("user", "assistant", "tool").Immutable(),
		field.Enum("kind").StorageKey("kind").Values("text", "clarification", "tool").Immutable(),
		field.String("content").StorageKey("content").Immutable(),
		field.String("launch_run_id").StorageKey("launchRunId").Optional().Nillable(),
		field.String("tool_name").StorageKey("toolName").Optional().Nillable().Immutable(),
		field.JSON("metadata", json.RawMessage{}).StorageKey("metadata").Optional().Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (ConversationMessage) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "conversation_id", "created_at")}
}
