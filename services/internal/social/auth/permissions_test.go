package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/subscription"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

type fakePerms struct {
	sub          *ent.Subscription
	integrations []*ent.Integration
	internal     map[string]bool
	webhooks     int
	posts        int
	postsFrom    time.Time
}

func (f *fakePerms) GetSubscriptionByOrganizationID(context.Context, string) (*ent.Subscription, error) {
	return f.sub, nil
}
func (f *fakePerms) GetSubscription(context.Context, string) (*ent.Subscription, error) {
	return f.sub, nil
}
func (f *fakePerms) CountPostsFromDay(_ context.Context, _ string, from time.Time) (int, error) {
	f.postsFrom = from
	return f.posts, nil
}
func (f *fakePerms) GetIntegrationByInternalID(_ context.Context, _, id string) (*ent.Integration, error) {
	if f.internal[id] {
		return &ent.Integration{ID: id}, nil
	}
	return nil, nil
}
func (f *fakePerms) GetIntegrationsList(context.Context, string) ([]*ent.Integration, error) {
	return f.integrations, nil
}
func (f *fakePerms) GetTotal(context.Context, string) (int, error) { return f.webhooks, nil }

func perms(f *fakePerms) *PermissionsService { return NewPermissionsService(f, f, f, f) }

func channels(n, refreshNeeded int) []*ent.Integration {
	var list []*ent.Integration
	for i := 0; i < n; i++ {
		list = append(list, &ent.Integration{RefreshNeeded: i < refreshNeeded})
	}
	return list
}

func TestCheckWithoutStripeGrantsEverything(t *testing.T) {
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "")
	ability, err := perms(&fakePerms{}).Check(context.Background(), "o", time.Now(), "USER",
		[]AbilityPolicy{Policy(ActionCreate, SectionAdmin), Policy(ActionRead, SectionChannel)}, "")
	if err != nil || !ability.Can(ActionCreate, SectionAdmin) || !ability.Can(ActionRead, SectionChannel) {
		t.Fatal(ability, err)
	}
}

func TestCheckMatrix(t *testing.T) {
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	team := &ent.Subscription{SubscriptionTier: subscription.SubscriptionTierTEAM, TotalChannels: 10, CreatedAt: time.Now().AddDate(0, -2, -3)}
	standard := &ent.Subscription{SubscriptionTier: subscription.SubscriptionTierSTANDARD, TotalChannels: 5}

	cases := []struct {
		name    string
		f       *fakePerms
		role    string
		policy  AbilityPolicy
		refresh string
		want    bool
	}{
		{"free has no channels", &fakePerms{}, "ADMIN", Policy(ActionCreate, SectionChannel), "", false},
		{"team under limit", &fakePerms{sub: team, integrations: channels(9, 0)}, "USER", Policy(ActionCreate, SectionChannel), "", true},
		{"team at limit", &fakePerms{sub: team, integrations: channels(10, 0)}, "USER", Policy(ActionCreate, SectionChannel), "", false},
		{"refresh-needed channels don't count", &fakePerms{sub: team, integrations: channels(10, 1)}, "USER", Policy(ActionCreate, SectionChannel), "", true},
		{"refresh existing channel", &fakePerms{sub: team, integrations: channels(10, 0), internal: map[string]bool{"x": true}}, "USER", Policy(ActionCreate, SectionChannel), "x", true},
		{"refresh foreign channel", &fakePerms{sub: team, integrations: channels(10, 0)}, "USER", Policy(ActionCreate, SectionChannel), "x", false},
		{"webhooks under limit", &fakePerms{sub: standard, webhooks: 1}, "USER", Policy(ActionCreate, SectionWebhooks), "", true},
		{"webhooks grants create only", &fakePerms{sub: standard, webhooks: 1}, "USER", Policy(ActionRead, SectionWebhooks), "", false},
		{"webhooks at limit", &fakePerms{sub: standard, webhooks: 2}, "USER", Policy(ActionCreate, SectionWebhooks), "", false},
		{"posts under limit", &fakePerms{sub: team, posts: 5}, "USER", Policy(ActionCreate, SectionPostsPerMonth), "", true},
		{"free posts", &fakePerms{}, "USER", Policy(ActionCreate, SectionPostsPerMonth), "", false},
		{"team members on team", &fakePerms{sub: team}, "USER", Policy(ActionCreate, SectionTeamMembers), "", true},
		{"team members on standard", &fakePerms{sub: standard}, "USER", Policy(ActionCreate, SectionTeamMembers), "", false},
		{"admin as ADMIN", &fakePerms{}, "ADMIN", Policy(ActionRead, SectionAdmin), "", true},
		{"admin as SUPERADMIN", &fakePerms{}, "SUPERADMIN", Policy(ActionRead, SectionAdmin), "", true},
		{"admin as USER", &fakePerms{sub: team}, "USER", Policy(ActionRead, SectionAdmin), "", false},
		{"admin from public api", &fakePerms{sub: team}, "", Policy(ActionRead, SectionAdmin), "", false},
		{"community on team", &fakePerms{sub: team}, "USER", Policy(ActionRead, SectionCommunityFeatures), "", true},
		{"community on standard", &fakePerms{sub: standard}, "USER", Policy(ActionRead, SectionCommunityFeatures), "", false},
		{"featured on team", &fakePerms{sub: team}, "USER", Policy(ActionRead, SectionFeaturedByGitroom), "", true},
		{"ai on standard", &fakePerms{sub: standard}, "USER", Policy(ActionCreate, SectionAI), "", true},
		{"ai on free", &fakePerms{}, "USER", Policy(ActionCreate, SectionAI), "", false},
		{"import on standard", &fakePerms{sub: standard}, "USER", Policy(ActionCreate, SectionImportFromChannels), "", true},
		{"videos never granted", &fakePerms{sub: team}, "ADMIN", Policy(ActionCreate, SectionVideosPerMonth), "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ability, err := perms(tc.f).Check(context.Background(), "o", time.Now(), tc.role, []AbilityPolicy{tc.policy}, tc.refresh)
			if err != nil {
				t.Fatal(err)
			}
			if got := ability.Can(tc.policy.Action, tc.policy.Section); got != tc.want {
				t.Fatalf("got %v", got)
			}
		})
	}
}

func TestPostsPerMonthPeriodStart(t *testing.T) {
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	created := time.Now().UTC().AddDate(0, -3, -2)
	f := &fakePerms{sub: &ent.Subscription{SubscriptionTier: subscription.SubscriptionTierPRO, CreatedAt: created}}
	if _, err := perms(f).Check(context.Background(), "o", time.Now(), "USER", []AbilityPolicy{Policy(ActionCreate, SectionPostsPerMonth)}, ""); err != nil {
		t.Fatal(err)
	}
	if want := addMonths(created, 3); !f.postsFrom.Equal(want) {
		t.Fatalf("from %v want %v", f.postsFrom, want)
	}
}

func TestDayjsMonthHelpers(t *testing.T) {
	d := func(s string) time.Time { v, _ := time.Parse(time.DateTime, s); return v }
	if got := addMonths(d("2024-01-31 10:00:00"), 1); !got.Equal(d("2024-02-29 10:00:00")) {
		t.Fatal(got)
	}
	if got := addMonths(d("2024-03-31 00:00:00"), -1); !got.Equal(d("2024-02-29 00:00:00")) {
		t.Fatal(got)
	}
	// dayjs('2024-01-15').diff('2024-03-20', 'month') === -2
	if got := absFloor(monthDiff(d("2024-01-15 00:00:00"), d("2024-03-20 00:00:00"))); got != -2 {
		t.Fatal(got)
	}
	// dayjs('2024-01-31').diff('2024-03-30', 'month') === -1
	if got := absFloor(monthDiff(d("2024-01-31 00:00:00"), d("2024-03-30 00:00:00"))); got != -1 {
		t.Fatal(got)
	}
	// dayjs('2024-03-20').diff('2024-01-15', 'month') === 2
	if got := absFloor(monthDiff(d("2024-03-20 00:00:00"), d("2024-01-15 00:00:00"))); got != 2 {
		t.Fatal(got)
	}
}

func TestCheckPoliciesGuard(t *testing.T) {
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	t.Setenv("FRONTEND_URL", "https://app.postiz.com")
	p := perms(&fakePerms{})
	withOrg := func(c *httpx.Ctx) error {
		c.Org = &ent.Organization{ID: "o", Edges: ent.OrganizationEdges{Users: []*ent.UserOrganization{{Role: userorganization.RoleUSER}}}}
		return nil
	}
	run := func(path string, policies ...AbilityPolicy) (int, string) {
		r := httpx.NewRouter()
		r.Group("", withOrg).Post(path, func(c *httpx.Ctx) (any, error) { return "ok", nil }, p.CheckPolicies(policies...))
		rec := httptestRecorder(r, "POST", path)
		return rec.Code, strings.TrimSpace(rec.Body.String())
	}

	code, body := run("/posts", Policy(ActionCreate, SectionPostsPerMonth))
	if code != 402 || body != `{"statusCode":402,"message":"You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts.","url":"https://app.postiz.com/billing"}` {
		t.Fatalf("%d %s", code, body)
	}
	code, body = run("/settings/team", Policy(ActionCreate, SectionTeamMembers))
	if code != 402 || body != `{"statusCode":402,"url":"https://app.postiz.com/billing"}` {
		t.Fatalf("%d %s", code, body)
	}
	if code, _ := run("/integrations/social-connect/x", Policy(ActionCreate, SectionChannel)); code != 201 {
		t.Fatalf("social-connect should skip: %d", code)
	}
	if code, _ := run("/auth/thing", Policy(ActionCreate, SectionChannel)); code != 201 {
		t.Fatalf("auth should skip: %d", code)
	}
	if code, _ := run("/posts"); code != 201 {
		t.Fatalf("no policies: %d", code)
	}
}

func httptestRecorder(h http.Handler, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestPostValidationException(t *testing.T) {
	r := httpx.NewRouter()
	r.Group("").Post("/posts", func(c *httpx.Ctx) (any, error) {
		return nil, PostValidationException(PostValidationError{Provider: "x", Name: "X", Error: "too long"})
	})
	rec := httptestRecorder(r, "POST", "/posts")
	if rec.Code != 400 || strings.TrimSpace(rec.Body.String()) != `{"statusCode":400,"provider":"x","name":"X","message":"too long"}` {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}
