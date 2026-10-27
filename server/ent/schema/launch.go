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

// ReleaseSpec is one versioned launch spec for a release brief.
type ReleaseSpec struct{ ent.Schema }

func (ReleaseSpec) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "release_spec"}}
}

func (ReleaseSpec) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("release_id").StorageKey("releaseId").Immutable(),
		field.Int("version").StorageKey("version").Immutable(),
		field.Enum("status").StorageKey("status").Values("DRAFT", "APPROVED", "SUPERSEDED").Default("DRAFT"),
		field.String("origin").StorageKey("origin"),
		field.JSON("content", json.RawMessage{}).StorageKey("content"),
		field.JSON("sources", json.RawMessage{}).StorageKey("sources").Default(json.RawMessage("[]")),
		field.String("change_summary").StorageKey("changeSummary").Optional().Nillable(),
		field.String("model_id").StorageKey("modelId").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.String("approved_by_user_id").StorageKey("approvedByUserId").Optional().Nillable(),
		field.Time("approved_at").StorageKey("approvedAt").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (ReleaseSpec) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("release_id", "version").Unique(),
		index.Fields("organization_id", "release_id", "created_at"),
	}
}

// CampaignPlan is one versioned launch plan for a campaign.
type CampaignPlan struct{ ent.Schema }

func (CampaignPlan) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "campaign_plan"}}
}

func (CampaignPlan) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Immutable(),
		field.String("spec_id").StorageKey("specId").Optional().Nillable(),
		field.Int("version").StorageKey("version").Immutable(),
		field.Enum("status").StorageKey("status").Values("DRAFT", "APPROVED", "SUPERSEDED").Default("DRAFT"),
		field.String("origin").StorageKey("origin"),
		field.JSON("content", json.RawMessage{}).StorageKey("content"),
		field.String("change_summary").StorageKey("changeSummary").Optional().Nillable(),
		field.String("model_id").StorageKey("modelId").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.String("approved_by_user_id").StorageKey("approvedByUserId").Optional().Nillable(),
		field.Time("approved_at").StorageKey("approvedAt").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (CampaignPlan) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("campaign_id", "version").Unique(),
		index.Fields("organization_id", "campaign_id", "created_at"),
	}
}

// CampaignRevision is an AI-proposed change awaiting a decision.
type CampaignRevision struct{ ent.Schema }

func (CampaignRevision) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "campaign_revision"}}
}

func (CampaignRevision) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Immutable(),
		field.String("target_type").StorageKey("targetType"),
		field.String("target_id").StorageKey("targetId"),
		field.String("target_key").StorageKey("targetKey").Optional().Nillable(),
		field.String("comment").StorageKey("comment"),
		field.Enum("status").StorageKey("status").Values("PROPOSED", "APPLIED", "DISCARDED").Default("PROPOSED"),
		field.JSON("proposal", json.RawMessage{}).StorageKey("proposal"),
		field.String("model_id").StorageKey("modelId").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.String("decided_by_user_id").StorageKey("decidedByUserId").Optional().Nillable(),
		field.Time("decided_at").StorageKey("decidedAt").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (CampaignRevision) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "campaign_id", "created_at"),
		index.Fields("organization_id", "status", "created_at"),
	}
}

// LaunchRun records one AI pipeline run for a campaign, or one agent run
// (docs/rfcs/027-ai-sdk-marketing-tools.md), which may start without one.
type LaunchRun struct{ ent.Schema }

func (LaunchRun) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "launch_run"}}
}

func (LaunchRun) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("campaign_id").StorageKey("campaignId").Optional().Nillable().Immutable(),
		field.String("kind").StorageKey("kind"),
		field.Enum("status").StorageKey("status").Values("RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "BUDGET_EXHAUSTED").Default("RUNNING"),
		field.String("result_id").StorageKey("resultId").Optional().Nillable(),
		field.String("summary").StorageKey("summary").Optional().Nillable(),
		field.String("error").StorageKey("error").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.Time("started_at").StorageKey("startedAt").Default(time.Now).Immutable(),
		field.Time("heartbeat_at").StorageKey("heartbeatAt").Optional().Nillable(),
		field.Time("finished_at").StorageKey("finishedAt").Optional().Nillable(),
		field.Int("step_count").StorageKey("stepCount").Default(0),
		field.Int("tokens_in").StorageKey("tokensIn").Default(0),
		field.Int("tokens_out").StorageKey("tokensOut").Default(0),
		field.Int("cost_cents").StorageKey("costCents").Default(0),
	}
}

func (LaunchRun) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "campaign_id", "started_at"),
		index.Fields("organization_id", "kind", "started_at"),
	}
}

// LaunchRunStep is one model call or tool call of a run: the reviewable trace.
// Summaries are stored redacted.
type LaunchRunStep struct{ ent.Schema }

func (LaunchRunStep) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "launch_run_step"}}
}

func (LaunchRunStep) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("run_id").StorageKey("runId").Immutable(),
		field.Int("index").StorageKey("index").Immutable(),
		field.Enum("kind").StorageKey("kind").Values("model", "tool").Immutable(),
		field.String("tool_name").StorageKey("toolName").Optional().Nillable().Immutable(),
		field.Enum("effect").StorageKey("effect").Values("read", "write", "render", "external", "approval-request").
			Optional().Nillable().Immutable(),
		field.Enum("status").StorageKey("status").Values("SUCCEEDED", "FAILED", "DENIED").Immutable(),
		field.String("error_code").StorageKey("errorCode").Optional().Nillable().Immutable(),
		field.JSON("input_summary", json.RawMessage{}).StorageKey("inputSummary").Optional().Immutable(),
		field.JSON("output_summary", json.RawMessage{}).StorageKey("outputSummary").Optional().Immutable(),
		field.Int("tokens_in").StorageKey("tokensIn").Default(0).Immutable(),
		field.Int("tokens_out").StorageKey("tokensOut").Default(0).Immutable(),
		field.Int("duration_ms").StorageKey("durationMs").Default(0).Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (LaunchRunStep) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("run_id", "index").Unique(),
		index.Fields("organization_id", "run_id"),
	}
}
