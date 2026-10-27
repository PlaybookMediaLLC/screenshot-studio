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

// ReleaseDocument is a revisioned announcement body for a release.
type ReleaseDocument struct{ ent.Schema }

func (ReleaseDocument) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_document"}}
}

func (ReleaseDocument) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("release_id").StorageKey("releaseId").Immutable(),
		field.Int("revision").StorageKey("revision"),
		field.JSON("front_matter", json.RawMessage{}).StorageKey("frontMatter"),
		field.String("body_markdown").StorageKey("bodyMarkdown"),
		field.Enum("status").StorageKey("status").Values("DRAFT", "APPROVED", "ARCHIVED").Default("DRAFT"),
		field.String("approved_by_user_id").StorageKey("approvedByUserId").Optional().Nillable(),
		field.Time("approved_at").StorageKey("approvedAt").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (ReleaseDocument) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("release_id", "revision").Unique(),
		index.Fields("organization_id", "created_at"),
	}
}

// CustomerCommunication is one scheduled release announcement.
type CustomerCommunication struct{ ent.Schema }

func (CustomerCommunication) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "customer_communication"}}
}

func (CustomerCommunication) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("release_document_id").StorageKey("releaseDocumentId"),
		field.Enum("channel").StorageKey("channel").Values("CHANGELOG", "IN_APP", "EMAIL", "SOCIAL"),
		field.String("audience_reference").StorageKey("audienceReference").Optional().Nillable(),
		field.Enum("status").StorageKey("status").
			Values("DRAFT", "SCHEDULED", "PROCESSING", "DELIVERED", "FAILED", "CANCELLED").Default("DRAFT"),
		field.Time("scheduled_for").StorageKey("scheduledFor").Optional().Nillable(),
		field.String("cta_url").StorageKey("ctaUrl").Optional().Nillable(),
		field.String("idempotency_key").StorageKey("idempotencyKey"),
		field.String("trigger_run_id").StorageKey("triggerRunId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (CustomerCommunication) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "idempotency_key").Unique(),
		index.Fields("organization_id", "status", "scheduled_for"),
	}
}

// CommunicationAttempt is one delivery attempt for an announcement.
type CommunicationAttempt struct{ ent.Schema }

func (CommunicationAttempt) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "communication_attempt"}}
}

func (CommunicationAttempt) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("customer_communication_id").StorageKey("customerCommunicationId").Immutable(),
		field.Int("attempt_number").StorageKey("attemptNumber"),
		field.Time("started_at").StorageKey("startedAt").Default(time.Now).Immutable(),
		field.Time("completed_at").StorageKey("completedAt").Optional().Nillable(),
		field.Enum("outcome").StorageKey("outcome").Values("SUCCEEDED", "FAILED").Optional().Nillable(),
		field.String("provider_message_id").StorageKey("providerMessageId").Optional().Nillable(),
		field.String("failure_code").StorageKey("failureCode").Optional().Nillable(),
	}
}

func (CommunicationAttempt) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("customer_communication_id", "attempt_number").Unique(),
		index.Fields("organization_id", "started_at"),
	}
}

// AudienceSubscriber is an announcement email recipient.
type AudienceSubscriber struct{ ent.Schema }

func (AudienceSubscriber) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "audience_subscriber"}}
}

func (AudienceSubscriber) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("email").StorageKey("email"),
		field.String("name").StorageKey("name").Optional().Nillable(),
		field.Time("unsubscribed_at").StorageKey("unsubscribedAt").Optional().Nillable(),
		field.Time("suppressed_at").StorageKey("suppressedAt").Optional().Nillable(),
		field.String("suppression_reason").StorageKey("suppressionReason").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (AudienceSubscriber) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "email").Unique(),
		index.Fields("organization_id", "unsubscribed_at", "suppressed_at"),
	}
}

// CommunicationRecipient is one addressed delivery of an announcement.
type CommunicationRecipient struct{ ent.Schema }

func (CommunicationRecipient) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "communication_recipient"}}
}

func (CommunicationRecipient) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("customer_communication_id").StorageKey("customerCommunicationId").Immutable(),
		field.String("subscriber_id").StorageKey("subscriberId").Optional().Nillable(),
		field.String("email").StorageKey("email"),
		field.Time("delivered_at").StorageKey("deliveredAt").Optional().Nillable(),
		field.String("provider_message_id").StorageKey("providerMessageId").Optional().Nillable(),
		field.String("failure_code").StorageKey("failureCode").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (CommunicationRecipient) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("customer_communication_id", "email").Unique(),
		index.Fields("organization_id", "delivered_at"),
	}
}
