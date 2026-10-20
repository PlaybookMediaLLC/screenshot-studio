package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// SocialSet is a publishing identity inside a workspace (RFC 041): the
// connected accounts it posts as, at most one per platform, the platforms a
// new draft starts with, and who may write in it. Names need not be unique;
// the id is the identity.
type SocialSet struct{ ent.Schema }

// SocialSetPreferences are a set's writing and posting defaults.
type SocialSetPreferences struct {
	// Voice describes how the set writes, for the writing assistant.
	Voice string `json:"voice,omitempty"`
	// Audience describes who the set writes for.
	Audience string `json:"audience,omitempty"`
	// Samples are posts written in the set's voice.
	Samples []string `json:"samples,omitempty"`
	// NaturalTiming offsets scheduled posts by a stable few minutes.
	NaturalTiming bool `json:"naturalTiming,omitempty"`
}

func (SocialSet) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "social_set"}}
}

func (SocialSet) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("color").StorageKey("color").Default("sky"),
		// The workspace's first set; drafts without a set belong to it.
		field.Bool("is_default").StorageKey("isDefault").Default(false).Immutable(),
		field.JSON("channel_connection_ids", []string{}).StorageKey("channelConnectionIds").Default([]string{}),
		// The platforms a new draft enables, in order; the first is the primary.
		field.JSON("default_channels", []string{}).StorageKey("defaultChannels").Default([]string{}),
		field.String("time_zone").StorageKey("timeZone").Optional().Nillable(),
		// workspace: every member by role; restricted: owners, admins and member_user_ids.
		field.Enum("visibility").StorageKey("visibility").Values("workspace", "restricted").Default("workspace"),
		field.JSON("member_user_ids", []string{}).StorageKey("memberUserIds").Default([]string{}),
		field.JSON("preferences", SocialSetPreferences{}).StorageKey("preferences").Default(SocialSetPreferences{}),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (SocialSet) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "created_at")}
}

// ContentDraftTag labels drafts within one social set (RFC 041).
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

// ContentDraftFinisher is a reusable closing post for a thread (RFC 041). With
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
