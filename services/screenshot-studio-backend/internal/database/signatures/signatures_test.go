package signatures

import (
	"context"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/signature"
)

func TestOneDefaultSignature(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	yes, no := true, false

	a, err := s.CreateOrUpdateSignature(ctx, org.ID, dto.SignatureDto{Content: "a", AutoAdd: &yes}, "")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := s.CreateOrUpdateSignature(ctx, org.ID, dto.SignatureDto{Content: "b", AutoAdd: &yes}, "")
	if def, _ := s.GetDefaultSignature(ctx, org.ID); def == nil || def.ID != b.ID {
		t.Fatalf("default: %v", def)
	}
	// updating keeps the id
	if again, _ := s.CreateOrUpdateSignature(ctx, org.ID, dto.SignatureDto{Content: "a2", AutoAdd: &no}, a.ID); again.ID != a.ID {
		t.Fatalf("update created %s", again.ID)
	}
	if _, err := s.DeleteSignature(ctx, org.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	list, _ := s.GetSignaturesByOrgID(ctx, org.ID)
	if def, _ := s.GetDefaultSignature(ctx, org.ID); len(list) != 1 || list[0].Content != "a2" || def != nil {
		t.Fatalf("after delete: %v %v", list, def)
	}
}
