package dbtest_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/post"
)

// The Ent schema must read and write the original app's Prisma tables, and rows must
// serialize the way Prisma does.
func TestEntMatchesPrismaSchema(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	user := client.User.Create().SetEmail("a@b.c").SetProviderName("LOCAL").SetTimezone(0).SetPassword("secret").SaveX(ctx)
	client.UserOrganization.Create().SetOrganization(org).SetUser(user).SetRole("ADMIN").SaveX(ctx)
	integration := client.Integration.Create().SetOrganization(org).SetInternalID("1").SetName("X").
		SetProviderIdentifier("x").SetType("social").SetToken("tok").SaveX(ctx)
	tag := client.Tags.Create().SetName("t").SetColor("#fff").SetOrgID(org.ID).SaveX(ctx)
	p := client.Post.Create().SetOrganization(org).SetIntegration(integration).SetContent("hi").SetGroup("g").
		SetPublishDate(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)).SaveX(ctx)
	client.TagsPosts.Create().SetPostID(p.ID).SetTagID(tag.ID).SaveX(ctx)
	webhook := client.Webhooks.Create().SetName("w").SetURL("https://x").SetOrganization(org).SaveX(ctx)
	client.IntegrationsWebhooks.Create().SetIntegrationID(integration.ID).SetWebhookID(webhook.ID).SaveX(ctx)

	loaded := client.Post.Query().Where(post.ID(p.ID)).WithIntegration().WithTags(func(q *ent.TagsPostsQuery) { q.WithTag() }).OnlyX(ctx)
	data, err := json.Marshal(loaded)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{`"publishDate":"2026-01-02T03:04:05.000Z"`, `"releaseURL":null`, `"integration":{`, `"tags":[{"postId"`, `"tag":{`, `"state":"QUEUE"`} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %s in %s", want, text)
		}
	}
	if strings.Contains(text, `"token"`) {
		t.Errorf("token leaked: %s", text)
	}
	users, _ := json.Marshal(user)
	if strings.Contains(string(users), "secret") || strings.Contains(string(users), "password") {
		t.Errorf("password leaked: %s", users)
	}
	if n := client.Integration.QueryWebhooks(integration).CountX(ctx); n != 1 {
		t.Errorf("webhooks through table: got %d", n)
	}
}
