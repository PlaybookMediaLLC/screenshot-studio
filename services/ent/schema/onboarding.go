package schema

import (
	"encoding/json"
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
)

// The background onboarding agent's records
// (docs/rfcs/032-background-onboarding-agent.md). Every row is workspace-scoped.

// OnboardingRun mirrors one onboarding workflow for the UI: its status, the
// stage it is on, monotonic progress, and the budgets it used.
type OnboardingRun struct{ ent.Schema }

func (OnboardingRun) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "onboarding_run"}}
}
func (OnboardingRun) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("url").StorageKey("url").Immutable(),
		field.Enum("status").StorageKey("status").Values("queued", "running", "completed", "partial", "failed", "cancelled").Default("queued"),
		field.String("stage").StorageKey("stage").Default("fast_path"),
		field.JSON("completed_stages", []string{}).StorageKey("completedStages").Default([]string{}),
		field.Int("progress").StorageKey("progress").Default(0),
		field.JSON("discovered_urls", []string{}).StorageKey("discoveredUrls").Default([]string{}),
		field.Int("pages_discovered").StorageKey("pagesDiscovered").Default(0),
		field.Int("pages_processed").StorageKey("pagesProcessed").Default(0),
		field.Int("pages_skipped").StorageKey("pagesSkipped").Default(0),
		field.Int("page_limit").StorageKey("pageLimit").Default(0),
		field.Int("tokens_used").StorageKey("tokensUsed").Default(0),
		field.Int("token_budget").StorageKey("tokenBudget").Default(0),
		field.Int64("enrichment_cost_micros").StorageKey("enrichmentCostMicros").Default(0),
		// What the run's model calls cost the platform; onboarding spends no AI credits.
		field.Int64("model_cost_micros").StorageKey("modelCostMicros").Default(0),
		field.Int("fast_path_ms").StorageKey("fastPathMs").Default(0),
		field.String("error_code").StorageKey("errorCode").Optional().Nillable(),
		field.String("error_message").StorageKey("errorMessage").Optional().Nillable(),
		field.String("idempotency_key").StorageKey("idempotencyKey").Immutable(),
		field.String("workflow_id").StorageKey("workflowId").Immutable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable().Immutable(),
		field.Time("started_at").StorageKey("startedAt").Default(time.Now).Immutable(),
		field.Time("completed_at").StorageKey("completedAt").Optional().Nillable(),
		field.Time("deadline_at").StorageKey("deadlineAt"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (OnboardingRun) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "idempotency_key").Unique(), index.Fields("organization_id", "created_at")}
}

// PageKnowledge is one crawled page of a workspace's product site, stored as
// text. The content hash lets a re-run skip pages that did not change.
type PageKnowledge struct{ ent.Schema }

func (PageKnowledge) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "page_knowledge"}}
}
func (PageKnowledge) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("run_id").StorageKey("runId"),
		field.String("url").StorageKey("url").Immutable(),
		field.String("title").StorageKey("title").Default(""),
		field.String("content_hash").StorageKey("contentHash"),
		field.Enum("page_type").StorageKey("pageType").Values("homepage", "pricing", "features", "docs", "changelog", "about", "other").Default("other"),
		field.Text("text").StorageKey("text").Default(""),
		field.Int("http_status").StorageKey("httpStatus").Default(0),
		field.String("etag").StorageKey("etag").Optional().Nillable(),
		field.String("last_modified").StorageKey("lastModified").Optional().Nillable(),
		field.Time("fetched_at").StorageKey("fetchedAt"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (PageKnowledge) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "url").Unique(), index.Fields("organization_id", "run_id")}
}

// IdealCustomerProfile is who a workspace sells to: one per workspace, each
// field with its source and confidence, and a person's edits locked.
type IdealCustomerProfile struct{ ent.Schema }

func (IdealCustomerProfile) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "ideal_customer_profile"}}
}
func (IdealCustomerProfile) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.JSON("personas", []profile.Persona{}).StorageKey("personas").Default([]profile.Persona{}),
		field.JSON("pains", []string{}).StorageKey("pains").Default([]string{}),
		field.JSON("jobs", []string{}).StorageKey("jobs").Default([]string{}),
		field.JSON("buying_triggers", []string{}).StorageKey("buyingTriggers").Default([]string{}),
		field.JSON("objections", []string{}).StorageKey("objections").Default([]string{}),
		field.JSON("channels", []string{}).StorageKey("channels").Default([]string{}),
		// Field name to where its value came from.
		field.JSON("provenance", map[string]profile.FieldProvenance{}).StorageKey("provenance").Default(map[string]profile.FieldProvenance{}),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (IdealCustomerProfile) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id").Unique()}
}

// EnrichmentRecord caches one third-party or first-party enrichment result
// for a workspace and domain until it expires, with what the call cost.
type EnrichmentRecord struct{ ent.Schema }

func (EnrichmentRecord) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "enrichment_record"}}
}
func (EnrichmentRecord) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("domain").StorageKey("domain").Immutable(),
		field.String("provider").StorageKey("provider").Immutable(),
		field.String("field").StorageKey("field").Immutable(),
		field.JSON("value", json.RawMessage{}).StorageKey("value"),
		field.Float("confidence").StorageKey("confidence").Default(0),
		field.String("source_url").StorageKey("sourceUrl").Optional().Nillable(),
		field.Time("fetched_at").StorageKey("fetchedAt"),
		field.Time("expires_at").StorageKey("expiresAt"),
		field.Int64("cost_micros").StorageKey("costMicros").Default(0),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (EnrichmentRecord) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "domain", "provider", "field").Unique()}
}
