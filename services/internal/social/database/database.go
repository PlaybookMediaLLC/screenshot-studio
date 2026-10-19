// Package database opens the social database. Each domain (posts,
// integration, organizations, ...) lives in a subpackage holding its
// repository and service, the Go form of the original app's DatabaseModule.
package database

import (
	"context"
	stdsql "database/sql"
	"fmt"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/stdlib"
)

type Database struct {
	Client *ent.Client
	SQL    *stdsql.DB
}

func Open(ctx context.Context, databaseURL string) (*Database, error) {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db := stdlib.OpenDB(*config, stdlib.OptionAfterConnect(func(_ context.Context, conn *pgx.Conn) error {
		registerUTCTimestamps(conn.TypeMap())
		return nil
	}))
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
	return &Database{Client: ent.NewClient(ent.Driver(entsql.OpenDB(dialect.Postgres, db))), SQL: db}, nil
}

func (d *Database) Close() error {
	if d == nil {
		return nil
	}
	return d.Client.Close()
}

// the original app's columns are Prisma `timestamp(3)` (no time zone) holding UTC wall
// time. pgx writes a time.Time's wall clock in its own location, so a process
// whose local zone is not UTC would store shifted values. Converting every
// written timestamp to UTC keeps the stored values correct whatever the
// process time zone; reads already come back as UTC.
func registerUTCTimestamps(m *pgtype.Map) {
	m.RegisterType(&pgtype.Type{Name: "timestamp", OID: pgtype.TimestampOID, Codec: &utcTimestampCodec{}})
}

type utcTimestampCodec struct{ pgtype.TimestampCodec }

func (c *utcTimestampCodec) PlanEncode(m *pgtype.Map, oid uint32, format int16, value any) pgtype.EncodePlan {
	next := c.TimestampCodec.PlanEncode(m, oid, format, value)
	if next == nil {
		return nil
	}
	return utcEncodePlan{next: next}
}

type utcEncodePlan struct{ next pgtype.EncodePlan }

func (p utcEncodePlan) Encode(value any, buf []byte) ([]byte, error) {
	// pgx hands the codec a TimestampValuer (time.Time is wrapped first).
	if v, ok := value.(pgtype.TimestampValuer); ok {
		ts, err := v.TimestampValue()
		if err != nil {
			return nil, err
		}
		if ts.Valid && ts.InfinityModifier == pgtype.Finite {
			ts.Time = ts.Time.UTC()
		}
		value = ts
	}
	return p.next.Encode(value, buf)
}
