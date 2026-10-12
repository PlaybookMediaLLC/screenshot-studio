package activities

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	enterrors "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

func TestMain(m *testing.M) {
	time.Local = time.UTC
	os.Exit(m.Run())
}

// fakeProvider records what the activities hand it.
type fakeProvider struct {
	integrations.Provider
	err       error
	posted    []integrations.PostDetails
	pending   bool
	token     string
	commented []string // postID, lastCommentID
	status    *integrations.PendingCheckResponse
}

func (p *fakeProvider) Info() integrations.Info {
	return integrations.Info{Identifier: "fake", Editor: "normal"}
}

func (p *fakeProvider) Post(_ context.Context, _, token string, list []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	p.token, p.posted = token, list
	if p.err != nil {
		return nil, p.err
	}
	return []integrations.PostResponse{{ID: list[0].ID, PostID: "platform-1", ReleaseURL: "https://fake/1", Status: "success"}}, nil
}

func (p *fakeProvider) PostPending(_ context.Context, _, token string, list []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	p.token, p.posted, p.pending = token, list, true
	if p.err != nil {
		return nil, p.err
	}
	return []integrations.PostResponse{{ID: list[0].ID, Status: "pending", PendingData: json.RawMessage(`{"job":1}`)}}, nil
}

func (p *fakeProvider) Comment(_ context.Context, _, postID, lastCommentID, token string, list []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	p.token, p.posted, p.commented = token, list, []string{postID, lastCommentID}
	return []integrations.PostResponse{{ID: list[0].ID, PostID: "comment-1", ReleaseURL: "https://fake/c1"}}, nil
}

func (p *fakeProvider) CheckPostStatus(_ context.Context, token string, pending json.RawMessage, _ *ent.Integration) (*integrations.PendingCheckResponse, error) {
	p.token = token
	if p.err != nil {
		return nil, p.err
	}
	return &integrations.PendingCheckResponse{Status: "completed", PostID: "platform-2", PendingData: pending}, nil
}

type fakeNotifications struct{ messages []string }

func (n *fakeNotifications) InAppNotification(_ context.Context, _, _, message string, _, _ bool, _ string) error {
	n.messages = append(n.messages, message)
	return nil
}

type fixture struct {
	ctx      context.Context
	client   *ent.Client
	a        *PostActivities
	provider *fakeProvider
	notified *fakeNotifications
	in       *Integration
	root     *ent.Post
	comment  *ent.Post
}

func setup(t *testing.T) *fixture {
	t.Helper()
	t.Setenv("STRIPE_SECRET_KEY", "")
	ctx := context.Background()
	c := dbtest.Open(t)
	org := c.Organization.Create().SetName("Org").SaveX(ctx)
	i := c.Integration.Create().SetInternalID("internal").SetOrganizationID(org.ID).SetName("Fake").
		SetProviderIdentifier("fake").SetType("social").SetToken("secret-token").SaveX(ctx)
	root := c.Post.Create().SetOrganizationID(org.ID).SetIntegrationID(i.ID).SetGroup("g").SetPublishDate(time.Now()).
		SetContent("<p>Hello world</p>").SetSettings(`{"title":"t"}`).SetImage("[]").SaveX(ctx)
	comment := c.Post.Create().SetOrganizationID(org.ID).SetIntegrationID(i.ID).SetGroup("g").SetPublishDate(time.Now()).
		SetContent("first comment").SetParentPostID(root.ID).SaveX(ctx)

	f := &fixture{ctx: ctx, client: c, provider: &fakeProvider{}, notified: &fakeNotifications{}, root: root, comment: comment}
	manager := integrations.NewManager([]integrations.Provider{f.provider})
	integrationService := integration.NewService(integration.NewRepository(c, nil), nil, manager, f.notified, nil, redis.NewMemory(), nil)
	f.a = NewPostActivities(
		posts.NewService(posts.NewRepository(c), manager, nil, nil, nil, nil, nil, nil, nil, redis.NewMemory()),
		notifications.NewService(notifications.NewRepository(c), nil, organizations.NewRepository(c), nil),
		manager, integrationService, integrationService.RefreshIntegrationService(),
		webhooks.NewService(webhooks.NewRepository(c)), nil, nil,
	)

	var err error
	if f.in, err = f.a.GetIntegrationByID(ctx, org.ID, i.ID); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) list(t *testing.T) []Post {
	t.Helper()
	list, err := f.a.GetPostsList(f.ctx, f.in.OrganizationID, f.root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != f.root.ID || list[1].ID != f.comment.ID {
		t.Fatalf("list = %+v", list)
	}
	return list
}

func TestIntegrationWireIncludesToken(t *testing.T) {
	f := setup(t)
	data, err := json.Marshal(f.in)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"token":"secret-token"`) || !strings.Contains(string(data), `"refreshToken":null`) {
		t.Fatalf("integration = %s", data)
	}

	list := f.list(t)
	if list[0].Integration == nil || list[0].Integration.Token != "secret-token" || list[1].Integration != nil {
		t.Fatalf("root integration %+v, comment integration %+v", list[0].Integration, list[1].Integration)
	}
	// slimPost drops error, timestamps, parentPostId...
	data, _ = json.Marshal(list[1])
	for _, key := range []string{`"parentPostId"`, `"createdAt"`, `"error"`} {
		if strings.Contains(string(data), key) {
			t.Fatalf("slim post has %s: %s", key, data)
		}
	}
}

func TestPostSocialAndPending(t *testing.T) {
	f := setup(t)
	list := f.list(t)[:1]

	res, err := f.a.PostSocial(f.ctx, f.in, list)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "platform-1" || f.provider.pending || f.provider.token != "secret-token" {
		t.Fatalf("res = %+v, provider = %+v", res, f.provider)
	}
	sent := f.provider.posted[0]
	if sent.ID != f.root.ID || sent.Message != "Hello world" || string(sent.Settings) != `{"title":"t"}` {
		t.Fatalf("sent = %+v", sent)
	}

	res, err = f.a.PostSocialPending(f.ctx, f.in, list)
	if err != nil {
		t.Fatal(err)
	}
	if !f.provider.pending || res[0].Status != "pending" || string(res[0].PendingData) != `{"job":1}` {
		t.Fatalf("res = %+v", res)
	}
}

func TestPostSocialDisconnectBecomesBadBody(t *testing.T) {
	f := setup(t)
	f.provider.err = temporalx.Disconnect("fake", "{}", "{}", "Daily cap reached")

	_, err := f.a.PostSocialPending(f.ctx, f.in, f.list(t)[:1])
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Daily cap reached" {
		t.Fatalf("err = %v", err)
	}
	if !f.client.Integration.GetX(f.ctx, f.in.ID).RefreshNeeded {
		t.Fatal("channel not flagged for reconnect")
	}
	if len(f.notified.messages) != 1 || !strings.Contains(f.notified.messages[0], "Daily cap reached") {
		t.Fatalf("notifications = %v", f.notified.messages)
	}

	// other provider failures surface unchanged
	f.provider.err = temporalx.RefreshToken("fake", "{}", "{}", "expired")
	if _, err := f.a.PostSocial(f.ctx, f.in, f.list(t)[:1]); temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("err = %v", err)
	}
}

func TestPostComment(t *testing.T) {
	f := setup(t)
	list := f.list(t)

	ok, err := f.a.IsCommentable(f.ctx, f.in)
	if err != nil || !ok {
		t.Fatalf("commentable = %v, %v", ok, err)
	}
	res, err := f.a.PostComment(f.ctx, "platform-1", nil, f.in, list[1:])
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "comment-1" || f.provider.commented[0] != "platform-1" || f.provider.commented[1] != "" {
		t.Fatalf("res = %+v, commented = %v", res, f.provider.commented)
	}
	if f.provider.posted[0].Message != "first comment" || string(f.provider.posted[0].Settings) != "{}" {
		t.Fatalf("sent = %+v", f.provider.posted[0])
	}

	last := "comment-1"
	if _, err := f.a.PostComment(f.ctx, "platform-1", &last, f.in, list[1:]); err != nil || f.provider.commented[1] != "comment-1" {
		t.Fatalf("commented = %v, err %v", f.provider.commented, err)
	}
}

func TestCheckPostStatus(t *testing.T) {
	f := setup(t)
	res, err := f.a.CheckPostStatus(f.ctx, f.in, json.RawMessage(`{"job":1}`))
	if err != nil || res.Status != "completed" || res.PostID != "platform-2" || f.provider.token != "secret-token" {
		t.Fatalf("res = %+v, err %v", res, err)
	}

	f.provider.err = temporalx.Disconnect("fake", "{}", "{}", "gone")
	if _, err := f.a.CheckPostStatus(f.ctx, f.in, nil); temporalx.FailureType(err) != temporalx.TypeBadBody {
		t.Fatalf("err = %v", err)
	}
}

func TestUpdatePostAndChangeState(t *testing.T) {
	f := setup(t)
	if err := f.a.UpdatePost(f.ctx, f.root.ID, "platform-1", "https://fake/1"); err != nil {
		t.Fatal(err)
	}
	p := f.client.Post.GetX(f.ctx, f.root.ID)
	if p.State != post.StatePUBLISHED || *p.ReleaseID != "platform-1" || *p.ReleaseURL != "https://fake/1" {
		t.Fatalf("post = %+v", p)
	}

	// a JSON string error is stored as is; no body means no Errors row
	if err := f.a.ChangeState(f.ctx, f.root.ID, StateError, json.RawMessage(`"plain <b>message</b>"`), nil); err != nil {
		t.Fatal(err)
	}
	p = f.client.Post.GetX(f.ctx, f.root.ID)
	if p.State != post.StateERROR || *p.Error != "plain <b>message</b>" {
		t.Fatalf("post = %+v", p)
	}
	if n := f.client.Errors.Query().CountX(f.ctx); n != 0 {
		t.Fatalf("errors = %d", n)
	}

	// a failure object is stored JSON.stringify'd, with the body in Errors
	failure := json.RawMessage(`{"cause":{"type":"bad_body"}}`)
	body := json.RawMessage(`[{"id":"x"}]`)
	if err := f.a.ChangeState(f.ctx, f.root.ID, StateError, failure, body); err != nil {
		t.Fatal(err)
	}
	row := f.client.Errors.Query().Where(enterrors.PostID(f.root.ID)).OnlyX(f.ctx)
	if row.Message != string(failure) || row.Body != string(body) || row.Platform != "fake" {
		t.Fatalf("errors row = %+v", row)
	}

	// missing / null arguments leave the error untouched
	if err := f.a.ChangeState(f.ctx, f.root.ID, StateQueue, json.RawMessage("null"), nil); err != nil {
		t.Fatal(err)
	}
	if p = f.client.Post.GetX(f.ctx, f.root.ID); p.State != post.StateQUEUE || *p.Error != string(failure) {
		t.Fatalf("post = %+v", p)
	}
}

func TestGetPost(t *testing.T) {
	f := setup(t)
	got, err := f.a.GetPost(f.ctx, f.in.OrganizationID, f.root.ID)
	if err != nil || got.V == nil || got.V.Integration.Token != "secret-token" {
		t.Fatalf("post = %+v, err %v", got, err)
	}
	data, _ := json.Marshal(got)
	if !strings.Contains(string(data), `"submittedForOrder":null`) {
		t.Fatalf("post = %s", data)
	}

	f.client.Post.UpdateOneID(f.root.ID).SetDeletedAt(time.Now()).ExecX(f.ctx)
	if got, err = f.a.GetPost(f.ctx, f.in.OrganizationID, f.root.ID); err != nil || got.V != nil {
		t.Fatalf("deleted post = %+v, err %v", got, err)
	}
}

func TestReanchorInterval(t *testing.T) {
	now := time.Date(2024, 1, 10, 12, 0, 0, 0, time.UTC)
	days := 7
	anchor := time.Date(2024, 1, 1, 9, 0, 0, 0, time.UTC)
	p := Post{State: StateQueue, PublishDate: JSDate{anchor}, IntervalInDays: &days}

	if got := reanchorInterval(p, now).PublishDate.Time; !got.Equal(anchor.AddDate(0, 0, 14)) {
		t.Fatalf("next = %v", got)
	}
	// within the grace window it still catches up
	if got := reanchorInterval(p, anchor.Add(time.Hour)).PublishDate.Time; !got.Equal(anchor) {
		t.Fatalf("grace = %v", got)
	}
	// repeat chain children run against a published post
	p.State = StatePublished
	if got := reanchorInterval(p, now).PublishDate.Time; !got.Equal(anchor) {
		t.Fatalf("published = %v", got)
	}
}

func TestJSArg(t *testing.T) {
	for raw, want := range map[string]any{"": nil, "null": nil, "false": nil, "0": nil, `""`: "", `"x"`: "x", `{"a":1}`: `{"a":1}`, "true": "true"} {
		if got := jsArg(json.RawMessage(raw)); got != want {
			t.Fatalf("jsArg(%q) = %#v, want %#v", raw, got, want)
		}
	}
}
