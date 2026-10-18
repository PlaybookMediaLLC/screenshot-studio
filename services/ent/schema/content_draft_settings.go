package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// ContentDraftSettings is a workspace's drafts preferences (RFC 037): the
// weekly posting slots its queue fills, and whether a draft needs approval
// before it is scheduled. Times are in the workspace's time zone.
type ContentDraftSettings struct{ ent.Schema }

// QueueSlot is a weekly posting time: a weekday (0 is Sunday) and HH:MM.
type QueueSlot struct {
	Time    string `json:"time"`
	Weekday int    `json:"weekday"`
}

func (ContentDraftSettings) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "content_draft_settings"}}
}

func (ContentDraftSettings) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("organizationId").Immutable(),
		field.JSON("posting_slots", []QueueSlot{}).StorageKey("postingSlots"),
		field.Bool("require_approval").StorageKey("requireApproval").Default(false),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
