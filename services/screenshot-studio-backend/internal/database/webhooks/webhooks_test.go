package webhooks

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/webhooks"
)

func TestWebhooksIntegrations(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	other := client.Organization.Create().SetName("Other").SaveX(ctx)
	newIntegration := func(name string) string {
		return client.Integration.Create().SetOrganization(org).SetInternalID(name).SetName(name).SetPicture("p.png").
			SetProviderIdentifier("x").SetType("social").SetToken("t").SaveX(ctx).ID
	}
	a, b := newIntegration("a"), newIntegration("b")

	created, err := s.CreateWebhook(ctx, org.ID, dto.WebhooksDto{Name: "hook", URL: "https://h.example", Integrations: []dto.WebhooksIntegrationDto{{ID: a}, {ID: b}}})
	if err != nil {
		t.Fatal(err)
	}
	// updating replaces the integrations
	if _, err := s.CreateWebhook(ctx, org.ID, dto.WebhooksDto{ID: created.ID, Name: "hook2", URL: "https://h2.example", Integrations: []dto.WebhooksIntegrationDto{{ID: b}}}); err != nil {
		t.Fatal(err)
	}
	// another org's id creates a new webhook instead of updating
	if res, err := s.CreateWebhook(ctx, other.ID, dto.WebhooksDto{ID: created.ID, Name: "x", URL: "https://x"}); err != nil || res.ID == created.ID {
		t.Fatal(res, err)
	}

	hooks, err := s.GetWebhooks(ctx, org.ID)
	if err != nil || len(hooks) != 1 {
		t.Fatal(hooks, err)
	}
	data, _ := json.Marshal(hooks)
	want := `"integrations":[{"integration":{"id":"` + b + `","picture":"p.png","name":"b"}}]}`
	if !strings.Contains(string(data), want) || !strings.Contains(string(data), `"name":"hook2"`) {
		t.Fatalf("webhooks: %s", data)
	}
	if n, _ := s.GetTotal(ctx, org.ID); n != 1 {
		t.Fatalf("total %d", n)
	}
	if _, err := s.DeleteWebhook(ctx, other.ID, created.ID); err == nil {
		t.Fatal("deleted another org's webhook")
	}
	if _, err := s.DeleteWebhook(ctx, org.ID, created.ID); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.GetTotal(ctx, org.ID); n != 0 {
		t.Fatalf("total after delete %d", n)
	}
}
