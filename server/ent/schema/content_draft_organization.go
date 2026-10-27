package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ContentDraftTag labels drafts within one social set (RFC 025).
type ContentDraftTag struct{ ent.Schema }

func (ContentDraftTag) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "content_draft_tag"}}
}

func (ContentDraftTag) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("social_set_id").StorageKey("socialSetId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("color").StorageKey("color").Default("gray"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (ContentDraftTag) Indexes() []ent.Index {
	return []ent.Index{index.Fields("social_set_id", "created_at")}
}

// ContentDraftFinisher is a reusable closing post for a thread (RFC 025). With
// QuoteFirstPost, publishing quotes the thread's first post once it is live.
type ContentDraftFinisher struct{ ent.Schema }

func (ContentDraftFinisher) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "content_draft_finisher"}}
}

func (ContentDraftFinisher) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("social_set_id").StorageKey("socialSetId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("text").StorageKey("text"),
		field.Bool("quote_first_post").StorageKey("quoteFirstPost").Default(false),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (ContentDraftFinisher) Indexes() []ent.Index {
	return []ent.Index{index.Fields("social_set_id", "created_at")}
}
