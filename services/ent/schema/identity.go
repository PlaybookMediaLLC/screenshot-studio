package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// These identity models project the existing Better Auth rows while the web
// sign-in implementation is moved behind the backend. The backend independently
// checks the session and membership for every publishing API request.
type User struct{ ent.Schema }

func (User) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "user"}}
}
func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("email").StorageKey("email"),
		field.Bool("email_verified").StorageKey("emailVerified").Default(false),
		field.Bool("banned").StorageKey("banned").Optional().Nillable(),
		field.Time("ban_expires").StorageKey("banExpires").Optional().Nillable(),
	}
}
func (User) Indexes() []ent.Index { return []ent.Index{index.Fields("email").Unique()} }

type Session struct{ ent.Schema }

func (Session) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "session"}}
}
func (Session) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("user_id").StorageKey("userId").Immutable(),
		field.String("token").StorageKey("token").Sensitive(),
		field.Time("expires_at").StorageKey("expiresAt"),
		field.String("active_organization_id").StorageKey("activeOrganizationId").Optional().Nillable(),
	}
}
func (Session) Indexes() []ent.Index {
	return []ent.Index{index.Fields("user_id"), index.Fields("token").Unique()}
}

type Organization struct{ ent.Schema }

func (Organization) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "organization"}}
}
func (Organization) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("name").StorageKey("name"),
		field.String("slug").StorageKey("slug"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
func (Organization) Indexes() []ent.Index { return []ent.Index{index.Fields("slug").Unique()} }

type Member struct{ ent.Schema }

func (Member) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "member"}}
}
func (Member) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("organization_id").StorageKey("organizationId").Immutable(),
		field.String("user_id").StorageKey("userId").Immutable(),
		field.String("role").StorageKey("role").Default("member"),
		field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable(),
	}
}
func (Member) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("organization_id", "user_id").Unique(),
		index.Fields("organization_id"), index.Fields("user_id"),
	}
}
