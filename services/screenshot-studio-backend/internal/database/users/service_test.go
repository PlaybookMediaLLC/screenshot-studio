package users

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	dtousers "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/users"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

type fakeIntegrations struct{ deleted []string }

func (f *fakeIntegrations) DeleteIntegrationsForAccount(_ context.Context, org string) error {
	f.deleted = append(f.deleted, org)
	return nil
}

// fakeNotifier is called concurrently by SwitchUser (Promise.all).
type fakeNotifier struct {
	mu   sync.Mutex
	sent []string
}

func (f *fakeNotifier) HasEmailProvider() bool { return true }

func (f *fakeNotifier) SendEmail(_ context.Context, to, _, html, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, to+"|"+html)
	return nil
}

func ptr[T any](v T) *T { return &v }

func newUser(client *ent.Client, email string) *ent.User {
	return client.User.Create().SetEmail(email).SetName("Jane").SetPassword("hash-" + email).
		SetProviderName(user.ProviderNameLOCAL).SetTimezone(0).SaveX(context.Background())
}

func member(client *ent.Client, org *ent.Organization, u *ent.User, role userorganization.Role) {
	client.UserOrganization.Create().SetOrganization(org).SetUser(u).SetRole(role).ExecX(context.Background())
}

func setup(t *testing.T) (*ent.Client, *Service, *fakeIntegrations, *fakeNotifier) {
	client := dbtest.Open(t)
	integrations, notifier := &fakeIntegrations{}, &fakeNotifier{}
	return client, NewService(NewRepository(client), organizations.NewRepository(client), integrations, notifier), integrations, notifier
}

func TestDeleteAccount(t *testing.T) {
	client, service, integrations, _ := setup(t)
	ctx := context.Background()
	me, mate := newUser(client, "Me@X.io"), newUser(client, "mate@x.io")
	owned := client.Organization.Create().SetName("Owned").SaveX(ctx)
	member(client, owned, me, userorganization.RoleSUPERADMIN)
	member(client, owned, mate, userorganization.RoleUSER)
	joined := client.Organization.Create().SetName("Joined").SaveX(ctx)
	member(client, joined, mate, userorganization.RoleSUPERADMIN)
	member(client, joined, me, userorganization.RoleADMIN)

	_, err := service.DeleteAccount(ctx, me.ID)
	if httpErr, ok := err.(*httpx.Error); !ok || httpErr.Message() != "Please remove your team members before deleting your account" {
		t.Fatalf("got %v", err)
	}

	client.UserOrganization.Update().Where(userorganization.UserID(mate.ID), userorganization.OrganizationID(owned.ID)).SetDisabled(true).ExecX(ctx)
	res, err := service.DeleteAccount(ctx, me.ID)
	if err != nil || len(res.DeletedOrgs) != 1 || res.DeletedOrgs[0].ID != owned.ID {
		t.Fatalf("delete %+v %v", res, err)
	}
	if len(integrations.deleted) != 1 || integrations.deleted[0] != owned.ID {
		t.Errorf("integrations deleted for %v", integrations.deleted)
	}
	if client.Organization.GetX(ctx, owned.ID).DeletedAt == nil {
		t.Error("owned org not soft deleted")
	}
	if client.UserOrganization.Query().Where(userorganization.UserID(me.ID), userorganization.OrganizationID(joined.ID)).ExistX(ctx) {
		t.Error("membership of the joined org not removed")
	}
	gone := client.User.GetX(ctx, me.ID)
	// md5("me@x.io")
	if !strings.HasPrefix(gone.Email, "deleted_") || len(gone.Email) != len("deleted_")+32+1+5 || gone.Password != nil || gone.DeletedAt == nil {
		t.Errorf("not anonymized %+v", gone)
	}
	if gone.Name == nil || *gone.Name == "Jane" || len(*gone.Name) != 32 {
		t.Errorf("name not hashed %v", gone.Name)
	}
	if again, err := NewRepository(client).DeleteAccount(ctx, me.ID); err != nil || again != nil {
		t.Errorf("second delete %v %v", again, err)
	}
}

func TestSwitchUserAndProfile(t *testing.T) {
	client, service, _, notifier := setup(t)
	ctx := context.Background()
	a, b := newUser(client, "a@x.io"), newUser(client, "b@x.io")
	client.User.UpdateOne(b).SetProviderName(user.ProviderNameGOOGLE).SetProviderID("g-1").ClearPassword().ExecX(ctx)

	res, err := service.SwitchUser(ctx, a.ID, b.ID, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kept.ID != a.ID || res.Kept.Email != "b@x.io" || res.Switched.ID != b.ID || res.Switched.Email != "a@x.io" {
		t.Errorf("result %+v", res)
	}
	na, nb := client.User.GetX(ctx, a.ID), client.User.GetX(ctx, b.ID)
	if na.Email != "b@x.io" || na.ProviderName != user.ProviderNameGOOGLE || na.Password != nil || *na.ProviderID != "g-1" {
		t.Errorf("a now %+v", na)
	}
	if nb.Email != "a@x.io" || nb.ProviderName != user.ProviderNameLOCAL || *nb.Password != "hash-a@x.io" {
		t.Errorf("b now %+v", nb)
	}
	if len(notifier.sent) != 2 {
		t.Errorf("sent %v", notifier.sent)
	}
	if _, err := service.SwitchUser(ctx, a.ID, "missing", "admin"); err == nil || err.Error() != "User not found" {
		t.Errorf("got %v", err)
	}

	// Case-insensitive, LOCAL logins only.
	if found, err := service.GetUserByEmail(ctx, "A@X.IO"); err != nil || found == nil || found.ID != b.ID {
		t.Errorf("a@x.io is b's LOCAL login now: %v %v", found, err)
	}
	if found, _ := service.GetUserByEmail(ctx, "B@x.io"); found != nil {
		t.Error("b@x.io belongs to a GOOGLE login now")
	}

	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	picture := client.Media.Create().SetName("p").SetPath("https://cdn/p.png").SetOrganization(org).SaveX(ctx)
	if err := service.ChangePersonal(ctx, a.ID, &dtousers.UserDetailDto{Fullname: "Ann", Bio: ptr("hi"), Picture: &dtousers.MediaDto{ID: ptr(picture.ID)}}); err != nil {
		t.Fatal(err)
	}
	personal, err := service.GetPersonal(ctx, a.ID)
	if err != nil || *personal.Name != "Ann" || *personal.Bio != "hi" || personal.Picture == nil || personal.Picture.Path != "https://cdn/p.png" {
		t.Fatalf("personal %+v %v", personal, err)
	}
	if err := service.ChangePersonal(ctx, a.ID, &dtousers.UserDetailDto{Fullname: "Ann"}); err != nil {
		t.Fatal(err)
	}
	if personal, _ := service.GetPersonal(ctx, a.ID); personal.Picture != nil || *personal.Bio != "hi" {
		t.Errorf("picture must be disconnected and bio kept: %+v", personal)
	}

	if err := service.UpdateEmailNotifications(ctx, a.ID, &dtousers.EmailNotificationsDto{SendSuccessEmails: ptr(false), SendFailureEmails: ptr(true), SendStreakEmails: ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if prefs, _ := service.GetEmailNotifications(ctx, a.ID); prefs.SendSuccessEmails || !prefs.SendFailureEmails || prefs.SendStreakEmails {
		t.Errorf("prefs %+v", prefs)
	}

	// updatePassword only touches LOCAL users.
	if _, err := service.UpdatePassword(ctx, a.ID, "newpass"); !ent.IsNotFound(err) {
		t.Errorf("GOOGLE user password update: %v", err)
	}
	if _, err := service.UpdatePassword(ctx, b.ID, "newpass"); err != nil {
		t.Error(err)
	}
}

func TestActiveSubscriptionByEmail(t *testing.T) {
	client, service, _, _ := setup(t)
	ctx := context.Background()
	local := newUser(client, "dup@x.io")
	google := client.User.Create().SetEmail("dup@x.io").SetProviderName(user.ProviderNameGOOGLE).SetTimezone(0).SaveX(ctx)
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	member(client, org, google, userorganization.RoleSUPERADMIN)

	if found, err := service.GetUserWithActiveSubscriptionByEmail(ctx, "dup@x.io", local.ID); err != nil || found != nil {
		t.Fatalf("no subscription yet: %v %v", found, err)
	}
	client.Subscription.Create().SetOrganization(org).SetSubscriptionTier("PRO").SetPeriod("MONTHLY").SetTotalChannels(1).ExecX(ctx)
	found, err := service.GetUserWithActiveSubscriptionByEmail(ctx, "dup@x.io", local.ID)
	if err != nil || found == nil || found.ID != google.ID || found.ProviderName != user.ProviderNameGOOGLE {
		t.Fatalf("found %+v %v", found, err)
	}
}
