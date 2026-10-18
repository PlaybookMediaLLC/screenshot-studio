package organizations

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/settings"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/subscription"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

type fakeNotifier struct {
	hasProvider bool
	sent        []string
}

func (f *fakeNotifier) HasEmailProvider() bool { return f.hasProvider }

func (f *fakeNotifier) SendEmail(_ context.Context, to, subject, html, _ string) error {
	f.sent = append(f.sent, to+"|"+subject+"|"+html)
	return nil
}

func ptr[T any](v T) *T { return &v }

func newUser(t *testing.T, client *ent.Client, email string) *ent.User {
	t.Helper()
	return client.User.Create().SetEmail(email).SetProviderName(user.ProviderNameLOCAL).SetTimezone(0).SaveX(context.Background())
}

func newOrg(t *testing.T, client *ent.Client, name string, u *ent.User, role userorganization.Role) *ent.Organization {
	t.Helper()
	ctx := context.Background()
	org := client.Organization.Create().SetName(name).SaveX(ctx)
	client.UserOrganization.Create().SetOrganization(org).SetUser(u).SetRole(role).SaveX(ctx)
	return org
}

func TestCreateOrgAndUser(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret")
	client := dbtest.Open(t)
	ctx := context.Background()
	repo := NewRepository(client)

	org, err := repo.CreateOrgAndUser(ctx, &auth.CreateOrgUserDto{
		Company: ptr("Acme"), Email: ptr("a@b.c"), Password: ptr("hunter22"), Provider: ptr("LOCAL"),
	}, true, "1.2.3.4", "agent")
	if err != nil {
		t.Fatal(err)
	}
	created := org.Edges.Users[0].Edges.User
	if created.Activated {
		t.Error("LOCAL sign up with an email provider must wait for activation")
	}
	if created.Password == nil || !helpers.ComparePassword("hunter22", *created.Password) {
		t.Error("password not hashed")
	}
	if org.APIKey == nil {
		t.Fatal("no api key")
	}
	if key, err := helpers.FixedDecryption(*org.APIKey); err != nil || len(key) != 20 {
		t.Errorf("api key %q %v", key, err)
	}
	if !org.AllowTrial || !org.IsTrailing {
		t.Error("new organizations start on trial")
	}
	member := client.UserOrganization.Query().OnlyX(ctx)
	if member.Role != userorganization.RoleSUPERADMIN || member.UserID != created.ID || member.OrganizationID != org.ID {
		t.Errorf("membership %+v", member)
	}

	oauth, err := repo.CreateOrgAndUser(ctx, &auth.CreateOrgUserDto{
		Company: ptr("Beta"), Email: ptr("g@b.c"), Provider: ptr("GITHUB"), ProviderID: "gh-1",
	}, true, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if u := oauth.Edges.Users[0].Edges.User; !u.Activated || *u.ProviderID != "gh-1" || *u.Password != "" {
		t.Errorf("oauth user %+v", u)
	}
}

func TestCreateMaxUser(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret")
	client := dbtest.Open(t)
	ctx := context.Background()
	out, err := NewRepository(client).CreateMaxUser(ctx, "42", "", "saas", "me@x.io")
	if err != nil {
		t.Fatal(err)
	}
	org := client.Organization.GetX(ctx, out.ID)
	if org.Name != "Unnamed User###42" || out.APIKey == nil {
		t.Errorf("org %+v", org)
	}
	sub := client.Subscription.Query().OnlyX(ctx)
	if sub.SubscriptionTier != subscription.SubscriptionTierULTIMATE || !sub.IsLifetime || sub.TotalChannels != 1000000 {
		t.Errorf("subscription %+v", sub)
	}
	if u := client.User.Query().OnlyX(ctx); u.Email != "me+saas@x.io" || !u.Activated {
		t.Errorf("user %+v", u)
	}
}

func TestGetOrgsByUserID(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	repo := NewRepository(client)
	me, other := newUser(t, client, "me@x.io"), newUser(t, client, "other@x.io")

	owned := newOrg(t, client, "Owned", me, userorganization.RoleSUPERADMIN)
	client.Subscription.Create().SetOrganization(owned).SetSubscriptionTier(subscription.SubscriptionTierPRO).
		SetPeriod(subscription.PeriodMONTHLY).SetTotalChannels(30).SaveX(ctx)
	shared := newOrg(t, client, "Shared", other, userorganization.RoleSUPERADMIN)
	client.UserOrganization.Create().SetOrganization(shared).SetUser(me).SetRole(userorganization.RoleUSER).SetDisabled(true).SaveX(ctx)
	deleted := newOrg(t, client, "Deleted", me, userorganization.RoleADMIN)
	client.Organization.UpdateOne(deleted).SetDeletedAt(time.Now()).ExecX(ctx)
	newOrg(t, client, "NotMine", other, userorganization.RoleSUPERADMIN)

	orgs, err := repo.GetOrgsByUserID(ctx, me.ID)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]*ent.Organization{}
	for _, o := range orgs {
		byName[o.Name] = o
	}
	if len(orgs) != 2 || byName["Owned"] == nil || byName["Shared"] == nil {
		t.Fatalf("got %d orgs: %v", len(orgs), byName)
	}
	if u := byName["Shared"].Edges.Users; len(u) != 1 || u[0].UserID != me.ID || u[0].Role != userorganization.RoleUSER || !u[0].Disabled {
		t.Errorf("shared membership %+v", u)
	}
	if s := byName["Owned"].Edges.Subscription; s == nil || s.SubscriptionTier != subscription.SubscriptionTierPRO {
		t.Errorf("owned subscription %+v", s)
	}
	if byName["Shared"].Edges.Subscription != nil {
		t.Error("shared has no subscription")
	}
}

func TestTeamMembers(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://app")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	client := dbtest.Open(t)
	ctx := context.Background()
	repo := NewRepository(client)
	notifier := &fakeNotifier{hasProvider: true}
	service := NewService(repo, notifier)

	owner, invitee := newUser(t, client, "owner@x.io"), newUser(t, client, "invitee@x.io")
	org := newOrg(t, client, "Acme", owner, userorganization.RoleSUPERADMIN)
	sub := client.Subscription.Create().SetOrganization(org).SetSubscriptionTier(subscription.SubscriptionTierSTANDARD).
		SetPeriod(subscription.PeriodMONTHLY).SetTotalChannels(5).SaveX(ctx)

	// STANDARD has no team members when billing is on.
	if added, err := repo.AddUserToOrg(ctx, invitee.ID, "inv1", org.ID, userorganization.RoleUSER); err != nil || added != nil {
		t.Fatalf("standard plan: %v %v", added, err)
	}
	loaded, _ := repo.GetOrgByIDWithSubscription(ctx, org.ID)
	if _, err := service.AddTeamMemberByEmail(ctx, loaded, &settings.AdminAddTeamMemberDto{Email: ptr("invitee@x.io"), Role: ptr("USER")}); !isHTTP(err, "The organization plan does not include team members") {
		t.Fatalf("got %v", err)
	}

	client.Subscription.UpdateOne(sub).SetSubscriptionTier(subscription.SubscriptionTierTEAM).ExecX(ctx)
	loaded, _ = repo.GetOrgByIDWithSubscription(ctx, org.ID)
	if _, err := service.AddTeamMemberByEmail(ctx, loaded, &settings.AdminAddTeamMemberDto{Email: ptr("nobody@x.io"), Role: ptr("USER")}); !isHTTP(err, "No Postiz account found for this email") {
		t.Fatalf("got %v", err)
	}
	if res, err := service.AddTeamMemberByEmail(ctx, loaded, &settings.AdminAddTeamMemberDto{Email: ptr("invitee@x.io"), Role: ptr("ADMIN")}); err != nil || !res.Added {
		t.Fatalf("add: %v %v", res, err)
	}
	if _, err := service.AddTeamMemberByEmail(ctx, loaded, &settings.AdminAddTeamMemberDto{Email: ptr("invitee@x.io"), Role: ptr("USER")}); !isHTTP(err, "User is already a member of this organization") {
		t.Fatalf("got %v", err)
	}

	// A used invite id cannot be reused.
	third := newUser(t, client, "third@x.io")
	if _, err := repo.AddUserToOrg(ctx, third.ID, "inv2", org.ID, userorganization.RoleUSER); err != nil {
		t.Fatal(err)
	}
	if added, err := repo.AddUserToOrg(ctx, invitee.ID, "inv2", org.ID, userorganization.RoleUSER); err != nil || added != nil {
		t.Fatalf("reused invite: %v %v", added, err)
	}

	team, err := service.GetTeam(ctx, org.ID)
	if err != nil || len(team.Users) != 3 {
		t.Fatalf("team %+v %v", team, err)
	}

	// An ADMIN cannot remove the SUPERADMIN; the SUPERADMIN can remove anyone.
	adminView, _ := repo.GetOrgsByUserID(ctx, invitee.ID)
	if _, err := service.DeleteTeamMember(ctx, adminView[0], owner.ID); err == nil || err.Error() != "You do not have permission to delete this user" {
		t.Fatalf("got %v", err)
	}
	ownerView, _ := repo.GetOrgsByUserID(ctx, owner.ID)
	if _, err := service.DeleteTeamMember(ctx, ownerView[0], invitee.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DeleteTeamMember(ctx, ownerView[0], invitee.ID); err == nil || err.Error() != "User is not part of this organization" {
		t.Fatalf("got %v", err)
	}

	// Invites sign a link and email it.
	invite, err := service.InviteTeamMember(ctx, org, owner, &settings.AddTeamMemberDto{Email: ptr("new@x.io"), Role: ptr("USER"), SendEmail: ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.TrimPrefix(invite.URL, "https://app/?org=")
	claims, err := helpers.VerifyJWT(token)
	if err != nil || claims["orgId"] != org.ID || claims["email"] != "new@x.io" || claims["role"] != "USER" || len(claims["id"].(string)) != 5 {
		t.Fatalf("claims %v %v", claims, err)
	}
	if len(notifier.sent) != 1 || !strings.HasPrefix(notifier.sent[0], `new@x.io|owner@x.io invited you to join "Acme"|owner@x.io has invited you`) {
		t.Errorf("sent %v", notifier.sent)
	}

	if n, err := repo.DisableOrEnableNonSuperAdminUsers(ctx, org.ID, true); err != nil || n != 1 {
		t.Errorf("disabled %d %v", n, err)
	}
}

func TestAccountOverviewStreakAndApi(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	repo := NewRepository(client)
	service := NewService(repo, &fakeNotifier{})
	owner := newUser(t, client, "owner@x.io")
	org := newOrg(t, client, "Acme", owner, userorganization.RoleSUPERADMIN)

	overview, err := repo.GetAccountOverview(ctx, org.ID)
	if err != nil || overview.Owner == nil || overview.Owner.Email != "owner@x.io" || overview.Users.Total != 1 || overview.Subscription != nil {
		t.Fatalf("overview %+v %v", overview, err)
	}
	if missing, err := repo.GetAccountOverview(ctx, "missing"); err != nil || missing != nil {
		t.Fatalf("missing %v %v", missing, err)
	}

	ok, err := service.CanUseSuperAdminAPI(ctx, org.ID)
	if err != nil || ok {
		t.Fatalf("no super admin user yet: %v %v", ok, err)
	}
	client.User.UpdateOne(owner).SetIsSuperAdmin(true).ExecX(ctx)
	if ok, _ := service.CanUseSuperAdminAPI(ctx, org.ID); !ok {
		t.Fatal("super admin alone can use the API")
	}

	repo.SetStreak(ctx, org.ID, "start")
	started := client.Organization.GetX(ctx, org.ID).StreakSince
	if started == nil {
		t.Fatal("streak not started")
	}
	repo.SetStreak(ctx, org.ID, "start")
	if again := client.Organization.GetX(ctx, org.ID).StreakSince; !again.Equal(*started) {
		t.Error("a running streak must not restart")
	}
	repo.SetStreak(ctx, org.ID, "end")
	if client.Organization.GetX(ctx, org.ID).StreakSince != nil {
		t.Error("streak not ended")
	}

	if last, err := repo.GetLastPublishDate(ctx, org.ID); err != nil || last != nil {
		t.Fatalf("no posts: %v %v", last, err)
	}
	integration := client.Integration.Create().SetOrganization(org).SetInternalID("1").SetName("X").
		SetProviderIdentifier("x").SetType("social").SetToken("t").SaveX(ctx)
	published := time.Now().Add(-time.Hour).Truncate(time.Millisecond)
	client.Post.Create().SetOrganization(org).SetIntegration(integration).SetContent("a").SetGroup("g").
		SetState(post.StatePUBLISHED).SetPublishDate(published).ExecX(ctx)
	client.Post.Create().SetOrganization(org).SetIntegration(integration).SetContent("b").SetGroup("g").
		SetState(post.StatePUBLISHED).SetPublishDate(time.Now().Add(24 * time.Hour)).ExecX(ctx)
	last, err := repo.GetLastPublishDate(ctx, org.ID)
	if err != nil || last == nil || *last > time.Now().UnixMilli() || *last < published.UnixMilli() {
		t.Fatalf("last publish date %v %v", last, err)
	}

	pref, err := repo.GetShortlinkPreference(ctx, org.ID)
	if err != nil || pref.Shortlink != "ASK" {
		t.Fatalf("shortlink %+v %v", pref, err)
	}
}

func isHTTP(err error, message string) bool {
	httpErr, ok := err.(*httpx.Error)
	if !ok || httpErr.Status != 400 {
		return false
	}
	return httpErr.Message() == message
}
