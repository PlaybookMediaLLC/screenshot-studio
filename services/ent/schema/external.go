package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// CreativeVariant is a read-only projection of the application-owned table.
type CreativeVariant struct{ ent.Schema }

func (CreativeVariant) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "creative_variant"}}
}
func (CreativeVariant) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("source_asset_id").StorageKey("sourceAssetId").Immutable(),
		field.Enum("status").StorageKey("status").Values("DRAFT", "APPROVED", "ARCHIVED"),
	}
}
func (CreativeVariant) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("source_asset", Asset.Type).Field("source_asset_id").Unique().Required().Immutable(),
		edge.To("approval", Approval.Type).Unique(),
	}
}

// Approval is a read-only projection used to enforce approval at scheduling and dispatch.
type Approval struct{ ent.Schema }

func (Approval) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "approval"}}
}
func (Approval) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("variant_id").StorageKey("variantId").Immutable(),
		field.Enum("status").StorageKey("status").Values("PENDING", "APPROVED", "REJECTED"),
	}
}
func (Approval) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("variant", CreativeVariant.Type).Ref("approval").Field("variant_id").Unique().Required().Immutable(),
	}
}
func (Approval) Indexes() []ent.Index { return []ent.Index{index.Fields("variant_id").Unique()} }

// Asset is a read-only projection containing the fields required for publication.
type Asset struct{ ent.Schema }

func (Asset) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "asset"}}
}
func (Asset) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("object_key").StorageKey("objectKey").Immutable(),
		field.String("media_type").StorageKey("mediaType").Immutable(),
	}
}
func (Asset) Edges() []ent.Edge {
	return []ent.Edge{edge.From("variants", CreativeVariant.Type).Ref("source_asset")}
}

// WorkspaceDeletion is a read-only projection used to block publications during deletion.
type WorkspaceDeletion struct{ ent.Schema }

func (WorkspaceDeletion) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "workspace_deletion"}}
}
func (WorkspaceDeletion) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.Enum("status").StorageKey("status").Values("PENDING", "PROCESSING", "CANCELLED", "PURGED"),
	}
}
func (WorkspaceDeletion) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id").Unique()}
}
