package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/draftdoc"
)

// ContentDraftRevision is a saved point in a draft's history (RFC 037): the
// title and body as they were, kept at most every ten minutes of editing and
// on every schedule, so a writer can look back and recover one. Snapshots are
// immutable; recovering one makes a new draft (RFC 042).
type ContentDraftRevision struct{ ent.Schema }

func (ContentDraftRevision) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "content_draft_revision"}}
}

func (ContentDraftRevision) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("content_draft_id").StorageKey("contentDraftId").Immutable(),
		field.Int("version").StorageKey("version").Immutable(),
		field.String("title").StorageKey("title").Immutable(),
		field.JSON("body", []any{}).StorageKey("body").Immutable(),
		field.String("plain_text").StorageKey("plainText").Immutable(),
		// Write (RFC 042): the platform versions and article as they were, and
		// why the snapshot was kept (edit, schedule, plan, publish, recovery).
		field.JSON("platform_versions", draftdoc.PlatformVersions{}).StorageKey("platformVersions").Optional().Immutable(),
		field.JSON("article", &draftdoc.Article{}).StorageKey("article").Optional().Immutable(),
		field.String("reason").StorageKey("reason").Default("edit").Immutable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable().Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (ContentDraftRevision) Indexes() []ent.Index {
	return []ent.Index{index.Fields("content_draft_id", "created_at")}
}
