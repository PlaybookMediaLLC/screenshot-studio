package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
)

// ScheduledPost is the durable queue and state machine shared by both services.
type ScheduledPost struct{ ent.Schema }

func (ScheduledPost) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "scheduled_post"}}
}

func (ScheduledPost) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		// A post comes from exactly one source: a campaign's creative variant or
		// a hand-written content draft (RFC 037). A check constraint enforces it.
		field.String("variant_id").StorageKey("variantId").Optional().Nillable().Immutable(),
		field.String("content_draft_id").StorageKey("contentDraftId").Optional().Nillable().Immutable(),
		// A draft post's media. Variant posts take theirs from the variant.
		field.String("asset_id").StorageKey("assetId").Optional().Nillable().Immutable(),
		// Every image of a draft post, in order; asset_id is the first. Posts
		// scheduled before this column have only asset_id.
		field.JSON("asset_ids", []string{}).StorageKey("assetIds").Optional().Immutable(),
		// A thread's later posts, posted as replies to the first (X only).
		field.JSON("replies", []thread.Reply{}).StorageKey("replies").Optional().Immutable(),
		// The live post a resumed thread answers (a remote id); empty for a new post.
		field.String("reply_to").StorageKey("replyTo").Optional().Nillable().Immutable(),
		// After a post with replies goes out: how far the thread got.
		field.JSON("thread_progress", postoptions.ThreadProgress{}).StorageKey("threadProgress").Optional(),
		// The post's id on its platform, once live.
		field.String("remote_post_id").StorageKey("remotePostId").Optional().Nillable(),
		// Engagement, as last read from the platform.
		field.JSON("metrics", postoptions.Metrics{}).StorageKey("metrics").Optional(),
		field.Time("metrics_at").StorageKey("metricsAt").Optional().Nillable(),
		// Follow-ups once the post is live (X: repost, plug, quote).
		field.JSON("auto_actions", postoptions.AutoActions{}).StorageKey("autoActions").Optional().Immutable(),
		// A poll on the post (X).
		field.JSON("poll", postoptions.Poll{}).StorageKey("poll").Optional().Immutable(),
		field.String("channel_connection_id").StorageKey("channelConnectionId").Immutable(),
		field.Time("scheduled_for").StorageKey("scheduledFor"),
		field.Enum("status").StorageKey("status").Values("DRAFT", "SCHEDULED", "PROCESSING", "PUBLISHED", "FAILED", "CANCELLED", "UNKNOWN_DELIVERY").Default("DRAFT"),
		field.String("caption").StorageKey("caption"),
		field.String("idempotency_key").StorageKey("idempotencyKey").NotEmpty().Immutable(),
		field.String("trigger_run_id").StorageKey("triggerRunId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (ScheduledPost) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("channel_connection", ChannelConnection.Type).
			Ref("scheduled_posts").
			Field("channel_connection_id").
			Unique().
			Required().
			Immutable(),
		edge.To("attempts", PublicationAttempt.Type),
	}
}

func (ScheduledPost) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("channel_connection_id", "idempotency_key").Unique(),
		index.Fields("organization_id", "status", "scheduled_for"),
		index.Fields("status", "updated_at"),
		index.Fields("content_draft_id"),
	}
}
