package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// WebhookSubscription is a workspace's outbound endpoint (RFC 024): the
// events it receives and its signing secret, encrypted at rest.
type WebhookSubscription struct{ ent.Schema }

func (WebhookSubscription) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "webhook_subscription"}}
}

func (WebhookSubscription) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("url").StorageKey("url"),
		field.JSON("events", []string{}).StorageKey("events"),
		field.Bool("enabled").StorageKey("enabled").Default(true),
		field.String("encrypted_secret").StorageKey("encryptedSecret").Sensitive(),
		// After a rotation the previous secret also signs until it expires.
		field.String("previous_encrypted_secret").StorageKey("previousEncryptedSecret").Optional().Nillable().Sensitive(),
		field.Time("previous_secret_expires_at").StorageKey("previousSecretExpiresAt").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
		field.Time("last_success_at").StorageKey("lastSuccessAt").Optional().Nillable(),
		field.Time("last_failure_at").StorageKey("lastFailureAt").Optional().Nillable(),
	}
}

func (WebhookSubscription) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "created_at")}
}

// WebhookDelivery is one event owed to one subscription. The body is the exact
// bytes signed, so a retry or replay sends the same thing.
type WebhookDelivery struct{ ent.Schema }

func (WebhookDelivery) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "webhook_delivery"}}
}

func (WebhookDelivery) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("subscription_id").StorageKey("subscriptionId").Immutable(),
		field.String("event_id").StorageKey("eventId").Immutable(),
		field.String("event_type").StorageKey("eventType").Immutable(),
		field.String("body").StorageKey("body").Immutable(),
		field.Enum("status").StorageKey("status").Values("PENDING", "SENDING", "SUCCEEDED", "DEAD").Default("PENDING"),
		field.Int("attempts").StorageKey("attempts").Default(0),
		field.Time("next_attempt_at").StorageKey("nextAttemptAt").Default(time.Now),
		field.Time("lease_until").StorageKey("leaseUntil").Optional().Nillable(),
		field.Time("last_attempt_at").StorageKey("lastAttemptAt").Optional().Nillable(),
		field.Int("response_status").StorageKey("responseStatus").Optional().Nillable(),
		field.String("error_class").StorageKey("errorClass").Optional().Nillable(),
		// A replay an admin asked for: it is tried once, not retried.
		field.Bool("manual").StorageKey("manual").Default(false),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (WebhookDelivery) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("subscription_id", "event_id").Unique(),
		index.Fields("status", "next_attempt_at"),
		index.Fields("subscription_id", "created_at"),
	}
}

// WebhookDeliveryAttempt is one try at a delivery: when, how long, and what
// came back. It never holds the secret or the response body.
type WebhookDeliveryAttempt struct{ ent.Schema }

func (WebhookDeliveryAttempt) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "webhook_delivery_attempt"}}
}

func (WebhookDeliveryAttempt) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("delivery_id").StorageKey("deliveryId").Immutable(),
		field.Int("attempt_number").StorageKey("attemptNumber").Immutable(),
		field.Time("started_at").StorageKey("startedAt").Immutable(),
		field.Int("duration_ms").StorageKey("durationMs").Immutable(),
		field.Enum("outcome").StorageKey("outcome").Values("SUCCEEDED", "FAILED").Immutable(),
		field.Int("response_status").StorageKey("responseStatus").Optional().Nillable().Immutable(),
		field.String("error_class").StorageKey("errorClass").Optional().Nillable().Immutable(),
	}
}

func (WebhookDeliveryAttempt) Indexes() []ent.Index {
	return []ent.Index{index.Fields("delivery_id", "attempt_number").Unique()}
}
