package integration

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	integrationsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/integrations"
	plugsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/plugs"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
)

type fakeProvider struct {
	*integrations.Base
	id            string
	analyticsHits int
	plugRuns      int
	refresh       func() (*integrations.AuthTokenDetails, error)
}

func newFake(id string) *fakeProvider {
	return &fakeProvider{Base: integrations.NewBase(id, nil), id: id}
}

func (f *fakeProvider) Info() integrations.Info {
	return integrations.Info{Identifier: f.id, Name: f.id}
}
func (f *fakeProvider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 100 }
func (f *fakeProvider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	return nil, nil
}
func (f *fakeProvider) Authenticate(context.Context, integrations.AuthenticateParams, *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	return nil, nil
}
func (f *fakeProvider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	if f.refresh == nil {
		return nil, errors.New("no refresh")
	}
	return f.refresh()
}
func (f *fakeProvider) Post(context.Context, string, string, []integrations.PostDetails, *ent.Integration) ([]integrations.PostResponse, error) {
	return nil, nil
}
func (f *fakeProvider) Analytics(context.Context, string, string, int) ([]integrations.AnalyticsData, error) {
	f.analyticsHits++
	return []integrations.AnalyticsData{{Label: "Followers", Data: []integrations.AnalyticsItem{{Total: "1", Date: "2026-01-01"}}}}, nil
}
func (f *fakeProvider) Plugs() []integrations.Plug {
	return []integrations.Plug{{MethodName: "autoRepost", Run: func(_ context.Context, _ *ent.Integration, _ string, fields map[string]string) (bool, error) {
		f.plugRuns++
		return fields["likes"] == "fire", nil
	}}}
}

type fakeUploader struct{}

func (fakeUploader) UploadSimple(_ context.Context, path string) (string, error) {
	return "https://cdn/" + path, nil
}

type notification struct{ org, subject, message string }

type fakeNotifications struct{ sent []notification }

func (n *fakeNotifications) InAppNotification(_ context.Context, orgID, subject, message string, _, _ bool, _ string) error {
	n.sent = append(n.sent, notification{orgID, subject, message})
	return nil
}

type fixture struct {
	ctx           context.Context
	client        *ent.Client
	service       *Service
	notifications *fakeNotifications
	providers     map[string]*fakeProvider
	org           *ent.Organization
}

func setup(t *testing.T, providers ...string) *fixture {
	t.Helper()
	client := dbtest.Open(t)
	ctx := context.Background()
	f := &fixture{ctx: ctx, client: client, notifications: &fakeNotifications{}, providers: map[string]*fakeProvider{}}
	var list []integrations.Provider
	for _, id := range providers {
		p := newFake(id)
		f.providers[id] = p
		list = append(list, p)
	}
	f.service = NewService(NewRepository(client, fakeUploader{}), nil, integrations.NewManager(list), f.notifications, nil, redis.NewMemory(), fakeUploader{})
	f.org = client.Organization.Create().SetName("Acme").SaveX(ctx)
	return f
}

func str(s string) *string { return &s }

func (f *fixture) connect(t *testing.T, p CreateOrUpdateIntegrationParams) *ent.Integration {
	t.Helper()
	if p.Org == "" {
		p.Org = f.org.ID
	}
	if p.Type == "" {
		p.Type = "social"
	}
	i, err := f.service.CreateOrUpdateIntegration(f.ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	return i
}

func TestCreateOrUpdateIntegrationUpsert(t *testing.T) {
	f := setup(t, "x")
	first := f.connect(t, CreateOrUpdateIntegrationParams{
		Name: "Alice", Picture: "https://imagedelivery.net/a.png", InternalID: "u1", Provider: "x",
		Token: "t1", RefreshToken: "r1", Username: str("alice"), Timezone: 60,
	})
	if first.PostingTimes != `[{"time":500},{"time":790},{"time":1080}]` {
		t.Errorf("posting times: %s", first.PostingTimes)
	}
	if first.TokenExpiration == nil || first.TokenExpiration.Before(time.Now().AddDate(30, 0, 0)) {
		t.Errorf("default expiresIn not applied: %v", first.TokenExpiration)
	}
	if first.RootInternalID == nil || *first.RootInternalID != "u1" || *first.Picture != "https://imagedelivery.net/a.png" {
		t.Errorf("create: %+v", first)
	}

	// soft delete, then reconnect with no refresh token: same row, revived,
	// refresh token kept, picture uploaded
	f.client.Integration.UpdateOneID(first.ID).SetDeletedAt(time.Now()).SetRefreshNeeded(true).ExecX(f.ctx)
	expires := int64(60)
	second := f.connect(t, CreateOrUpdateIntegrationParams{
		Name: "Alice", Picture: "p.png", InternalID: "u1", Provider: "x", Token: "t2", ExpiresIn: &expires,
	})
	if second.ID != first.ID {
		t.Fatalf("upsert created a new row")
	}
	if second.DeletedAt != nil || second.RefreshNeeded || second.Token != "t2" || *second.RefreshToken != "r1" {
		t.Errorf("update: %+v token=%s refresh=%v", second, second.Token, second.RefreshToken)
	}
	if *second.Picture != "https://cdn/p.png" || *second.Profile != "alice" {
		t.Errorf("picture/profile: %v %v", *second.Picture, *second.Profile)
	}
	if second.TokenExpiration.After(time.Now().Add(2 * time.Minute)) {
		t.Errorf("expiresIn ignored: %v", second.TokenExpiration)
	}

	// one-time tokens are shared by every channel of the same root
	sibling := f.client.Integration.Create().SetOrganizationID(f.org.ID).SetInternalID("page").SetName("Page").
		SetProviderIdentifier("x").SetType("social").SetToken("old").SetRootInternalID("u1").SaveX(f.ctx)
	f.connect(t, CreateOrUpdateIntegrationParams{OneTimeToken: true, Name: "Alice", InternalID: "u1", Provider: "x", Token: "t3", RefreshToken: "r3"})
	sibling = f.client.Integration.GetX(f.ctx, sibling.ID)
	if sibling.Token != "t3" || *sibling.RefreshToken != "r3" {
		t.Errorf("one-time token not propagated: %s", sibling.Token)
	}
	otherOrg := f.client.Organization.Create().SetName("Other workspace").SaveX(f.ctx)
	foreign := f.client.Integration.Create().SetOrganizationID(otherOrg.ID).SetInternalID("foreign").SetName("Foreign").
		SetProviderIdentifier("x").SetType("social").SetToken("foreign-token").SetRootInternalID("u1").SaveX(f.ctx)
	otherProvider := f.client.Integration.Create().SetOrganizationID(f.org.ID).SetInternalID("other-provider").SetName("Other provider").
		SetProviderIdentifier("different").SetType("social").SetToken("other-token").SetRootInternalID("u1").SaveX(f.ctx)
	f.connect(t, CreateOrUpdateIntegrationParams{OneTimeToken: true, Name: "Alice", InternalID: "u1", Provider: "x", Token: "t4"})
	sibling = f.client.Integration.GetX(f.ctx, sibling.ID)
	if sibling.Token != "t4" || sibling.RefreshToken == nil || *sibling.RefreshToken != "r3" {
		t.Fatal("empty refresh response erased sibling credentials")
	}
	if f.client.Integration.GetX(f.ctx, foreign.ID).Token != "foreign-token" || f.client.Integration.GetX(f.ctx, otherProvider.ID).Token != "other-token" {
		t.Fatal("one-time token update escaped workspace/provider scope")
	}
	withoutRefresh := f.connect(t, CreateOrUpdateIntegrationParams{Name: "New account", InternalID: "no-refresh", Provider: "x", Token: "access"})
	if withoutRefresh.RefreshToken != nil {
		t.Fatal("absent refresh token did not stay NULL")
	}
}

func TestMigrateIntegrationOnConnect(t *testing.T) {
	t.Setenv("MIGRATE_PROVIDERS", "old:new")
	f := setup(t, "old", "new")
	old := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Alice", InternalID: "old-id", Provider: "old", Token: "t", Username: str("alice")})

	// a different account is not adopted
	if got, err := f.service.MigrateIntegrationOnConnect(f.ctx, f.org.ID, "new", integrations.AuthTokenDetails{ID: "other", Username: "bob"}); err != nil || got != nil {
		t.Fatalf("adopted another account: %v %v", got, err)
	}

	migrated, err := f.service.MigrateIntegrationOnConnect(f.ctx, f.org.ID, "new", integrations.AuthTokenDetails{ID: "new-id", Username: "alice"})
	if err != nil || migrated == nil {
		t.Fatalf("migrate: %v %v", migrated, err)
	}
	if migrated.ID != old.ID || migrated.ProviderIdentifier != "new" || migrated.InternalID != "new-id" || *migrated.RootInternalID != "new-id" {
		t.Errorf("migrated: %+v", migrated)
	}
	// the follow-up upsert lands on the same channel
	again := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Alice", InternalID: "new-id", Provider: "new", Token: "fresh"})
	if again.ID != old.ID || again.Token != "fresh" {
		t.Errorf("upsert after migration: %+v", again)
	}

	// reconnect migration: unconfigured source is refused
	var scopes *integrations.NotEnoughScopes
	if _, err := f.service.MigrateIntegration(f.ctx, f.org.ID, "new-id", "old", integrations.AuthTokenDetails{ID: "x"}); !errors.As(err, &scopes) ||
		scopes.Message != "Please refresh the channel that needs to be refreshed" {
		t.Errorf("expected NotEnoughScopes, got %v", err)
	}
}

func TestGetIntegrationsListAndChannels(t *testing.T) {
	f := setup(t, "x")
	a := f.connect(t, CreateOrUpdateIntegrationParams{Name: "A", InternalID: "a", Provider: "x", Token: "t"})
	b := f.connect(t, CreateOrUpdateIntegrationParams{Name: "B", InternalID: "b", Provider: "x", Token: "t"})
	if _, err := f.service.UpdateOnCustomerName(f.ctx, f.org.ID, a.ID, "Client"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.DeleteChannel(f.ctx, f.org.ID, b.ID); err != nil {
		t.Fatal(err)
	}
	list, err := f.service.GetIntegrationsList(f.ctx, f.org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != a.ID || list[0].Edges.Customer == nil || list[0].Edges.Customer.Name != "Client" {
		t.Fatalf("list: %+v", list)
	}
	data, _ := json.Marshal(list[0])
	var row map[string]any
	_ = json.Unmarshal(data, &row)
	if _, ok := row["customer"].(map[string]any); !ok {
		t.Errorf("customer not inlined: %s", data)
	}

	health, err := f.service.GetChannelHealth(f.ctx, f.org.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(health) != 2 || health[0].ID != a.ID || health[1].DeletedAt == nil || health[0].Customer.Name != "Client" {
		t.Errorf("health: %+v", health)
	}

	if err := f.service.DisableChannel(f.ctx, f.org.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	if err := f.service.EnableChannel(f.ctx, f.org.ID, 1, a.ID); err != nil {
		t.Errorf("enable under the limit: %v", err)
	}
	if err := f.service.EnableChannel(f.ctx, f.org.ID, 1, a.ID); err == nil || err.Error() != "You have reached the maximum number of channels" {
		t.Errorf("enable over the limit: %v", err)
	}

	if _, err := f.service.SetTimes(f.ctx, f.org.ID, a.ID, integrationsdto.IntegrationTimeDto{Time: []integrationsdto.IntegrationValidateTimeDto{{Time: ptr(30.0)}, {Time: ptr(90.0)}}}); err != nil {
		t.Fatal(err)
	}
	times, err := f.service.FindFreeDateTime(f.ctx, f.org.ID, "")
	if err != nil || len(times) != 2 || times[0] != 30 || times[1] != 90 {
		t.Errorf("times: %v %v", times, err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestPlugs(t *testing.T) {
	f := setup(t, "x")
	i := f.connect(t, CreateOrUpdateIntegrationParams{Name: "A", InternalID: "a", Provider: "x", Token: "t"})
	body := plugsdto.PlugDto{Func: "autoRepost", Fields: []plugsdto.FieldsDto{{Name: "likes", Value: "1"}}}
	got, err := f.service.CreateOrUpdatePlug(f.ctx, f.org.ID, i.ID, body)
	if err != nil || !got.Activated {
		t.Fatalf("create plug: %v %v", got, err)
	}
	body.Fields[0].Value = "fire"
	if _, err := f.service.CreateOrUpdatePlug(f.ctx, f.org.ID, i.ID, body); err != nil {
		t.Fatal(err)
	}
	all, _ := f.service.GetPlugsByIntegrationID(f.ctx, f.org.ID, i.ID)
	if len(all) != 1 || all[0].Data != `[{"name":"likes","value":"fire"}]` {
		t.Fatalf("plugs: %+v", all)
	}

	done, err := f.service.ProcessPlugs(f.ctx, PlugsData{PlugID: all[0].ID, PostID: "p", TotalRuns: 3, CurrentRun: 1})
	if err != nil || !done || f.providers["x"].plugRuns != 1 {
		t.Errorf("process plug: %v %v", done, err)
	}

	if _, err := f.service.ChangePlugActivation(f.ctx, f.org.ID, all[0].ID, false); err != nil {
		t.Fatal(err)
	}
	active, _ := f.service.GetPlugs(f.ctx, f.org.ID, i.ID)
	if len(active) != 0 {
		t.Errorf("deactivated plug listed: %+v", active)
	}
	if got, _ := f.service.CreateOrUpdatePlug(f.ctx, f.org.ID, i.ID, body); got.Activated {
		t.Errorf("update re-activated the plug")
	}

	if err := f.service.repo.SaveExisingData(f.ctx, "autoRepost", i.ID, []string{"1", "2"}); err != nil {
		t.Fatal(err)
	}
	fresh, err := f.service.LoadExisingData(f.ctx, "autoRepost", i.ID, []string{"1", "3", "2", "4"})
	if err != nil || len(fresh) != 2 || fresh[0] != "3" || fresh[1] != "4" {
		t.Errorf("existing data: %v %v", fresh, err)
	}
}

func TestCheckAnalyticsCachesAndMentions(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	f := setup(t, "x")
	i := f.connect(t, CreateOrUpdateIntegrationParams{Name: "A", InternalID: "a", Provider: "x", Token: "t"})
	for range 2 {
		data, err := f.service.CheckAnalytics(f.ctx, f.org, i.ID, "30", false)
		if err != nil || len(data) != 1 || data[0].Label != "Followers" {
			t.Fatalf("analytics: %v %v", data, err)
		}
	}
	if hits := f.providers["x"].analyticsHits; hits != 1 {
		t.Errorf("analytics not cached: %d provider calls", hits)
	}

	// expired token whose refresh fails: flagged, notified, no data
	f.client.Integration.UpdateOneID(i.ID).SetTokenExpiration(time.Now().Add(-time.Hour)).ExecX(f.ctx)
	data, err := f.service.CheckAnalytics(f.ctx, f.org, i.ID, "7", false)
	if err != nil || len(data) != 0 {
		t.Fatalf("expired: %v %v", data, err)
	}
	if !f.client.Integration.GetX(f.ctx, i.ID).RefreshNeeded || len(f.notifications.sent) != 1 {
		t.Errorf("refresh failure not handled: %+v", f.notifications.sent)
	}

	mentions := []Mention{{Name: "Bob", Username: "bob", Image: "b"}, {Name: "alice", Username: "al", Image: "a"}}
	if err := f.service.InsertMentions(f.ctx, "x", mentions); err != nil {
		t.Fatal(err)
	}
	if err := f.service.InsertMentions(f.ctx, "x", mentions); err != nil {
		t.Fatalf("duplicates must be skipped: %v", err)
	}
	found, err := f.service.GetMentions(f.ctx, "x", "AL")
	if err != nil || len(found) != 1 || found[0].Username != "al" {
		t.Errorf("mentions: %v %v", found, err)
	}
}
