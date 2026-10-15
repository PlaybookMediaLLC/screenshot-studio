package authstore

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/lucsky/cuid"
)

func TestAuthStoreRunsBetterAuthOperations(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	store := New(db.SQL)
	id := cuid.New()
	run := func(request Request) *Result {
		t.Helper()
		result, err := store.Execute(ctx, request)
		if err != nil {
			t.Fatalf("%s %s: %v", request.Op, request.Model, err)
		}
		return result
	}
	t.Cleanup(func() { _, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id LIKE $1`, id+"%") })

	created := run(Request{Op: "create", Model: "user", Data: map[string]any{
		"id": id + "a", "name": "Ada", "email": id + "a@example.test", "emailVerified": true,
		"createdAt": "2026-10-14T12:00:00.000Z", "updatedAt": "2026-10-14T12:00:00.000Z",
	}})
	if created.Row["email"] != id+"a@example.test" || created.Row["createdAt"] != "2026-10-14T12:00:00.000Z" {
		t.Fatalf("created row = %#v", created.Row)
	}
	run(Request{Op: "create", Model: "user", Data: map[string]any{
		"id": id + "b", "name": "Bob", "email": id + "b@example.test", "emailVerified": false,
		"createdAt": "2026-10-14T13:00:00.000Z", "updatedAt": "2026-10-14T13:00:00.000Z",
	}})

	found := run(Request{Op: "findOne", Model: "user", Where: []Where{
		{Field: "email", Value: strings.ToUpper(id + "A@EXAMPLE.TEST"), Mode: "insensitive"},
	}})
	if found.Row["id"] != id+"a" {
		t.Fatalf("insensitive lookup = %#v", found.Row)
	}
	missing := run(Request{Op: "findOne", Model: "user", Where: []Where{{Field: "id", Value: "absent"}}})
	if missing.Row != nil {
		t.Fatalf("missing row = %#v", missing.Row)
	}

	listed := run(Request{Op: "findMany", Model: "user", Limit: 1, Offset: 1, Select: []string{"id"},
		Where: []Where{{Field: "id", Operator: "starts_with", Value: id}},
		SortBy: &struct {
			Direction string `json:"direction"`
			Field     string `json:"field"`
		}{Direction: "desc", Field: "createdAt"}})
	if len(listed.Rows) != 1 || listed.Rows[0]["id"] != id+"a" || len(listed.Rows[0]) != 1 {
		t.Fatalf("sorted page = %#v", listed.Rows)
	}

	either := run(Request{Op: "count", Model: "user", Where: []Where{
		{Field: "id", Operator: "starts_with", Value: id},
		{Field: "name", Value: "Ada", Connector: "OR"},
		{Field: "name", Value: "Nobody", Connector: "OR"},
	}})
	if *either.Count != 1 {
		t.Fatalf("AND plus OR count = %d", *either.Count)
	}

	updated := run(Request{Op: "update", Model: "user", Where: []Where{{Field: "id", Value: id + "b"}},
		Data: map[string]any{"name": "Robert"}})
	if updated.Row["name"] != "Robert" {
		t.Fatalf("updated row = %#v", updated.Row)
	}
	many := run(Request{Op: "updateMany", Model: "user", Where: []Where{
		{Field: "id", Operator: "in", Value: []any{id + "a", id + "b"}},
	}, Data: map[string]any{"emailVerified": true}})
	if *many.Count != 2 {
		t.Fatalf("updateMany count = %d", *many.Count)
	}

	run(Request{Op: "create", Model: "verification", Data: map[string]any{
		"id": id + "v", "identifier": id, "value": "token", "expiresAt": "2030-01-01T00:00:00.000Z",
		"createdAt": "2026-10-14T12:00:00.000Z", "updatedAt": "2026-10-14T12:00:00.000Z",
	}})
	consumed := run(Request{Op: "consumeOne", Model: "verification", Where: []Where{{Field: "identifier", Value: id}}})
	again := run(Request{Op: "consumeOne", Model: "verification", Where: []Where{{Field: "identifier", Value: id}}})
	if consumed.Row["value"] != "token" || again.Row != nil {
		t.Fatalf("consume once = %#v then %#v", consumed.Row, again.Row)
	}

	run(Request{Op: "create", Model: "twoFactor", Data: map[string]any{
		"id": id + "f", "secret": "s", "backupCodes": "[]", "userId": id + "a", "failedVerificationCount": float64(0),
	}})
	bumped := run(Request{Op: "incrementOne", Model: "twoFactor", Where: []Where{{Field: "id", Value: id + "f"}},
		Increment: map[string]float64{"failedVerificationCount": 2}})
	if bumped.Row["failedVerificationCount"] != int64(2) {
		t.Fatalf("incremented row = %#v", bumped.Row)
	}

	deleted := run(Request{Op: "deleteMany", Model: "user", Where: []Where{{Field: "id", Operator: "starts_with", Value: id}}})
	if *deleted.Count != 2 {
		t.Fatalf("deleteMany count = %d", *deleted.Count)
	}

	for _, request := range []Request{
		{Op: "findOne", Model: "campaign", Where: []Where{{Field: "id", Value: "x"}}},
		{Op: "findOne", Model: "user", Where: []Where{{Field: "id; DROP TABLE user", Value: "x"}}},
		{Op: "findOne", Model: "user", Where: []Where{{Field: "id", Operator: "regex", Value: "x"}}},
		{Op: "drop", Model: "user"},
	} {
		if _, err := store.Execute(ctx, request); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%+v accepted: %v", request, err)
		}
	}
}
