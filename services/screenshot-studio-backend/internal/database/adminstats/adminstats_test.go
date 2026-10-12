package adminstats

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
)

func TestMain(m *testing.M) {
	time.Local = time.UTC
	os.Exit(m.Run())
}

func TestStats(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	s := NewService(NewRepository(client))
	day := time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)

	org1 := client.Organization.Create().SetName("o1").SaveX(ctx)
	org2 := client.Organization.Create().SetName("o2").SaveX(ctx)
	user := client.User.Create().SetEmail("u@x").SetProviderName("LOCAL").SetTimezone(0).SaveX(ctx)
	n := 0
	integration := func(org *ent.Organization, provider string) *ent.Integration {
		n++
		return client.Integration.Create().SetOrganization(org).SetInternalID(provider + string(rune('a'+n))).SetName(provider).
			SetProviderIdentifier(provider).SetType("social").SetToken("t").SetCreatedAt(day).SaveX(ctx)
	}
	x1, x2, li1 := integration(org1, "x"), integration(org2, "x"), integration(org1, "linkedin")
	x1b := integration(org1, "x")
	newPost := func(i *ent.Integration, state post.State, method post.CreationMethod) *ent.Post {
		return client.Post.Create().SetOrganizationID(i.OrganizationID).SetIntegration(i).SetContent("c").SetGroup("g").
			SetPublishDate(day).SetState(state).SetCreationMethod(method).SaveX(ctx)
	}
	p := newPost(x1, post.StatePUBLISHED, post.CreationMethodWEB)
	newPost(x1b, post.StatePUBLISHED, post.CreationMethodAPI)
	newPost(x2, post.StateQUEUE, post.CreationMethodWEB)
	newPost(li1, post.StatePUBLISHED, post.CreationMethodMCP)
	newPost(li1, post.StateERROR, post.CreationMethodMCP)
	// thread children are not counted
	client.Post.Create().SetOrganizationID(org1.ID).SetIntegration(x1).SetContent("c").SetGroup("g").
		SetPublishDate(day).SetState(post.StatePUBLISHED).SetParentPostID(p.ID).SaveX(ctx)

	client.Errors.Create().SetMessage(`{"message":"Unknown Error"}`).SetPlatform("x").SetOrganizationID(org1.ID).SetPostID(p.ID).SetCreatedAt(day).SaveX(ctx)
	client.Errors.Create().SetMessage("bad").SetPlatform("linkedin").SetOrganizationID(org1.ID).SetPostID(p.ID).SetCreatedAt(day).SaveX(ctx)

	app := client.OAuthApp.Create().SetName(" Claude ").SetRedirectURL("https://c").SetClientID("c1").SaveX(ctx)
	app2 := client.OAuthApp.Create().SetName("claude").SetRedirectURL("https://c").SetClientID("c2").SaveX(ctx)
	client.OAuthAuthorization.Create().SetOauthApp(app).SetUserID(user.ID).SetOrganizationID(org1.ID).SetAccessToken("a").SetCreatedAt(day).SaveX(ctx)
	client.OAuthAuthorization.Create().SetOauthApp(app2).SetUserID(user.ID).SetOrganizationID(org2.ID).SetAccessToken("b").SetCreatedAt(day).SaveX(ctx)

	from, to := day.Add(-time.Hour), day.Add(time.Hour)
	stats, err := s.GetStats(ctx, StatsParams{From: from, To: to})
	if err != nil {
		t.Fatal(err)
	}
	check := func(name string, got Bucket, want string) {
		t.Helper()
		data, _ := json.Marshal(got)
		if string(data) != want {
			t.Errorf("%s: %s, want %s", name, data, want)
		}
	}
	check("posts", stats.Posts, `{"total":3,"perSocial":[{"provider":"x","count":2},{"provider":"linkedin","count":1}]}`)
	check("errors", stats.Errors, `{"total":2,"perSocial":[{"provider":"linkedin","count":1},{"provider":"x","count":1}]}`)
	check("publishingAccounts", stats.PublishingAccounts, `{"total":1,"perSocial":[{"provider":"linkedin","count":1},{"provider":"x","count":1}]}`)
	check("scheduledAccounts", stats.ScheduledAccounts, `{"total":2,"perSocial":[{"provider":"x","count":2},{"provider":"linkedin","count":1}]}`)
	check("publishingChannels", stats.PublishingChannels, `{"total":3,"perSocial":[{"provider":"x","count":2},{"provider":"linkedin","count":1}]}`)
	check("scheduledChannels", stats.ScheduledChannels, `{"total":4,"perSocial":[{"provider":"x","count":3},{"provider":"linkedin","count":1}]}`)
	check("activeOrgsBySource", stats.ActiveOrgsBySource, `{"total":2,"perSocial":[{"provider":"WEB","count":2},{"provider":"API","count":1},{"provider":"MCP","count":1}]}`)
	check("connected", stats.Connected, `{"total":4,"perSocial":[{"provider":"x","count":3},{"provider":"linkedin","count":1}]}`)
	check("connectedClients", stats.ConnectedClients, `{"total":2,"perSocial":[{"provider":"claude","count":2}]}`)

	unknown, _ := s.GetStats(ctx, StatsParams{From: from, To: to, UnknownOnly: true})
	check("unknown errors", unknown.Errors, `{"total":1,"perSocial":[{"provider":"x","count":1}]}`)

	activity, err := s.GetOrgActivity(ctx, OrgActivityParams{From: from, To: to, OrganizationID: org1.ID})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(activity.PostsByState)
	if string(data) != `[{"state":"PUBLISHED","count":3},{"state":"ERROR","count":1}]` {
		t.Errorf("postsByState: %s", data)
	}
	check("channels", activity.Channels, `{"total":3,"perSocial":[{"provider":"x","count":2},{"provider":"linkedin","count":1}]}`)
	if activity.FirstActivityAt == nil || *activity.FirstActivityAt != "2026-03-10T12:00:00.000Z" || activity.From != "2026-03-10T11:00:00.000Z" {
		t.Errorf("activity range: %v %s", activity.FirstActivityAt, activity.From)
	}
	empty, _ := s.GetOrgActivity(ctx, OrgActivityParams{From: from, To: to, OrganizationID: "none"})
	if data, _ := json.Marshal(empty); empty.FirstActivityAt != nil || empty.PostsByState == nil {
		t.Errorf("empty org: %s", data)
	}
}
