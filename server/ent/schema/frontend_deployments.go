package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/frontenddeploy"
	"time"
)

// FrontendSource is opt-in; existing source and capture behavior is not migrated.
type FrontendSource struct{ ent.Schema }

func (FrontendSource) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "frontend_source"}}
}
func (FrontendSource) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("provider").Immutable(), field.String("account_id").StorageKey("accountId").Immutable(), field.String("project_id").StorageKey("projectId").Immutable(),
		field.String("github_source_id").StorageKey("githubSourceId").Default(""),
		field.JSON("policy", frontenddeploy.Policy{}), field.Int("revision").Default(1), field.Bool("enabled").Default(false),
		field.String("encrypted_token").StorageKey("encryptedToken").Sensitive().Default(""), field.String("encrypted_secret").StorageKey("encryptedSecret").Sensitive().Default(""),
		field.Time("baseline_at").StorageKey("baselineAt").Default(time.Now).Immutable(), field.Time("effective_at").StorageKey("effectiveAt").Default(time.Now),
		field.Time("last_poll_at").StorageKey("lastPollAt").Optional().Nillable(), field.String("health").Default("baseline_pending"),
		field.JSON("checkpoint", map[string]string{}).Default(map[string]string{}), field.Time("updated_at").StorageKey("updatedAt").Default(time.Now),
	}
}
func (FrontendSource) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "provider", "account_id", "project_id").Unique(), index.Fields("enabled", "last_poll_at"), index.Fields("organization_id", "github_source_id")}
}

// FrontendObservation retains the decision made at receipt, including policies
// and provider times. Later evidence appends another observation.
type FrontendObservation struct{ ent.Schema }

func (FrontendObservation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "frontend_observation"}}
}
func (FrontendObservation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(), field.String("source_id").StorageKey("sourceId").Immutable(),
		field.String("event_key").StorageKey("eventKey").Immutable(), field.JSON("snapshot", frontenddeploy.Observation{}).Immutable(),
		field.JSON("policy", frontenddeploy.Policy{}).Immutable(), field.Int("policy_version").StorageKey("policyVersion").Immutable(), field.JSON("decision", frontenddeploy.Decision{}).Immutable(),
		field.Bool("historical").Immutable(), field.Time("occurred_at").StorageKey("occurredAt").Immutable(), field.Time("received_at").StorageKey("receivedAt").Default(time.Now).Immutable(), field.Time("processed_at").StorageKey("processedAt").Default(time.Now).Immutable(),
	}
}
func (FrontendObservation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("source_id", "event_key").Unique(), index.Fields("organization_id", "source_id", "received_at")}
}

// FrontendActivation separates a deployment object from its promotion/status
// occurrences. The first observation pins the policy for later checks.
type FrontendActivation struct{ ent.Schema }

func (FrontendActivation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "frontend_activation"}}
}
func (FrontendActivation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(), field.String("source_id").StorageKey("sourceId").Immutable(), field.String("activation_key").StorageKey("activationKey").Immutable(),
		field.String("commit_sha").StorageKey("commitSha").Default(""), field.JSON("snapshot", frontenddeploy.Observation{}), field.JSON("policy", frontenddeploy.Policy{}).Immutable(), field.Int("policy_version").StorageKey("policyVersion").Immutable(), field.JSON("decision", frontenddeploy.Decision{}),
		field.Bool("historical").Immutable(), field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(), field.Time("updated_at").StorageKey("updatedAt").Default(time.Now),
	}
}
func (FrontendActivation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("source_id", "activation_key").Unique(), index.Fields("organization_id", "source_id", "commit_sha"), index.Fields("organization_id", "created_at")}
}
