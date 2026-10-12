package errorsdb

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
)

func TestListErrorsUnknownFirst(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	user := client.User.Create().SetEmail("Owner@Acme.com").SetProviderName("LOCAL").SetTimezone(0).SaveX(ctx)
	client.UserOrganization.Create().SetOrganization(org).SetUser(user).SaveX(ctx)
	integration := client.Integration.Create().SetOrganization(org).SetInternalID("1").SetName("X").
		SetProviderIdentifier("x").SetType("social").SetToken("t").SaveX(ctx)
	p := client.Post.Create().SetOrganization(org).SetIntegration(integration).SetContent("hello").SetGroup("g").SetPublishDate(time.Now()).SaveX(ctx)
	base := time.Now()
	add := func(message, platform string, minutes int) {
		client.Errors.Create().SetMessage(message).SetPlatform(platform).SetOrganizationID(org.ID).SetPostID(p.ID).
			SetCreatedAt(base.Add(time.Duration(minutes) * time.Minute)).SaveX(ctx)
	}
	add("known 1", "x", 1)
	add("An unknown error occurred 1", "x", 2)
	add("known 2", "linkedin", 3)
	add("An unknown error occurred 2", "x", 4)
	add("known 3", "x", 5)

	messages := func(res *ListErrorsResponse) string {
		var out []string
		for _, item := range res.Items {
			out = append(out, item.Message)
		}
		return strings.Join(out, ",")
	}
	page0, err := s.ListErrors(ctx, ListErrorsParams{UnknownFirst: true, Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if got := messages(page0); got != "An unknown error occurred 2,An unknown error occurred 1,known 3" || !page0.HasMore || page0.Total != 5 {
		t.Fatalf("page 0: %s %+v", got, page0)
	}
	page1, _ := s.ListErrors(ctx, ListErrorsParams{UnknownFirst: true, Limit: 3, Page: 1})
	if got := messages(page1); got != "known 2,known 1" || page1.HasMore {
		t.Fatalf("page 1: %s", got)
	}
	plain, _ := s.ListErrors(ctx, ListErrorsParams{Platform: "x", Email: "owner@acme"})
	if plain.Total != 4 || plain.Limit != 20 {
		t.Fatalf("filtered: %+v", plain)
	}
	none, _ := s.ListErrors(ctx, ListErrorsParams{Email: "nobody"})
	if none.Total != 0 || none.Items == nil {
		t.Fatalf("email filter: %+v", none)
	}
	data, _ := json.Marshal(plain.Items[0])
	for _, want := range []string{`"organization":{"id":"` + org.ID + `","name":"Acme","users":[{"user":{"id":"`, `"post":{"id":"` + p.ID + `","content":"hello"}`, `"platform":"x"`} {
		if !strings.Contains(string(data), want) {
			t.Errorf("missing %s in %s", want, data)
		}
	}
	platforms, _ := s.ListPlatforms(ctx)
	if strings.Join(platforms, ",") != "linkedin,x" {
		t.Fatalf("platforms: %v", platforms)
	}
}
