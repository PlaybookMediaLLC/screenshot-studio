package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ContentDraft is a post a user writes by hand in the document editor, keeps
// as a draft, and schedules to one or more channels (RFC 037). Every write
// bumps version, so a writer holding an older version is refused instead of
// overwriting newer work.
type ContentDraft struct{ ent.Schema }

func (ContentDraft) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "content_draft"}}
}

func (ContentDraft) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("title").StorageKey("title"),
		// Plate JSON: the editor's value, a list of block nodes.
		field.JSON("body", []any{}).StorageKey("body"),
		field.String("plain_text").StorageKey("plainText"),
		field.JSON("asset_ids", []string{}).StorageKey("assetIds"),
		field.JSON("channel_connection_ids", []string{}).StorageKey("channelConnectionIds"),
		field.Enum("status").StorageKey("status").Values("draft", "scheduled", "archived").Default("draft"),
		field.Int("version").StorageKey("version").Default(1),
		// Yjs document state, written only by the collaboration service.
		field.Bytes("collab_state").StorageKey("collabState").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.String("updated_by_user_id").StorageKey("updatedByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (ContentDraft) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "updated_at")}
}
