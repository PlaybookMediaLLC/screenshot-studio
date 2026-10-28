package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

// GitHubProductionPolicy revisions are immutable. Source locking serializes
// edits with intake so an observation pins exactly one revision.
type GitHubProductionPolicy struct{ ent.Schema }

func (GitHubProductionPolicy) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "github_production_policy"}}
}
func (GitHubProductionPolicy) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(), field.String("source_app_id").StorageKey("sourceAppId").Immutable(),
		field.Int("revision").Immutable(), field.JSON("policy", releaseautomation.ProductionPolicy{}).Immutable(), field.String("created_by").StorageKey("createdBy").Immutable(), field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
func (GitHubProductionPolicy) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "source_app_id", "revision").Unique()}
}

// GitHubObservation stores safe provider facts and the pinned decision. It is
// not a release candidate and never implies a customer-availability claim.
type GitHubObservation struct{ ent.Schema }

func (GitHubObservation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "github_observation"}}
}
func (GitHubObservation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(), field.String("source_app_id").StorageKey("sourceAppId").Immutable(),
		field.String("semantic_key").StorageKey("semanticKey").Immutable(), field.String("object_key").StorageKey("objectKey").Immutable(), field.String("delivery_id").StorageKey("deliveryId").Immutable(),
		field.JSON("evidence", releaseautomation.GitHubEvidence{}).Immutable(), field.JSON("enrichment", &releaseautomation.GitHubEvidence{}).Optional(), field.String("policy_id").StorageKey("policyId").Optional().Nillable().Immutable(),
		field.String("workflow_version_id").StorageKey("workflowVersionId").Optional().Nillable().Immutable(), field.String("origin").Default("live").Immutable(),
		field.String("status").Default("received"), field.JSON("decision", releaseautomation.ProductionDecision{}).Default(releaseautomation.ProductionDecision{}),
		field.String("event_id").StorageKey("eventId").Optional().Nillable(), field.Int("duplicate_count").StorageKey("duplicateCount").Default(0),
		field.Time("occurred_at").StorageKey("occurredAt").Optional().Nillable().Immutable(), field.Time("received_at").StorageKey("receivedAt").Default(time.Now).Immutable(), field.Time("processed_at").StorageKey("processedAt").Optional().Nillable(),
	}
}
func (GitHubObservation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "source_app_id", "semantic_key").Unique(), index.Fields("organization_id", "source_app_id", "received_at"), index.Fields("organization_id", "source_app_id", "object_key", "occurred_at")}
}

// GitHubDeliveryRecovery is platform-scoped like GitHubInstallation. GUIDs
// marked for recovery suppress live effects for every watching workspace.
type GitHubDeliveryRecovery struct{ ent.Schema }

func (GitHubDeliveryRecovery) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "github_delivery_recovery"}}
}
func (GitHubDeliveryRecovery) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("guid").Immutable(), field.Int64("installation_id").StorageKey("installationId").Immutable(), field.String("repository_id").StorageKey("repositoryId").Immutable(), field.String("event_name").StorageKey("eventName").Immutable(), field.Time("delivered_at").StorageKey("deliveredAt").Immutable(),
		field.Int("status_code").StorageKey("statusCode"), field.Bool("recovery").Default(false), field.Int("attempts").Default(0), field.String("status").Default("failed"), field.Time("next_attempt_at").StorageKey("nextAttemptAt").Optional().Nillable(), field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (GitHubDeliveryRecovery) Indexes() []ent.Index {
	return []ent.Index{index.Fields("guid").Unique(), index.Fields("installation_id", "repository_id", "delivered_at")}
}

type GitHubRecoveryScan struct{ ent.Schema }

func (GitHubRecoveryScan) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "github_recovery_scan"}}
}
func (GitHubRecoveryScan) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(), field.String("source_app_id").StorageKey("sourceAppId").Immutable(),
		field.String("cursor").Default(""), field.String("status").Default("unknown"), field.String("reason").Default("Delivery history has not been inspected."), field.Bool("gap").Default(true),
		field.Time("window_start").StorageKey("windowStart").Optional().Nillable(), field.Time("last_complete_at").StorageKey("lastCompleteAt").Optional().Nillable(), field.Time("next_attempt_at").StorageKey("nextAttemptAt").Optional().Nillable(), field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (GitHubRecoveryScan) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "source_app_id").Unique()}
}
