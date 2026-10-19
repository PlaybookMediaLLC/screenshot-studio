package ent

import (
	"context"
	"database/sql"
)

// PlatformExec keeps reviewed platform SQL in the same transaction as Ent writes.
func (tx *Tx) PlatformExec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	var result sql.Result
	err := tx.config.driver.Exec(ctx, query, args, &result)
	return result, err
}
