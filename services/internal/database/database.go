package database

import (
	"context"
	stdsql "database/sql"
	"fmt"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type Database struct {
	Client *ent.Client
	SQL    *stdsql.DB
}

func Open(ctx context.Context, databaseURL string) (*Database, error) {
	db, err := stdsql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetConnMaxIdleTime(5 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetMaxIdleConns(5)
	db.SetMaxOpenConns(20)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	driver := entsql.OpenDB(dialect.Postgres, db)
	return &Database{Client: ent.NewClient(ent.Driver(driver)), SQL: db}, nil
}

func (d *Database) Close() error {
	if d == nil {
		return nil
	}
	return d.Client.Close()
}
