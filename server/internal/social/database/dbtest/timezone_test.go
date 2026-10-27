package dbtest_test

import (
	"context"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
)

// Stored timestamps must be UTC wall time (what Prisma writes) even when the
// process time zone is not UTC.
func TestTimestampsAreStoredInUTC(t *testing.T) {
	client := dbtest.Open(t)
	newYork, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tz database")
	}
	time.Local = newYork
	t.Cleanup(func() { time.Local = time.UTC })
	ctx := context.Background()

	at := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC).In(newYork)
	org := client.Organization.Create().SetName("tz").SetStreakSince(at).SaveX(ctx)

	var stored string
	rows, err := client.QueryContext(ctx, `SELECT to_char("streakSince", 'YYYY-MM-DD HH24:MI:SS') FROM "Organization" WHERE id = $1`, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	rows.Next()
	if err := rows.Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != "2030-01-01 00:00:00" {
		t.Fatalf("stored %s, want UTC wall time 2030-01-01 00:00:00", stored)
	}
	read := client.Organization.GetX(ctx, org.ID)
	if !read.StreakSince.Equal(at) {
		t.Fatalf("read back %v, want %v", read.StreakSince, at)
	}
}
