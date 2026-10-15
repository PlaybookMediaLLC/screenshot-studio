package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PostizTenantBinding is the transitional mapping for existing test OAuth
// connections. New backend-owned connections will use the canonical tenant ID.
type PostizTenantBinding struct{ ent.Schema }

func (PostizTenantBinding) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "postiz_tenant_binding"}}
}

func (PostizTenantBinding) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("organizationId").Immutable(),
		field.String("go_organization_id").StorageKey("goOrganizationId").Immutable(),
		field.String("secret_reference").StorageKey("secretReference").Immutable(),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}

func (PostizTenantBinding) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("go_organization_id").Unique(),
		index.Fields("secret_reference").Unique(),
	}
}
