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

// ReleaseAutomation owns the editable draft; activated graphs live in immutable versions.
type ReleaseAutomation struct{ ent.Schema }

func (ReleaseAutomation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_automation"}}
}
func (ReleaseAutomation) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("source_app_id").StorageKey("sourceAppId").Immutable(),
		field.String("name"), field.String("description").Default(""), field.String("family").Immutable(),
		field.Int("priority").Default(0), field.Int("revision").Default(1), field.Bool("enabled").Default(false),
		field.Int("active_priority").StorageKey("activePriority").Default(0),
		field.String("active_version_id").StorageKey("activeVersionId").Optional().Nillable(),
		field.JSON("draft", releaseautomation.Graph{}),
		field.JSON("layout", map[string]releaseautomation.Position{}).Default(map[string]releaseautomation.Position{}),
		field.String("modified_by").StorageKey("modifiedBy"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (ReleaseAutomation) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "source_app_id", "family", "priority")}
}

type ReleaseAutomationVersion struct{ ent.Schema }

func (ReleaseAutomationVersion) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_automation_version"}}
}
func (ReleaseAutomationVersion) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("definition_id").StorageKey("definitionId").Immutable(), field.Int("revision").Immutable(),
		field.JSON("graph", releaseautomation.Graph{}).Immutable(), field.String("content_hash").StorageKey("contentHash").Immutable(),
		field.String("activated_by").StorageKey("activatedBy").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
func (ReleaseAutomationVersion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("definition_id", "revision").Unique(), index.Fields("organization_id", "created_at")}
}

// ReleaseSourceEvent is an immutable tenant snapshot. Candidate versions are
// pinned at acceptance, before enrichment or delayed dispatch can run.
type ReleaseSourceEvent struct{ ent.Schema }

func (ReleaseSourceEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_source_event"}}
}
func (ReleaseSourceEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("source_app_id").StorageKey("sourceAppId").Immutable(), field.String("semantic_key").StorageKey("semanticKey").Immutable(),
		field.String("delivery_id").StorageKey("deliveryId").Immutable(), field.JSON("snapshot", releaseautomation.Event{}).Immutable(),
		field.JSON("version_ids", []string{}).StorageKey("versionIds").Immutable(),
		field.Bool("collect_unmatched").StorageKey("collectUnmatched").Default(true).Immutable(),
		field.String("mode").Immutable(), field.String("disposition").Default("queued"), field.String("reason").Default(""),
		field.JSON("enrichment", map[string]releaseautomation.Value{}).Default(map[string]releaseautomation.Value{}),
		field.Time("enriched_at").StorageKey("enrichedAt").Optional().Nillable(),
		field.Time("received_at").StorageKey("receivedAt").Default(time.Now).Immutable(),
	}
}
func (ReleaseSourceEvent) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "source_app_id", "semantic_key").Unique(), index.Fields("organization_id", "received_at")}
}

type ReleaseAutomationRun struct{ ent.Schema }

func (ReleaseAutomationRun) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_automation_run"}}
}
func (ReleaseAutomationRun) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(), field.String("event_id").StorageKey("eventId").Immutable(),
		field.String("definition_id").StorageKey("definitionId").Optional().Nillable(), field.String("version_id").StorageKey("versionId").Optional().Nillable(),
		field.String("workflow_id").StorageKey("workflowId").Immutable(), field.String("temporal_run_id").StorageKey("temporalRunId").Default(""),
		field.String("status").Default("queued"), field.Bool("cancel_requested").StorageKey("cancelRequested").Default(false),
		field.Int("recovery_attempt").StorageKey("recoveryAttempt").Default(0),
		field.String("failure_code").StorageKey("failureCode").Default(""), field.String("reason").Default(""),
		field.JSON("outputs", releaseautomation.Outputs{}).Default(releaseautomation.Outputs{}),
		field.Time("started_at").StorageKey("startedAt").Optional().Nillable(), field.Time("completed_at").StorageKey("completedAt").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(), field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (ReleaseAutomationRun) Indexes() []ent.Index {
	return []ent.Index{index.Fields("event_id").Unique(), index.Fields("workflow_id").Unique(), index.Fields("organization_id", "status", "created_at")}
}

type ReleaseAutomationNode struct{ ent.Schema }

func (ReleaseAutomationNode) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_automation_node"}}
}
func (ReleaseAutomationNode) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.String("organization_id").StorageKey("organizationId").Immutable(), field.String("run_id").StorageKey("runId").Immutable(),
		field.String("node_id").StorageKey("nodeId").Immutable(), field.String("action_key").StorageKey("actionKey").Immutable(),
		field.String("status").Default("running"), field.Int("attempts").Default(1), field.String("failure_code").StorageKey("failureCode").Default(""),
		field.JSON("decision", releaseautomation.Decision{}).Optional(), field.JSON("outputs", releaseautomation.Outputs{}).Default(releaseautomation.Outputs{}),
		// Paid generation persists the model output, then marks the charge,
		// before applying it, so retries never call or bill twice.
		field.JSON("generation", &releaseautomation.Generation{}).Optional(), field.Bool("charged").Default(false),
		field.Time("started_at").StorageKey("startedAt").Default(time.Now).Immutable(), field.Time("completed_at").StorageKey("completedAt").Optional().Nillable(),
	}
}
func (ReleaseAutomationNode) Indexes() []ent.Index {
	return []ent.Index{index.Fields("run_id", "node_id").Unique(), index.Fields("organization_id", "action_key").Unique()}
}

// ReleaseAutomationExecutor is a short capability lease published by a running
// worker; an environment flag alone is not evidence of an available executor.
type ReleaseAutomationExecutor struct{ ent.Schema }

func (ReleaseAutomationExecutor) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_automation_executor"}}
}
func (ReleaseAutomationExecutor) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(), field.Int("schema_version").StorageKey("schemaVersion").Immutable(),
		field.JSON("capabilities", []string{}).Default([]string{}),
		field.Time("expires_at").StorageKey("expiresAt"),
	}
}
