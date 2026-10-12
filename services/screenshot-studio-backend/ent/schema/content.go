package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

type Tags struct{ ent.Schema }

func (Tags) Annotations() []schema.Annotation { return table("Tags") }

func (Tags) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("name", "name"), str("color", "color"), str("org_id", "orgId"),
		deletedAt(), createdAt(), updatedAt(),
	}
}

func (Tags) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("tags").Field("org_id").Unique().Required(),
		edge.From("postList", Post.Type).Ref("tagList").Through("posts", TagsPosts.Type),
	}
}

// TagsPosts is the Post <-> Tags join table with a composite primary key.
type TagsPosts struct{ ent.Schema }

func (TagsPosts) Annotations() []schema.Annotation {
	return append(table("TagsPosts"), field.ID("post_id", "tag_id"))
}

func (TagsPosts) Fields() []ent.Field {
	return []ent.Field{str("post_id", "postId"), str("tag_id", "tagId"), createdAt(), updatedAt()}
}

func (TagsPosts) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("post", Post.Type).Field("post_id").Unique().Required(),
		edge.To("tag", Tags.Type).Field("tag_id").Unique().Required(),
	}
}

type Media struct{ ent.Schema }

func (Media) Annotations() []schema.Annotation { return table("Media") }

func (Media) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("name", "name"),
		optStr("original_name", "originalName"),
		str("path", "path"),
		str("organization_id", "organizationId"),
		createdAt(),
		updatedAt(),
		deletedAt(),
		field.Int("file_size").StorageKey("fileSize").Default(0),
		field.String("type").StorageKey("type").Default("image"),
		optStr("thumbnail", "thumbnail"),
		optStr("alt", "alt"),
		optInt("thumbnail_timestamp", "thumbnailTimestamp"),
		field.String("status").StorageKey("status").Default("ready"),
		optStr("processing_error", "processingError"),
	}
}

func (Media) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("media").Field("organization_id").Unique().Required(),
		edge.To("agencies", SocialMediaAgency.Type),
		edge.To("userPicture", User.Type),
		edge.To("oauthApps", OAuthApp.Type),
	}
}

type SocialMediaAgency struct{ ent.Schema }

func (SocialMediaAgency) Annotations() []schema.Annotation { return table("SocialMediaAgency") }

func (SocialMediaAgency) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("user_id", "userId"),
		str("name", "name"),
		optStr("logo_id", "logoId"),
		optStr("website", "website"),
		optStr("slug", "slug"),
		optStr("facebook", "facebook"),
		optStr("instagram", "instagram"),
		optStr("twitter", "twitter"),
		optStr("linked_in", "linkedIn"),
		optStr("youtube", "youtube"),
		optStr("tiktok", "tiktok"),
		optStr("other_social_media", "otherSocialMedia"),
		str("short_description", "shortDescription"),
		str("description", "description"),
		field.Bool("approved").StorageKey("approved").Default(false),
		createdAt(),
		updatedAt(),
		deletedAt(),
	}
}

// SocialMediaAgencyNiche (composite key agencyId+niche, no id column) is not an
// Ent entity; the agencies repository reads and writes it with SQL.
func (SocialMediaAgency) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("logo", Media.Type).Ref("agencies").Field("logo_id").Unique(),
		edge.From("user", User.Type).Ref("agencies").Field("user_id").Unique().Required(),
	}
}

type Clipping struct{ ent.Schema }

func (Clipping) Annotations() []schema.Annotation { return table("Clipping") }

func (Clipping) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("organization_id", "organizationId"),
		str("url", "url"),
		field.String("status").StorageKey("status").Default("analysing"),
		optStr("error", "error"),
		optStr("title", "title"),
		optStr("thumbnail", "thumbnail"),
		optInt("duration", "duration"),
		field.Int("max_clips").StorageKey("maxClips").Default(5),
		field.String("fit").StorageKey("fit").Default("blur"),
		str("integrations", "integrations"),
		optStr("credits_id", "creditsId"),
		deletedAt(),
		createdAt(),
		updatedAt(),
	}
}

func (Clipping) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("clippings").Field("organization_id").Unique().Required(),
		edge.To("clips", ClippingClip.Type),
	}
}

type ClippingClip struct{ ent.Schema }

func (ClippingClip) Annotations() []schema.Annotation { return table("ClippingClip") }

func (ClippingClip) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("clipping_id", "clippingId"),
		str("title", "title"),
		str("content", "content"),
		field.Float("start").StorageKey("start"),
		field.Float("end").StorageKey("end"),
		optInt("trim_start", "trimStart"),
		field.String("status").StorageKey("status").Default("pending"),
		optStr("error", "error"),
		optStr("media_id", "mediaId"),
		optStr("path", "path"),
		optStr("thumbnail", "thumbnail"),
		optTime("drafted_at", "draftedAt"),
		createdAt(),
		updatedAt(),
	}
}

func (ClippingClip) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("clipping", Clipping.Type).Ref("clips").Field("clipping_id").Unique().Required(),
	}
}

type Signatures struct{ ent.Schema }

func (Signatures) Annotations() []schema.Annotation { return table("Signatures") }

func (Signatures) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("organization_id", "organizationId"), str("content", "content"),
		field.Bool("auto_add").StorageKey("autoAdd"), createdAt(), updatedAt(), deletedAt(),
	}
}

func (Signatures) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("signatures").Field("organization_id").Unique().Required(),
	}
}

type Comments struct{ ent.Schema }

func (Comments) Annotations() []schema.Annotation { return table("Comments") }

func (Comments) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("content", "content"),
		str("organization_id", "organizationId"),
		str("post_id", "postId"),
		optStr("user_id", "userId"),
		optStr("display_name", "displayName"),
		optStr("parent_id", "parentId"),
		optInt("anchor_start", "anchorStart"),
		optInt("anchor_end", "anchorEnd"),
		optStr("anchor_quote", "anchorQuote"),
		optTime("resolved_at", "resolvedAt"),
		createdAt(),
		updatedAt(),
		deletedAt(),
	}
}

func (Comments) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("Comments").Field("organization_id").Unique().Required(),
		edge.From("post", Post.Type).Ref("comments").Field("post_id").Unique().Required(),
		edge.From("user", User.Type).Ref("comments").Field("user_id").Unique(),
		edge.To("replies", Comments.Type).From("parent").Field("parent_id").Unique(),
	}
}

type Post struct{ ent.Schema }

func (Post) Annotations() []schema.Annotation { return table("Post") }

func (Post) Fields() []ent.Field {
	return []ent.Field{
		cuidID(),
		field.Enum("state").StorageKey("state").Values("QUEUE", "PUBLISHED", "ERROR", "DRAFT").Default("QUEUE"),
		field.Time("publish_date").StorageKey("publishDate"),
		str("organization_id", "organizationId"),
		str("integration_id", "integrationId"),
		str("content", "content"),
		field.Int("delay").StorageKey("delay").Default(0),
		str("group", "group"),
		optStr("batch_id", "batchId"),
		optStr("title", "title"),
		optStr("description", "description"),
		optStr("parent_post_id", "parentPostId"),
		optStr("release_id", "releaseId"),
		optStr("release_url", "releaseURL"),
		optStr("settings", "settings"),
		optStr("image", "image"),
		optStr("submitted_for_order_id", "submittedForOrderId"),
		optStr("submitted_for_organization_id", "submittedForOrganizationId"),
		field.Enum("approved_submit_for_order").StorageKey("approvedSubmitForOrder").Values("NO", "WAITING_CONFIRMATION", "YES").Default("NO"),
		field.Enum("creation_method").StorageKey("creationMethod").Values("UNKNOWN", "WEB", "MCP", "API", "AUTOPOST", "CLI").Default("UNKNOWN"),
		optStr("last_message_id", "lastMessageId"),
		optInt("interval_in_days", "intervalInDays"),
		optStr("error", "error"),
		createdAt(),
		updatedAt(),
		deletedAt(),
	}
}

func (Post) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("comments", Comments.Type),
		edge.To("errors", Errors.Type),
		edge.To("payoutProblems", PayoutProblems.Type),
		edge.From("integration", Integration.Type).Ref("posts").Field("integration_id").Unique().Required(),
		edge.From("lastMessage", Messages.Type).Ref("posts").Field("last_message_id").Unique(),
		edge.From("organization", Organization.Type).Ref("post").Field("organization_id").Unique().Required(),
		edge.To("childrenPost", Post.Type).From("parentPost").Field("parent_post_id").Unique(),
		edge.From("submittedForOrder", Orders.Type).Ref("posts").Field("submitted_for_order_id").Unique(),
		edge.From("submittedForOrganization", Organization.Type).Ref("submittedPost").Field("submitted_for_organization_id").Unique(),
		edge.To("tagList", Tags.Type).Through("tags", TagsPosts.Type),
	}
}

type Notifications struct{ ent.Schema }

func (Notifications) Annotations() []schema.Annotation { return table("Notifications") }

func (Notifications) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("organization_id", "organizationId"), str("content", "content"), optStr("link", "link"),
		createdAt(), updatedAt(), deletedAt(),
	}
}

func (Notifications) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("notifications").Field("organization_id").Unique().Required(),
	}
}

type PopularPosts struct{ ent.Schema }

func (PopularPosts) Annotations() []schema.Annotation { return table("PopularPosts") }

func (PopularPosts) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("category", "category"), str("topic", "topic"), str("content", "content"),
		str("hook", "hook"), createdAt(), updatedAt(),
	}
}

type AutoPost struct{ ent.Schema }

func (AutoPost) Annotations() []schema.Annotation { return table("AutoPost") }

func (AutoPost) Fields() []ent.Field {
	return []ent.Field{
		uuidID(),
		str("organization_id", "organizationId"),
		str("title", "title"),
		optStr("content", "content"),
		field.Bool("on_slot").StorageKey("onSlot"),
		field.Bool("sync_last").StorageKey("syncLast"),
		str("url", "url"),
		str("last_url", "lastUrl"),
		field.Bool("active").StorageKey("active"),
		field.Bool("add_picture").StorageKey("addPicture"),
		field.Bool("generate_content").StorageKey("generateContent"),
		str("integrations", "integrations"),
		deletedAt(),
		createdAt(),
		updatedAt(),
	}
}

func (AutoPost) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("autoPost").Field("organization_id").Unique().Required(),
	}
}

type Sets struct{ ent.Schema }

func (Sets) Annotations() []schema.Annotation { return table("Sets") }

func (Sets) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("organization_id", "organizationId"), str("name", "name"), str("content", "content"),
		createdAt(), updatedAt(),
	}
}

func (Sets) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("sets").Field("organization_id").Unique().Required(),
	}
}

type Errors struct{ ent.Schema }

func (Errors) Annotations() []schema.Annotation { return table("Errors") }

func (Errors) Fields() []ent.Field {
	return []ent.Field{
		uuidID(), str("message", "message"), str("platform", "platform"), str("organization_id", "organizationId"),
		createdAt(), updatedAt(), str("post_id", "postId"), field.String("body").StorageKey("body").Default("{}"),
	}
}

func (Errors) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("organization", Organization.Type).Ref("errors").Field("organization_id").Unique().Required(),
		edge.From("post", Post.Type).Ref("errors").Field("post_id").Unique().Required(),
	}
}
