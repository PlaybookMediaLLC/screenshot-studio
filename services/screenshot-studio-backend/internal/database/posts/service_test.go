package posts

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	commentdtos "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/comments"
	dtos "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	commonpb "go.temporal.io/api/common/v1"
	enumspb "go.temporal.io/api/enums/v1"
	workflowpb "go.temporal.io/api/workflow/v1"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
)

// fakeSettings is a provider settings DTO with a custom message.
type fakeSettings struct {
	Title string `json:"title"`
}

func (s *fakeSettings) Validate() []string {
	if s.Title == "" {
		return []string{"Title is required"}
	}
	return nil
}

// fakeProvider implements only what posts calls.
type fakeProvider struct {
	integrations.Provider
	identifier string
	maxLength  int
	media      string
}

func (p *fakeProvider) Info() integrations.Info { return integrations.Info{Identifier: p.identifier} }
func (p *fakeProvider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int {
	return p.maxLength
}
func (p *fakeProvider) SettingsDTO() any { return &fakeSettings{} }
func (p *fakeProvider) CheckValidity(context.Context, [][]integrations.ValidityMedia, json.RawMessage, []integrations.AdditionalSetting) (string, error) {
	return p.media, nil
}

type fakeTemporal struct {
	client.Client
	running    []string
	started    []client.StartWorkflowOptions
	args       []any
	terminated []string
}

func (f *fakeTemporal) ListWorkflow(_ context.Context, req *workflowservice.ListWorkflowExecutionsRequest) (*workflowservice.ListWorkflowExecutionsResponse, error) {
	res := &workflowservice.ListWorkflowExecutionsResponse{}
	for _, id := range f.running {
		if strings.Contains(req.Query, strings.TrimPrefix(id, "post_")) {
			res.Executions = append(res.Executions, &workflowpb.WorkflowExecutionInfo{Execution: &commonpb.WorkflowExecution{WorkflowId: id}})
		}
	}
	return res, nil
}

func (f *fakeTemporal) DescribeWorkflowExecution(context.Context, string, string) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
	return &workflowservice.DescribeWorkflowExecutionResponse{
		WorkflowExecutionInfo: &workflowpb.WorkflowExecutionInfo{Status: enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING},
	}, nil
}

func (f *fakeTemporal) TerminateWorkflow(_ context.Context, id, _, _ string, _ ...any) error {
	f.terminated = append(f.terminated, id)
	return nil
}

func (f *fakeTemporal) ExecuteWorkflow(_ context.Context, options client.StartWorkflowOptions, workflow any, args ...any) (client.WorkflowRun, error) {
	if workflow != "postWorkflowV112" {
		return nil, errors.New("unexpected workflow")
	}
	f.started = append(f.started, options)
	f.args = append(f.args, args...)
	return nil, nil
}

type fakeIntegrations struct {
	client *ent.Client
	times  []int
}

func (f *fakeIntegrations) GetIntegrationByID(ctx context.Context, orgID, id string) (*ent.Integration, error) {
	i, err := f.client.Integration.Query().Where(integration.ID(id), integration.OrganizationID(orgID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return i, err
}

func (f *fakeIntegrations) GetIntegrationsList(ctx context.Context, orgID string) ([]*ent.Integration, error) {
	return f.client.Integration.Query().Where(integration.OrganizationID(orgID)).All(ctx)
}

func (f *fakeIntegrations) DisconnectChannel(context.Context, string, *ent.Integration, string) error {
	return nil
}

func (f *fakeIntegrations) FindFreeDateTime(context.Context, string, string) ([]int, error) {
	return f.times, nil
}

func (f *fakeIntegrations) GetPlugs(context.Context, string, string) ([]*ent.Plugs, error) {
	return nil, nil
}

type fixture struct {
	ctx         context.Context
	client      *ent.Client
	svc         *Service
	org         *ent.Organization
	integration *ent.Integration
	temporal    *fakeTemporal
	provider    *fakeProvider
	integ       *fakeIntegrations
}

func setup(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	c := dbtest.Open(t)
	org := c.Organization.Create().SetName("Org").SaveX(ctx)
	i := c.Integration.Create().SetInternalID("internal").SetOrganizationID(org.ID).SetName("Fake channel").
		SetProviderIdentifier("fake").SetType("social").SetToken("token").SaveX(ctx)
	f := &fixture{
		ctx: ctx, client: c, org: org, integration: i, temporal: &fakeTemporal{},
		provider: &fakeProvider{identifier: "fake", maxLength: 20},
		integ:    &fakeIntegrations{client: c},
	}
	f.svc = NewService(NewRepository(c), integrations.NewManager([]integrations.Provider{f.provider}),
		f.integ, nil, nil, nil, f.temporal, nil, nil, redis.NewMemory())
	return f
}

func (f *fixture) body(typ, date string, values ...dtos.PostContent) *dtos.CreatePostDto {
	return &dtos.CreatePostDto{
		Type: typ, Date: date, Tags: []dtos.Tags{{Value: "News", Label: "News"}},
		Posts: []dtos.Post{{
			Integration: dtos.Integration{ID: f.integration.ID},
			Settings:    json.RawMessage(`{"title":"hello"}`),
			Value:       values,
		}},
	}
}

func future(days int) string {
	return time.Now().Add(time.Duration(days) * 24 * time.Hour).Format("2006-01-02T15:04:05")
}

func badRequestMessage(t *testing.T, err error) any {
	t.Helper()
	var he *httpx.Error
	if !errors.As(err, &he) || he.Status != 400 {
		t.Fatalf("want 400, got %v", err)
	}
	if list := he.Messages(); len(list) > 1 || (len(list) == 1 && he.Message() == "") {
		return list
	}
	if m := he.Message(); m != "" {
		return m
	}
	return he.Body
}

func TestCreatePostThreadTagsAndGroup(t *testing.T) {
	f := setup(t)
	f.client.Tags.Create().SetOrgID(f.org.ID).SetName("News").SetColor("#fff").ExecX(f.ctx)

	body, err := f.svc.MapTypeToPost(f.ctx, f.body("schedule", future(2),
		dtos.PostContent{Content: "<p>hello</p>", Image: []dtos.MediaDto{}},
		dtos.PostContent{Content: "<p>first comment</p>", Image: []dtos.MediaDto{}},
	), f.org.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if body.Posts[0].SettingsType() != "fake" {
		t.Fatalf("settings.__type = %q", body.Posts[0].SettingsType())
	}

	created, err := f.svc.CreatePost(f.ctx, f.org.ID, body, post.CreationMethodWEB, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 1 || created[0].Integration != f.integration.ID {
		t.Fatalf("created = %+v", created)
	}

	thread, err := f.svc.GetPostsRecursively(f.ctx, created[0].PostID, true, f.org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(thread) != 2 || thread[0].Group != thread[1].Group || deref(thread[1].ParentPostID) != thread[0].ID {
		t.Fatalf("thread not linked: %+v", thread)
	}
	if thread[0].State != post.StateQUEUE || thread[0].BatchID == nil {
		t.Fatalf("root = %+v", thread[0])
	}
	if len(thread[0].Edges.Tags) != 1 || thread[0].Edges.Tags[0].Edges.Tag.Name != "News" {
		t.Fatalf("tags = %+v", thread[0].Edges.Tags)
	}
	if !strings.Contains(deref(thread[0].Settings), `"__type":"fake"`) {
		t.Fatalf("settings = %s", deref(thread[0].Settings))
	}

	if len(f.temporal.started) != 1 {
		t.Fatalf("started %d workflows", len(f.temporal.started))
	}
	opts := f.temporal.started[0]
	if opts.ID != "post_"+thread[0].ID || opts.TaskQueue != "main" ||
		opts.WorkflowIDConflictPolicy != enumspb.WORKFLOW_ID_CONFLICT_POLICY_TERMINATE_EXISTING {
		t.Fatalf("options = %+v", opts)
	}
	if v, _ := opts.TypedSearchAttributes.GetString(temporalx.PostID); v != thread[0].ID {
		t.Fatalf("postId attribute = %q", v)
	}
	if v, _ := opts.TypedSearchAttributes.GetString(temporalx.OrganizationID); v != f.org.ID {
		t.Fatalf("organizationId attribute = %q", v)
	}
	if in := f.temporal.args[0].(postWorkflowInput); in.TaskQueue != "fake" || in.PostID != thread[0].ID {
		t.Fatalf("args = %+v", in)
	}

	editor, err := f.svc.GetPostsByGroup(f.ctx, f.org.ID, thread[0].Group)
	if err != nil {
		t.Fatal(err)
	}
	if posts := editor["posts"].([]map[string]any); len(posts) != 2 || posts[1]["integration"] != nil {
		t.Fatalf("editor posts = %+v", posts)
	}
	if editor["integration"] != f.integration.ID {
		t.Fatalf("editor = %+v", editor)
	}

	// an invalid request reports every class-validator message
	if _, err := f.svc.MapTypeToPost(f.ctx, &dtos.CreatePostDto{
		Type: "schedule", Date: "nope", Tags: []dtos.Tags{},
		Posts: []dtos.Post{{Integration: dtos.Integration{ID: f.integration.ID}, Value: []dtos.PostContent{{Image: []dtos.MediaDto{}}}}},
	}, f.org.ID, false); err == nil {
		t.Fatal("want validation error")
	} else {
		msg := badRequestMessage(t, err).([]string)
		want := []string{
			"date must be a valid ISO 8601 date string",
			"posts.0.value.0." + " If images do not exist, content must be a non-empty string.",
			"posts.0.settings.Title is required",
		}
		if strings.Join(msg, "|") != strings.Join(want, "|") {
			t.Fatalf("messages = %q", msg)
		}
	}
}

func TestEditGroupRotatesAndSweeps(t *testing.T) {
	f := setup(t)
	created, err := f.svc.CreatePost(f.ctx, f.org.ID, f.body("schedule", future(2),
		dtos.PostContent{Content: "root", Image: []dtos.MediaDto{}},
		dtos.PostContent{Content: "comment", Image: []dtos.MediaDto{}},
	), post.CreationMethodWEB, false)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := f.svc.GetPostsRecursively(f.ctx, created[0].PostID, false, f.org.ID)
	oldGroup := before[0].Group

	// the dashboard edit: same root id, comment removed, group rotated
	edit := f.body("schedule", future(3), dtos.PostContent{ID: before[0].ID, Content: "root edited", Image: []dtos.MediaDto{}})
	edit.Posts[0].Group = oldGroup
	if _, err := f.svc.CreatePost(f.ctx, f.org.ID, edit, post.CreationMethodWEB, false); err != nil {
		t.Fatal(err)
	}

	root := f.client.Post.GetX(f.ctx, before[0].ID)
	if root.Content != "root edited" || root.Group == oldGroup || root.DeletedAt != nil || deref(root.BatchID) != deref(before[0].BatchID) {
		t.Fatalf("root = %+v", root)
	}
	if comment := f.client.Post.GetX(f.ctx, before[1].ID); comment.DeletedAt == nil || comment.ParentPostID != nil {
		t.Fatalf("dropped comment not swept: %+v", comment)
	}

	// settings-only update keeps the group and leaves the workflow alone
	started := len(f.temporal.started)
	res, err := f.svc.UpdatePostSettings(f.ctx, f.org.ID, root.ID, map[string]any{"title": "new"}, post.CreationMethodAPI)
	if err != nil {
		t.Fatal(err)
	}
	updated := f.client.Post.GetX(f.ctx, res.PostID)
	if updated.ID != root.ID || updated.Group != root.Group || !strings.Contains(deref(updated.Settings), `"title":"new"`) {
		t.Fatalf("updated = %+v", updated)
	}
	if len(f.temporal.started) != started {
		t.Fatal("settings update started a workflow")
	}
}

func TestDeletePostByGroup(t *testing.T) {
	f := setup(t)
	created, err := f.svc.CreatePost(f.ctx, f.org.ID, f.body("schedule", future(1),
		dtos.PostContent{Content: "a", Image: []dtos.MediaDto{}},
		dtos.PostContent{Content: "b", Image: []dtos.MediaDto{}},
	), post.CreationMethodWEB, false)
	if err != nil {
		t.Fatal(err)
	}
	root := f.client.Post.GetX(f.ctx, created[0].PostID)
	f.temporal.running = []string{"post_" + root.ID}

	res, err := f.svc.DeletePost(f.ctx, f.org.ID, root.Group)
	if err != nil || !res["error"] {
		t.Fatalf("res = %v, %v", res, err)
	}
	if n := f.client.Post.Query().Where(post.Group(root.Group), post.DeletedAtIsNil()).CountX(f.ctx); n != 0 {
		t.Fatalf("%d posts left", n)
	}
	if len(f.temporal.terminated) != 1 || f.temporal.terminated[0] != "post_"+root.ID {
		t.Fatalf("terminated = %v", f.temporal.terminated)
	}
	if _, err := f.svc.GetPostsByGroup(f.ctx, f.org.ID, root.Group); err == nil {
		t.Fatal("want not found")
	}
}

func TestChangeDateRepublishGuard(t *testing.T) {
	f := setup(t)
	published := f.client.Post.Create().SetOrganizationID(f.org.ID).SetIntegrationID(f.integration.ID).
		SetContent("x").SetGroup("g").SetPublishDate(time.Date(2024, 5, 1, 10, 30, 0, 0, time.UTC)).
		SetState(post.StatePUBLISHED).SetReleaseID("123").SetReleaseURL("https://x/123").SaveX(f.ctx)

	_, err := f.svc.ChangeDate(f.ctx, f.org.ID, published.ID, future(1), "schedule", false)
	want := "This post was already published on 2024-05-01 10:30 UTC. Saving it this way would publish it again to fake. To edit without republishing, use action 'update'. To intentionally publish again, pass republish: true."
	if msg := badRequestMessage(t, err); msg != want {
		t.Fatalf("message = %v", msg)
	}

	updated, err := f.svc.ChangeDate(f.ctx, f.org.ID, published.ID, future(1), "update", false)
	if err != nil || updated.State != post.StatePUBLISHED || deref(updated.ReleaseID) != "123" {
		t.Fatalf("update = %+v, %v", updated, err)
	}
	if len(f.temporal.started) != 0 {
		t.Fatal("update started a workflow")
	}

	rescheduled, err := f.svc.ChangeDate(f.ctx, f.org.ID, published.ID, future(1), "schedule", true)
	if err != nil || rescheduled.State != post.StateQUEUE || rescheduled.ReleaseID != nil || rescheduled.ReleaseURL != nil {
		t.Fatalf("republish = %+v, %v", rescheduled, err)
	}
	if len(f.temporal.started) != 1 {
		t.Fatal("republish did not start the workflow")
	}

	// createPost guards the same way
	body := f.body("schedule", future(1), dtos.PostContent{ID: published.ID, Content: "x", Image: []dtos.MediaDto{}})
	f.client.Post.UpdateOneID(published.ID).SetState(post.StatePUBLISHED).ExecX(f.ctx)
	if _, err := f.svc.CreatePost(f.ctx, f.org.ID, body, post.CreationMethodWEB, false); err == nil ||
		!strings.Contains(badRequestMessage(t, err).(string), "use type 'update'") {
		t.Fatalf("createPost guard: %v", err)
	}
}

func TestGetPostsRanges(t *testing.T) {
	f := setup(t)
	customer := f.client.Customer.Create().SetName("C").SetOrgID(f.org.ID).SaveX(f.ctx)
	other := f.client.Integration.Create().SetInternalID("other").SetOrganizationID(f.org.ID).SetName("Other").
		SetProviderIdentifier("fake").SetType("social").SetToken("t").SetCustomerID(customer.ID).SaveX(f.ctx)

	at := func(day int, integrationID string) *ent.Post {
		return f.client.Post.Create().SetOrganizationID(f.org.ID).SetIntegrationID(integrationID).SetContent("x").
			SetGroup("g").SetPublishDate(time.Date(2025, 3, day, 12, 0, 0, 0, time.UTC)).
			SetError(`{"cause":{"type":"bad_body","failure":{"message":"Too long"}}}`).SaveX(f.ctx)
	}
	week := at(4, f.integration.ID)   // Tue, ISO week 10
	month := at(20, f.integration.ID) // same month, other week
	at(20, other.ID)                  // customer channel
	repeat := f.client.Post.Create().SetOrganizationID(f.org.ID).SetIntegrationID(f.integration.ID).SetContent("r").
		SetGroup("r").SetPublishDate(time.Date(2025, 2, 25, 9, 0, 0, 0, time.UTC)).SetIntervalInDays(7).SaveX(f.ctx)

	count := func(start, end, customerID string) map[string]int {
		list, err := f.svc.GetPosts(f.ctx, f.org.ID, &dtos.GetPostsDto{StartDate: start, EndDate: end, Customer: customerID})
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]int{}
		for _, p := range list {
			out[p.ID]++
			if p.ID == week.ID && deref(p.Error) != "Too long" {
				t.Fatalf("curated error = %v", p.Error)
			}
		}
		return out
	}

	weekly := count("2025-03-03", "2025-03-09T23:59:59.999Z", "")
	if weekly[week.ID] != 1 || weekly[month.ID] != 0 {
		t.Fatalf("week = %v", weekly)
	}
	// the repeated post shows every 7 days from its first date up to the end
	if weekly[repeat.ID] != 2 { // Feb 25 and Mar 4
		t.Fatalf("repeated occurrences = %d", weekly[repeat.ID])
	}

	monthly := count("2025-03-01", "2025-03-31T23:59:59.999Z", "")
	if monthly[week.ID] != 1 || monthly[month.ID] != 1 || len(monthly) != 4 {
		t.Fatalf("month = %v", monthly)
	}
	if byCustomer := count("2025-03-01", "2025-03-31T23:59:59.999Z", customer.ID); len(byCustomer) != 1 {
		t.Fatalf("customer = %v", byCustomer)
	}

	minified, err := f.svc.GetPostsMinified(f.ctx, f.org.ID, &dtos.GetPostsDto{StartDate: "2025-03-03", EndDate: "2025-03-05"})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(minified)
	if !strings.Contains(string(data), `"d":"2025-03-04T12:00:00.000Z"`) || !strings.Contains(string(data), `"ad":"2025-02-25T09:00:00.000Z"`) {
		t.Fatalf("minified = %s", data)
	}
}

func TestFindFreeDateTime(t *testing.T) {
	f := setup(t)
	f.integ.times = []int{0} // midnight UTC, already past today
	now := time.Now().UTC()
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)

	got, err := f.svc.FindFreeDateTime(f.ctx, f.org.ID, "")
	if err != nil || got != tomorrow.Format("2006-01-02T15:04:00") {
		t.Fatalf("free = %q, %v", got, err)
	}

	f.client.Post.Create().SetOrganizationID(f.org.ID).SetIntegrationID(f.integration.ID).SetContent("x").
		SetGroup("g").SetPublishDate(tomorrow).ExecX(f.ctx)
	got, err = f.svc.FindFreeDateTime(f.ctx, f.org.ID, "")
	if err != nil || got != tomorrow.AddDate(0, 0, 1).Format("2006-01-02T15:04:00") {
		t.Fatalf("next free = %q, %v", got, err)
	}
}

func TestCommentsWithReplies(t *testing.T) {
	f := setup(t)
	root := f.client.Post.Create().SetOrganizationID(f.org.ID).SetIntegrationID(f.integration.ID).
		SetContent("<p>Hello world</p>").SetGroup("g").SetPublishDate(time.Now()).SaveX(f.ctx)
	child := f.client.Post.Create().SetOrganizationID(f.org.ID).SetIntegrationID(f.integration.ID).
		SetContent("<p>Second</p>").SetGroup("g").SetPublishDate(time.Now()).SetParentPostID(root.ID).SaveX(f.ctx)

	name := " Ann "
	if _, err := f.svc.CreatePublicComment(f.ctx, root.ID, &commentdtos.CreatePublicCommentDto{Content: "hi"}, "", "1.1.1.1"); err == nil {
		t.Fatal("anonymous comment without a name")
	}

	start, end, quote := 6, 11, "world"
	anchored, err := f.svc.CreatePublicComment(f.ctx, root.ID, &commentdtos.CreatePublicCommentDto{
		Content: "nice", DisplayName: &name, AnchorStart: &start, AnchorEnd: &end, AnchorQuote: &quote,
	}, "", "1.1.1.1")
	if err != nil {
		t.Fatal(err)
	}
	reply, err := f.svc.CreatePublicComment(f.ctx, root.ID, &commentdtos.CreatePublicCommentDto{
		Content: "agreed", DisplayName: &name, ParentID: anchored.ID,
	}, "", "1.1.1.1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CreatePublicComment(f.ctx, root.ID, &commentdtos.CreatePublicCommentDto{
		Content: "nested", DisplayName: &name, ParentID: reply.ID,
	}, "", "1.1.1.1"); badRequestMessage(t, err) != "Replies can only be added to a root comment" {
		t.Fatal(err)
	}
	if _, err := f.svc.CreatePublicComment(f.ctx, root.ID, &commentdtos.CreatePublicCommentDto{
		Content: "c", DisplayName: &name, PostID: child.ID,
	}, "", "1.1.1.1"); err != nil {
		t.Fatal(err)
	}
	bad := "wrong"
	if _, err := f.svc.CreatePublicComment(f.ctx, root.ID, &commentdtos.CreatePublicCommentDto{
		Content: "x", DisplayName: &name, AnchorStart: &start, AnchorEnd: &end, AnchorQuote: &bad,
	}, "", "1.1.1.1"); badRequestMessage(t, err) != "Anchor does not match the post text" {
		t.Fatal(err)
	}

	list, err := f.svc.GetComments(f.ctx, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 || deref(list[1].ParentID) != anchored.ID || deref(list[0].Name) != "Ann" || list[2].PostID != child.ID {
		t.Fatalf("comments = %+v", list)
	}

	if _, err := f.svc.ResolveComment(f.ctx, f.org.ID, reply.ID, true); badRequestMessage(t, err) != "Only root comments can be resolved" {
		t.Fatal(err)
	}
	resolved, err := f.svc.ResolveComment(f.ctx, f.org.ID, anchored.ID, true)
	if err != nil || resolved.ResolvedAt == nil {
		t.Fatalf("resolve = %+v, %v", resolved, err)
	}

	// the anchored span changes: the highlight is dropped, the quote kept
	root.Content = "<p>Hello there</p>"
	if err := f.svc.DetachStaleAnchors(f.ctx, []*ent.Post{root}); err != nil {
		t.Fatal(err)
	}
	if c := f.client.Comments.GetX(f.ctx, anchored.ID); c.AnchorStart != nil || deref(c.AnchorQuote) != "world" {
		t.Fatalf("anchor = %+v", c)
	}
}

func TestValidatePosts(t *testing.T) {
	f := setup(t)
	f.provider.media = "Video too long"
	valid := func(settings, content string) PostValidation {
		res, err := f.svc.ValidatePosts(f.ctx, f.org.ID, []dtos.Post{{
			Integration: dtos.Integration{ID: f.integration.ID},
			Settings:    json.RawMessage(settings),
			Value:       []dtos.PostContent{{Content: content}},
		}})
		if err != nil {
			t.Fatal(err)
		}
		return res[0]
	}

	got := valid(`{}`, "<p></p>")
	if got.Valid || got.SettingsError != "Title is required" || got.Errors != "Video too long" || !got.EmptyContent ||
		got.MaximumCharacters != 20 || got.Identifier != "fake" || got.Name != "Fake channel" {
		t.Fatalf("invalid = %+v", got)
	}

	f.provider.media = ""
	got = valid(`{"title":"ok"}`, "<p>this content is longer than twenty</p>")
	if !got.Valid || got.Errors != true || !got.TooLong || got.EmptyContent {
		t.Fatalf("too long = %+v", got)
	}

	if _, err := f.svc.ValidatePosts(f.ctx, f.org.ID, []dtos.Post{{Integration: dtos.Integration{ID: "missing"}}}); badRequestMessage(t, err) != "Integration with id missing not found" {
		t.Fatal(err)
	}
}
