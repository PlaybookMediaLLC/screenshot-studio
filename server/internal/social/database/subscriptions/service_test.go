package subscriptions

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/subscription"
)

// fakeIntegrations reads channels from the database and records calls.
type fakeIntegrations struct {
	client *ent.Client
	calls  []string
}

func (f *fakeIntegrations) GetIntegrationsList(ctx context.Context, org string) ([]*ent.Integration, error) {
	return f.client.Integration.Query().Where(integration.OrganizationID(org), integration.DeletedAtIsNil()).All(ctx)
}

func (f *fakeIntegrations) DisableIntegrations(_ context.Context, _ string, n int) error {
	f.calls = append(f.calls, fmt.Sprintf("disable %d", n))
	return nil
}

func (f *fakeIntegrations) EnableAllIntegrations(context.Context, string) (int, error) {
	f.calls = append(f.calls, "enableAll")
	return 0, nil
}

func (f *fakeIntegrations) ChangeActiveCron(context.Context, string) (bool, error) {
	f.calls = append(f.calls, "changeActiveCron")
	return true, nil
}

type fakeOrgs struct{ calls []string }

func (f *fakeOrgs) DisableOrEnableNonSuperAdminUsers(_ context.Context, _ string, disable bool) (int, error) {
	f.calls = append(f.calls, fmt.Sprintf("disableTeam %v", disable))
	return 0, nil
}

func setup(t *testing.T) (*ent.Client, *Service, *fakeIntegrations, *fakeOrgs) {
	client := dbtest.Open(t)
	integrations, orgs := &fakeIntegrations{client: client}, &fakeOrgs{}
	return client, NewService(NewRepository(client), integrations, orgs), integrations, orgs
}

func addChannels(t *testing.T, client *ent.Client, org *ent.Organization, enabled, disabled int) {
	for i := 0; i < enabled+disabled; i++ {
		client.Integration.Create().SetOrganization(org).SetInternalID(fmt.Sprint(i)).SetName("c").
			SetProviderIdentifier("x").SetType("social").SetToken("t").SetDisabled(i >= enabled).
			ExecX(context.Background())
	}
}

func TestCreateModifyDelete(t *testing.T) {
	client, service, integrations, orgs := setup(t)
	ctx := context.Background()
	org := client.Organization.Create().SetName("Acme").SetPaymentID("cus_1").SetAllowTrial(true).SaveX(ctx)
	addChannels(t, client, org, 2, 3)

	// Create: plan grows to hold every channel, so they are all re-enabled.
	cancelAt := int64(1893456000)
	if err := service.CreateOrUpdateSubscription(ctx, "stripe", true, "sub_1", "cus_1", 10, "TEAM", "MONTHLY", &cancelAt, "", ""); err != nil {
		t.Fatal(err)
	}
	sub := client.Subscription.Query().OnlyX(ctx)
	if sub.SubscriptionTier != subscription.SubscriptionTierTEAM || *sub.Identifier != "sub_1" || sub.IsLifetime ||
		sub.CancelAt == nil || sub.CancelAt.Unix() != cancelAt || sub.Provider != "stripe" {
		t.Errorf("created %+v", sub)
	}
	if o := client.Organization.GetX(ctx, org.ID); !o.IsTrailing || o.AllowTrial {
		t.Errorf("org trial flags %+v", o)
	}
	if fmt.Sprint(integrations.calls) != "[enableAll]" || fmt.Sprint(orgs.calls) != "[disableTeam false]" {
		t.Errorf("calls %v %v", integrations.calls, orgs.calls)
	}

	// Update: downgrade to STANDARD with 1 channel disables the extra enabled
	// channel and the team.
	integrations.calls, orgs.calls = nil, nil
	if err := service.CreateOrUpdateSubscription(ctx, "stripe", false, "sub_2", "cus_1", 1, "STANDARD", "YEARLY", nil, "", ""); err != nil {
		t.Fatal(err)
	}
	sub = client.Subscription.Query().OnlyX(ctx)
	if sub.SubscriptionTier != subscription.SubscriptionTierSTANDARD || *sub.Identifier != "sub_2" || sub.CancelAt != nil || sub.Period != subscription.PeriodYEARLY {
		t.Errorf("updated %+v", sub)
	}
	if fmt.Sprint(integrations.calls) != "[disable 1]" || fmt.Sprint(orgs.calls) != "[disableTeam true]" {
		t.Errorf("calls %v %v", integrations.calls, orgs.calls)
	}

	// Another provider's customer flow never touches it.
	if err := service.CreateOrUpdateSubscription(ctx, "revenuecat", false, "x", "cus_1", 100, "ULTIMATE", "MONTHLY", nil, "", ""); err != nil {
		t.Fatal(err)
	}
	if n, err := service.DeleteSubscription(ctx, "cus_1", "revenuecat"); err != nil || n != 0 {
		t.Errorf("foreign delete %d %v", n, err)
	}
	if client.Subscription.Query().OnlyX(ctx).SubscriptionTier != subscription.SubscriptionTierSTANDARD {
		t.Error("foreign provider changed the subscription")
	}

	// Delete: downgrade to FREE (cron stopped) and remove the row.
	integrations.calls = nil
	if n, err := service.DeleteSubscription(ctx, "cus_1", "stripe"); err != nil || n != 1 {
		t.Fatalf("delete %d %v", n, err)
	}
	if client.Subscription.Query().CountX(ctx) != 0 {
		t.Error("subscription not deleted")
	}
	if integrations.calls[len(integrations.calls)-1] != "changeActiveCron" {
		t.Errorf("calls %v", integrations.calls)
	}
}

func TestLifetimeCodeAndOrgKeyed(t *testing.T) {
	client, service, _, _ := setup(t)
	ctx := context.Background()
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)

	// A code skips the plan change and marks the subscription lifetime.
	if err := service.CreateOrUpdateSubscription(ctx, "stripe", false, "id", "", 5, "PRO", "MONTHLY", nil, "CODE1", org.ID); err != nil {
		t.Fatal(err)
	}
	if sub := client.Subscription.Query().OnlyX(ctx); !sub.IsLifetime {
		t.Errorf("not lifetime %+v", sub)
	}
	if code, err := service.GetCode(ctx, "CODE1"); err != nil || code == nil || code.OrgID != org.ID {
		t.Errorf("code %+v %v", code, err)
	}
	// Lifetime subscriptions are never removed by store flows.
	if ok, err := service.DeleteSubscriptionByOrgID(ctx, org.ID, "stripe"); err != nil || ok {
		t.Errorf("lifetime deleted %v %v", ok, err)
	}

	store := client.Organization.Create().SetName("Store").SaveX(ctx)
	if err := service.CreateOrUpdateSubscriptionByOrg(ctx, false, store.ID, "revenuecat", "prod", 10, "TEAM", "MONTHLY", nil); err != nil {
		t.Fatal(err)
	}
	if sub, _ := service.GetSubscription(ctx, store.ID); sub == nil || sub.Provider != "revenuecat" {
		t.Fatalf("store subscription %+v", sub)
	}
	if ok, err := service.DeleteSubscriptionByOrgID(ctx, store.ID, "stripe"); err != nil || ok {
		t.Errorf("other provider deleted %v %v", ok, err)
	}
	if ok, err := service.DeleteSubscriptionByOrgID(ctx, store.ID, "revenuecat"); err != nil || !ok {
		t.Errorf("delete %v %v", ok, err)
	}
}

func TestCredits(t *testing.T) {
	client, service, _, _ := setup(t)
	ctx := context.Background()
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)

	free, err := service.CheckCredits(ctx, org, "")
	if err != nil || free.Credits != 0 {
		t.Fatalf("free %+v %v", free, err)
	}

	client.Subscription.Create().SetOrganization(org).SetSubscriptionTier(subscription.SubscriptionTierSTANDARD).
		SetPeriod(subscription.PeriodMONTHLY).SetTotalChannels(5).SetCreatedAt(time.Now().AddDate(0, -2, -3)).ExecX(ctx)
	org = client.Organization.Query().WithSubscription().OnlyX(ctx)

	if err := service.UseCredit(ctx, org, "", func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	boom := errors.New("boom")
	if err := service.UseCredit(ctx, org, "", func(context.Context) error { return boom }); err != boom {
		t.Fatalf("got %v", err)
	}
	left, err := service.CheckCredits(ctx, org, "ai_images")
	if err != nil || left.Credits != Pricing["STANDARD"].ImageGenerationCount-1 {
		t.Fatalf("left %+v %v", left, err)
	}

	for i := 0; i < 2; i++ {
		if id, err := service.ChargeCredits(ctx, "clip-1", org.ID, "clipping_minutes", 7); err != nil || id != "clip-1" {
			t.Fatalf("charge %s %v", id, err)
		}
	}
	if left, _ := service.CheckCredits(ctx, org, "clipping_minutes"); left.Credits != 60-7 {
		t.Errorf("clipping left %d", left.Credits)
	}
	if n, _ := service.RefundCredits(ctx, org.ID, "clip-1"); n != 1 {
		t.Errorf("refund %d", n)
	}

	// Credits from before this period do not count, and reset only clears this period.
	client.Credits.Create().SetOrganizationID(org.ID).SetCredits(5).SetType("ai_images").SetCreatedAt(time.Now().AddDate(0, -1, -10)).ExecX(ctx)
	if left, _ := service.CheckCredits(ctx, org, "ai_images"); left.Credits != 19 {
		t.Errorf("old credits counted: %d", left.Credits)
	}
	reset, err := service.ResetCredits(ctx, org.ID, "ai_images")
	if err != nil || reset.Deleted != 1 {
		t.Errorf("reset %+v %v", reset, err)
	}
}

func TestAddMonths(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"2026-01-31", "2026-02-28"},
		{"2024-01-31", "2024-02-29"},
		{"2026-12-15", "2027-01-15"},
	} {
		in, _ := time.Parse(time.DateOnly, tc.in)
		if got := addMonths(in, 1).Format(time.DateOnly); got != tc.want {
			t.Errorf("addMonths(%s) = %s, want %s", tc.in, got, tc.want)
		}
	}
	created := time.Date(2026, 1, 31, 10, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 5, 0, 0, 0, 0, time.UTC)
	// dayjs walks Jan 31 -> Feb 28 -> Mar 28 -> Apr 28, then back one month.
	if got := currentPeriodStart(created, now); !got.Equal(time.Date(2026, 3, 28, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("period start %v", got)
	}
}
