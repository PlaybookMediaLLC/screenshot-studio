// Package migrations holds the Postiz schema DDL. 0001_init.sql is generated
// from Postiz's Prisma schema (prisma migrate diff --from-empty), so a
// database created here is identical to one Postiz created, and an existing
// Postiz database is used as-is. Apply records applied files in
// "_postiz_go_migrations" and skips 0001 when Postiz already created the
// tables.
package migrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"sort"
)

//go:embed *.sql
var files embed.FS

func Apply(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS "_postiz_go_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}
	entries, err := files.ReadDir(".")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		var done bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM "_postiz_go_migrations" WHERE name = $1)`, name).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		if name == "0001_init.sql" {
			var exists bool
			if err := db.QueryRowContext(ctx, `SELECT to_regclass('public."Organization"') IS NOT NULL`).Scan(&exists); err != nil {
				return err
			}
			if exists {
				if _, err := db.ExecContext(ctx, `INSERT INTO "_postiz_go_migrations" (name) VALUES ($1)`, name); err != nil {
					return err
				}
				continue
			}
		}
		script, err := files.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(script)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO "_postiz_go_migrations" (name) VALUES ($1)`, name); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
