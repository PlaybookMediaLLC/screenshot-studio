package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

// The Postiz tables are created by Postiz's Prisma schema (see
// screenshot-studio-backend/migrations). Every schema here maps onto that DDL exactly: Prisma
// model names are table names and Prisma field names are column names. Prisma
// generates uuid()/cuid() ids and @updatedAt values client side, so Ent does
// the same.

func table(name string) []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: name}}
}

func uuidID() ent.Field {
	return field.String("id").StorageKey("id").Immutable().DefaultFunc(func() string { return uuid.NewString() })
}

func cuidID() ent.Field {
	return field.String("id").StorageKey("id").Immutable().DefaultFunc(cuid.New)
}

func str(name, column string) ent.Field { return field.String(name).StorageKey(column) }

func optStr(name, column string) ent.Field {
	return field.String(name).StorageKey(column).Optional().Nillable()
}

func optInt(name, column string) ent.Field {
	return field.Int(name).StorageKey(column).Optional().Nillable()
}

func optTime(name, column string) ent.Field {
	return field.Time(name).StorageKey(column).Optional().Nillable()
}

func createdAt() ent.Field {
	return field.Time("created_at").StorageKey("createdAt").Default(time.Now).Immutable()
}

func updatedAt() ent.Field {
	return field.Time("updated_at").StorageKey("updatedAt").Default(time.Now).UpdateDefault(time.Now)
}

func deletedAt() ent.Field { return optTime("deleted_at", "deletedAt") }

// Credentials never leave the service in JSON (Ent omits Sensitive fields).
func secret(name, column string) ent.Field {
	return field.String(name).StorageKey(column).Sensitive()
}

func optSecret(name, column string) ent.Field {
	return field.String(name).StorageKey(column).Optional().Nillable().Sensitive()
}
