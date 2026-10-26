package platformmigrations

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

func TestSocialMentionDirectoryBackfill(t *testing.T) {
	uri := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	db, err := database.Open(context.Background(), uri)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.SQL.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	exec := func(query string) {
		t.Helper()
		if _, err := tx.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	schema := fmt.Sprintf("mention_upgrade_%d", time.Now().UnixNano())
	exec("CREATE SCHEMA " + schema)
	exec("SET LOCAL search_path TO " + schema)
	exec(`CREATE TABLE organization(id text PRIMARY KEY); CREATE TABLE social_set(id text PRIMARY KEY);
 CREATE TABLE content_draft("organizationId" text,"socialSetId" text,"updatedAt" timestamptz,body jsonb,"platformVersions" jsonb);
 INSERT INTO organization VALUES ('org'); INSERT INTO social_set VALUES ('set');
 INSERT INTO content_draft VALUES ('org','set','2020-01-01','[{"type":"p","children":[{"type":"social_mention","platform":"linkedin","providerId":"urn:li:organization:42","label":"Old label"},{"type":"social_mention","platform":"linkedin","providerId":"urn:li:person:fake/path","kind":"person","label":"Invalid"}]}]','{}');
 INSERT INTO content_draft VALUES ('org','set','2026-01-01','[]','{"schemaVersion":1,"versions":[{"channel":"linkedin","mode":"manual","body":[{"type":"p","children":[{"type":"social_mention","platform":"linkedin","providerId":"urn:li:organization:42","label":"Current label"},{"type":"social_mention","platform":"linkedin","kind":"person","providerId":"urn:li:person:abc_123","label":"Anne"}]}]}]}');`)
	migration, err := files.ReadFile("sql/20261102120000_platform_social_mention.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(migration))
	var count int
	if err := tx.QueryRow(`SELECT count(*) FROM platform_social_mention`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("directory count=%d err=%v", count, err)
	}
	var label string
	if err := tx.QueryRow(`SELECT label FROM platform_social_mention WHERE "providerId"='urn:li:organization:42'`).Scan(&label); err != nil || label != "Current label" {
		t.Fatalf("latest label=%s err=%v", label, err)
	}
	exec(`DELETE FROM content_draft`)
	if err := tx.QueryRow(`SELECT count(*) FROM platform_social_mention`).Scan(&count); err != nil || count != 2 {
		t.Fatal("draft deletion erased the directory", err)
	}
	exec(`DELETE FROM social_set`)
	if err := tx.QueryRow(`SELECT count(*) FROM platform_social_mention`).Scan(&count); err != nil || count != 0 {
		t.Fatal("set deletion retained identities", err)
	}
}
