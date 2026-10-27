package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"time"
)

// PlatformDraftImport retains an actor-bound creation receipt even if its
// draft is deleted, preventing a delayed import retry from recreating content.
type PlatformDraftImport struct{ ent.Schema }

func (PlatformDraftImport) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "platform_draft_import"}}
}
func (PlatformDraftImport) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("draft_id").StorageKey("draftId").Immutable(),
		field.String("fingerprint").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
