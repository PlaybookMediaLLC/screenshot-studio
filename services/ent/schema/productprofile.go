package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
)

// ProductProfile is a workspace's product memory: one per workspace, each
// field with its provenance (docs/rfcs/012-product-intelligence.md).
type ProductProfile struct{ ent.Schema }

func (ProductProfile) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "product_profile"}}
}
func (ProductProfile) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("url").StorageKey("url"),
		field.String("summary").StorageKey("summary").Default(""),
		field.String("problem").StorageKey("problem").Default(""),
		field.String("audience").StorageKey("audience").Default(""),
		field.JSON("capabilities", []string{}).StorageKey("capabilities").Default([]string{}),
		field.JSON("proof_points", []profile.ProofPoint{}).StorageKey("proofPoints").Default([]profile.ProofPoint{}),
		field.String("pricing_note").StorageKey("pricingNote").Default(""),
		field.JSON("competitors", []string{}).StorageKey("competitors").Default([]string{}),
		// Field name to where its value came from.
		field.JSON("provenance", map[string]profile.FieldProvenance{}).StorageKey("provenance").Default(map[string]profile.FieldProvenance{}),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
		field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now),
	}
}
func (ProductProfile) Indexes() []ent.Index {
	return []ent.Index{index.Fields("organization_id").Unique()}
}
