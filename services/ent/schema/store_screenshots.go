package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// StoreReview is a read-only, shareable snapshot of a store screenshot set.
// It holds rendered slide images (tenant assets), never source screenshots
// or the editable project. Access by link is checked against ShareTokenID
// and RevokedAt; the link token itself is an HMAC signed by the web.
type StoreReview struct{ ent.Schema }

func (StoreReview) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "store_review"}}
}

func (StoreReview) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("project_id").StorageKey("projectId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("version_label").StorageKey("versionLabel"),
		field.Int("project_revision").StorageKey("projectRevision"),
		field.String("share_token_id").StorageKey("shareTokenId").Immutable(),
		field.JSON("slides", []map[string]any{}).StorageKey("slides"),
		field.Time("revoked_at").StorageKey("revokedAt").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (StoreReview) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "project_id", "created_at")}
}

// StoreReviewComment is a reviewer's note on one slide of a review. SlideID
// is the editor's stable slide id, so a comment stays with its slide when
// slides are reordered.
type StoreReviewComment struct{ ent.Schema }

func (StoreReviewComment) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "store_review_comment"}}
}

func (StoreReviewComment) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("review_id").StorageKey("reviewId").Immutable(),
		field.String("slide_id").StorageKey("slideId").Immutable(),
		field.Float("x").StorageKey("x").Optional().Nillable(),
		field.Float("y").StorageKey("y").Optional().Nillable(),
		field.String("author_name").StorageKey("authorName"),
        field.String("platform_author_user_id").StorageKey("platformAuthorUserId").Optional().Nillable(),
		field.String("body").StorageKey("body"),
		field.Bool("from_link").StorageKey("fromLink"),
		field.Time("resolved_at").StorageKey("resolvedAt").Optional().Nillable(),
		field.String("resolved_by_user_id").StorageKey("resolvedByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (StoreReviewComment) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "review_id", "created_at")}
}

// StorePublishingCredential keeps an App Store Connect API key or a Google
// Play service account. The secret is encrypted by the web before it is
// sent here; the backend stores and returns only ciphertext.
type StorePublishingCredential struct{ ent.Schema }

func (StorePublishingCredential) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "store_publishing_credential"}}
}

func (StorePublishingCredential) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.Enum("provider").StorageKey("provider").Values("APP_STORE_CONNECT", "GOOGLE_PLAY"),
		field.String("label").StorageKey("label"),
		field.JSON("metadata", map[string]string{}).StorageKey("metadata"),
		field.String("encrypted_secret").StorageKey("encryptedSecret").Sensitive(),
		field.Time("last_used_at").StorageKey("lastUsedAt").Optional().Nillable(),
		field.String("created_by_user_id").StorageKey("createdByUserId").Optional().Nillable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (StorePublishingCredential) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "provider")}
}
