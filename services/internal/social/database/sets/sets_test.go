package sets

import (
	"context"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/sets"
)

func TestCreateSetUpsert(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)

	created, err := s.CreateSet(ctx, org.ID, dto.SetsDto{ID: "6f1c1b7e-0000-4000-8000-000000000001", Name: "a", Content: "{}"})
	if err != nil || created.ID != "6f1c1b7e-0000-4000-8000-000000000001" {
		t.Fatal(created, err)
	}
	if again, _ := s.CreateSet(ctx, org.ID, dto.SetsDto{ID: created.ID, Name: "b", Content: "{}"}); again.ID != created.ID {
		t.Fatal("update created a row")
	}
	if n, _ := s.GetTotal(ctx, org.ID); n != 1 {
		t.Fatalf("total %d", n)
	}
	if _, err := s.DeleteSet(ctx, "other", created.ID); err == nil {
		t.Fatal("deleted another org's set")
	}
	if row, err := s.DeleteSet(ctx, org.ID, created.ID); err != nil || row.Name != "b" {
		t.Fatal(row, err)
	}
}
