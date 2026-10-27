package schema

import (
	"database/sql"
	"database/sql/driver"

	"entgo.io/ent/schema/field"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
)

// The codec protects every Ent write, including upserts and direct builders.
func credentialScanner(purpose string) field.ValueScannerFunc[string, *sql.NullString] {
	return field.ValueScannerFunc[string, *sql.NullString]{
		V: func(value string) (driver.Value, error) { return credentialcipher.Seal(value, purpose) },
		S: func(value *sql.NullString) (string, error) { return credentialcipher.Open(value.String, purpose) },
	}
}

// Ent's external codec receives the nullable Go type directly.
func nullableCredentialScanner(purpose string) field.ValueScannerFunc[*string, *sql.NullString] {
	return field.ValueScannerFunc[*string, *sql.NullString]{
		V: func(value *string) (driver.Value, error) {
			if value == nil {
				return nil, nil
			}
			return credentialcipher.Seal(*value, purpose)
		},
		S: func(value *sql.NullString) (*string, error) {
			if !value.Valid {
				return nil, nil
			}
			plain, err := credentialcipher.Open(value.String, purpose)
			if err != nil {
				return nil, err
			}
			return &plain, nil
		},
	}
}
