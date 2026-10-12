package thirdparty

import (
	"context"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
)

func TestSaveIntegrationUpsert(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)

	first, err := s.SaveIntegration(ctx, org.ID, "heygen", "key-1", SaveIntegrationData{Name: "A", ID: "acc"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteIntegration(ctx, org.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	second, err := s.SaveIntegration(ctx, org.ID, "heygen", "key-2", SaveIntegrationData{Name: "B", ID: "acc"})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID || second.Name != "B" || second.DeletedAt != nil {
		t.Fatalf("upsert: %+v", second)
	}
	if key, _ := helpers.FixedDecryption(second.APIKey); key != "key-2" {
		t.Fatalf("api key %q", key)
	}
	list, err := s.GetAllThirdPartiesByOrganization(ctx, org.ID)
	if err != nil || len(list) != 1 || list[0] != (ThirdPartySummary{ID: first.ID, Name: "B", Identifier: "heygen"}) {
		t.Fatalf("list: %+v %v", list, err)
	}
	if got, _ := s.GetIntegrationByID(ctx, "other", first.ID); got != nil {
		t.Fatal("other org sees it")
	}
}
