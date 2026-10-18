// Package platformmigrations applies product and social tables to one public schema.
// The product SQL is embedded here; social adapter SQL is applied in the same command.
package platformmigrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"

	socialmigrations "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/migrations"
)

//go:embed sql/*.sql
var files embed.FS

const migrationTable = `"_screenshot_studio_go_migrations"`

func Apply(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS `+migrationTable+` (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create platform migration table: %w", err)
	}
	entries, err := files.ReadDir("sql")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		if err := applyOne(ctx, db, name); err != nil {
			return err
		}
	}
	return socialmigrations.Apply(ctx, db)
}

func applyOne(ctx context.Context, db *sql.DB, name string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('screenshot-studio-platform-migrations'))`); err != nil {
		return err
	}
	var done bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM `+migrationTable+` WHERE name=$1)`, name).Scan(&done); err != nil {
		return err
	}
	if done {
		return tx.Commit()
	}
	var prismaTable bool
	if err := tx.QueryRowContext(ctx, `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL`).Scan(&prismaTable); err != nil {
		return err
	}
	if prismaTable {
		var appliedByPrisma bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL)`, strings.TrimSuffix(name, ".sql")).Scan(&appliedByPrisma); err != nil {
			return err
		}
		if appliedByPrisma {
			return recordApplied(ctx, tx, name)
		}
	}
	if name == "20260814073500_initial_tenant_model.sql" {
		var existingSchema bool
		if err := tx.QueryRowContext(ctx, `SELECT to_regclass('public."user"') IS NOT NULL`).Scan(&existingSchema); err != nil {
			return err
		}
		if existingSchema {
			return fmt.Errorf("platform schema exists without an applied migration record")
		}
	}
	script, err := files.ReadFile("sql/" + name)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, string(script)); err != nil {
		return fmt.Errorf("apply %s: %w", name, err)
	}
	return recordApplied(ctx, tx, name)
}

func recordApplied(ctx context.Context, tx *sql.Tx, name string) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO `+migrationTable+` (name) VALUES ($1)`, name); err != nil {
		return err
	}
	return tx.Commit()
}
