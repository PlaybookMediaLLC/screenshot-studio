package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ContentDraftRevision is a saved point in a draft's history (RFC 037): the
// title and body as they were, kept at most every ten minutes of editing and
// on every schedule, so a writer can look back and restore one.
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
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable().Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (ContentDraftRevision) Indexes() []ent.Index {
	return []ent.Index{index.Fields("content_draft_id", "created_at")}
}
