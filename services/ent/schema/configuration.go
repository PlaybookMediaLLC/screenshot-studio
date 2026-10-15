package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// BrandKit maps the canonical product table. The backend is its sole writer.
type BrandKit struct{ ent.Schema }

func (BrandKit) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "brand_kit"}}
}
func (BrandKit) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.Int("version").StorageKey("version"),
		field.JSON("definition", map[string]any{}).StorageKey("definition"),
		field.Enum("status").StorageKey("status").Values("DRAFT", "ACTIVE", "ARCHIVED").Default("DRAFT"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (BrandKit) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id", "name", "version").Unique(), index.Fields("organization_id", "created_at")}
}

// BrandProfile stores the editable workspace writing guidance.
type BrandProfile struct{ ent.Schema }

func (BrandProfile) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "brand_profile"}}
}
func (BrandProfile) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("product_description").StorageKey("productDescription"),
		field.String("audience").StorageKey("audience"),
		field.String("tone").StorageKey("tone"),
		field.String("tagline").StorageKey("tagline").Optional().Nillable(),
		field.String("cta_conventions").StorageKey("ctaConventions").Optional().Nillable(),
		field.JSON("prohibited_terms", []string{}).StorageKey("prohibitedTerms"),
		field.JSON("preferred_styles", []string{}).StorageKey("preferredStyles"),
		field.JSON("social_handles", map[string]string{}).StorageKey("socialHandles"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (BrandProfile) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id").Unique()}
}

// SourceApp is the canonical source integration configuration.
type SourceApp struct{ ent.Schema }

func (SourceApp) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "source_app"}}
}
func (SourceApp) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("provider").StorageKey("provider").Default("generic"),
		field.String("external_id").StorageKey("externalId").Optional().Nillable(),
		field.String("secret_reference").StorageKey("secretReference").Optional().Nillable().Sensitive(),
		field.JSON("allowed_hosts", []string{}).StorageKey("allowedHosts"),
		field.Enum("status").StorageKey("status").Values("DRAFT", "ACTIVE", "ARCHIVED").Default("DRAFT"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (SourceApp) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "name").Unique(),
		index.Fields("provider", "external_id").Unique(),
		index.Fields("organization_id", "created_at"),
	}
}
