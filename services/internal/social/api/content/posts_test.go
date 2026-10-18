package content

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/generator"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
)

type fakeSettings struct {
	Title string `json:"title"`
}

func (s *fakeSettings) Validate() []string {
	if s.Title == "" {
		return []string{"Title is required"}
	}
	return nil
}

type fakeProvider struct{ integrations.Provider }

func (fakeProvider) Info() integrations.Info { return integrations.Info{Identifier: "fake"} }
func (fakeProvider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int {
	return 20
}
func (fakeProvider) SettingsDTO() any { return &fakeSettings{} }
func (fakeProvider) CheckValidity(context.Context, [][]integrations.ValidityMedia, json.RawMessage, []integrations.AdditionalSetting) (string, error) {
	return "", nil
}

type fakeIntegrations struct{ client *ent.Client }

func (f fakeIntegrations) GetIntegrationByID(ctx context.Context, orgID, id string) (*ent.Integration, error) {
	i, err := f.client.Integration.Query().Where(integration.ID(id), integration.OrganizationID(orgID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return i, err
}
func (f fakeIntegrations) GetIntegrationsList(ctx context.Context, orgID string) ([]*ent.Integration, error) {
	return f.client.Integration.Query().Where(integration.OrganizationID(orgID)).All(ctx)
}
func (fakeIntegrations) DisconnectChannel(context.Context, string, *ent.Integration, string) error {
	return nil
}
func (fakeIntegrations) FindFreeDateTime(context.Context, string, string) ([]int, error) {
	return nil, nil
}
func (fakeIntegrations) GetPlugs(context.Context, string, string) ([]*ent.Plugs, error) {
	return nil, nil
}

type fakeAgentGraph struct {
	events []any
	err    error
}

func (f fakeAgentGraph) Start(context.Context, string, *generator.GeneratorDto) iter.Seq2[any, error] {
	return func(yield func(any, error) bool) {
		for _, e := range f.events {
			if !yield(e, nil) {
				return
			}
		}
		if f.err != nil {
			yield(nil, f.err)
		}
	}
}

type postsFixture struct {
	router      *httpx.Router
	client      *ent.Client
	org         *ent.Organization
	integration *ent.Integration
}

func setupPosts(t *testing.T, graph AgentGraphService) *postsFixture {
	t.Helper()
	ctx := context.Background()
	c := dbtest.Open(t)
	org := c.Organization.Create().SetName("Org").SaveX(ctx)
	i := c.Integration.Create().SetInternalID("internal").SetOrganizationID(org.ID).SetName("Fake channel").
		SetProviderIdentifier("fake").SetType("social").SetToken("token").SaveX(ctx)
	svc := posts.NewService(posts.NewRepository(c), integrations.NewManager([]integrations.Provider{fakeProvider{}}),
		fakeIntegrations{client: c}, nil, nil, nil, nil, nil, nil, redis.NewMemory())

	r := httpx.NewRouter()
	RegisterPostsController(r, as(&ent.User{ID: "user"}, org), newPerms(), svc, graph, nil)
	return &postsFixture{router: r, client: c, org: org, integration: i}
}

func (f *postsFixture) createBody(typ, content, settings string) string {
	date := time.Now().Add(48 * time.Hour).Format("2006-01-02T15:04:05")
	return fmt.Sprintf(`{"type":%q,"date":%q,"shortLink":false,"tags":[],"posts":[{"integration":{"id":%q},"settings":%s,"value":[{"content":%q,"image":[]}]}]}`,
		typ, date, f.integration.ID, settings, content)
}

func TestCreatePostValidationFailure(t *testing.T) {
	f := setupPosts(t, nil)

	res := do(t, f.router, jsonRequest(http.MethodPost, "/posts", f.createBody("schedule", "", `{"title":"x"}`)))
	if res.status != 400 || res.body != `{"statusCode":400,"provider":"fake","name":"Fake channel","message":"Your post should have at least one character or one image."}` {
		t.Fatalf("empty content: %d %s", res.status, res.body)
	}

	res = do(t, f.router, jsonRequest(http.MethodPost, "/posts", f.createBody("schedule", "<p>hello</p>", `{}`)))
	if res.status != 400 || res.json(t)["message"] != "Title is required" {
		t.Fatalf("settings: %d %s", res.status, res.body)
	}

	res = do(t, f.router, jsonRequest(http.MethodPost, "/posts", f.createBody("schedule", "<p>"+strings.Repeat("a", 30)+"</p>", `{"title":"x"}`)))
	if res.status != 400 || res.json(t)["message"] != "post is too long, please fix it" {
		t.Fatalf("too long: %d %s", res.status, res.body)
	}

	if n := f.client.Post.Query().CountX(context.Background()); n != 0 {
		t.Fatalf("posts created: %d", n)
	}
}

func TestCreatePostHappyPath(t *testing.T) {
	f := setupPosts(t, nil)
	res := do(t, f.router, jsonRequest(http.MethodPost, "/posts", f.createBody("schedule", "<p>hello</p>", `{"title":"x"}`)))
	if res.status != 201 {
		t.Fatalf("%d %s", res.status, res.body)
	}
	var created []map[string]any
	if err := json.Unmarshal([]byte(res.body), &created); err != nil || len(created) != 1 || created[0]["integration"] != f.integration.ID {
		t.Fatalf("body %s", res.body)
	}
	p := f.client.Post.Query().OnlyX(context.Background())
	if p.Content != "<p>hello</p>" || p.OrganizationID != f.org.ID {
		t.Fatalf("post %+v", p)
	}

	// drafts skip the settings checks but never the empty content one
	res = do(t, f.router, jsonRequest(http.MethodPost, "/posts", f.createBody("draft", "<p>draft</p>", `{}`)))
	if res.status == 400 && res.json(t)["provider"] == "fake" {
		t.Fatalf("draft rejected by the controller: %s", res.body)
	}
}

func TestCreatePostPolicyAndAuth(t *testing.T) {
	f := setupPosts(t, nil)
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk")
	t.Setenv("FRONTEND_URL", "https://app.example")
	res := do(t, f.router, jsonRequest(http.MethodPost, "/posts", f.createBody("schedule", "<p>hello</p>", `{"title":"x"}`)))
	want := `{"statusCode":402,"message":"You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts.","url":"https://app.example/billing"}`
	if res.status != 402 || res.body != want {
		t.Fatalf("%d %s", res.status, res.body)
	}

	r := httpx.NewRouter()
	RegisterPostsController(r, auth.AuthMiddleware(nil, nil), newPerms(), nil, nil, nil)
	if res := do(t, r, jsonRequest(http.MethodGet, "/posts/tags", "")); res.status != 401 || res.header.Get("logout") != "true" {
		t.Fatalf("auth: %d %v", res.status, res.header)
	}
}

func TestGeneratorStream(t *testing.T) {
	org := &ent.Organization{ID: "org"}
	body := `{"research":"research about things","isPicture":false,"format":"one_short","tone":"personal"}`
	cases := []struct {
		err  error
		want string
	}{
		{nil, `{"name":"a"}` + "\n" + `{"name":"b","data":1}` + "\n"},
		{httpx.HTTPException("Your request was rejected by the AI safety system.", 422),
			`{"name":"a"}` + "\n" + `{"name":"b","data":1}` + "\n" + `{"name":"error","error":true,"message":"Your request was rejected by the AI safety system."}` + "\n"},
		{errors.New("boom"),
			`{"name":"a"}` + "\n" + `{"name":"b","data":1}` + "\n" + `{"name":"error","error":true,"message":"Something went wrong while generating your posts, please try again."}` + "\n"},
	}
	for _, tc := range cases {
		r := httpx.NewRouter()
		graph := fakeAgentGraph{events: []any{map[string]string{"name": "a"}, json.RawMessage(`{"name":"b","data":1}`)}, err: tc.err}
		RegisterPostsController(r, as(&ent.User{ID: "u"}, org), newPerms(), nil, graph, nil)
		res := do(t, r, jsonRequest(http.MethodPost, "/posts/generator", body))
		if res.status != 200 || res.header.Get("Content-Type") != "application/json; charset=utf-8" || res.body != tc.want {
			t.Fatalf("%d %q %q", res.status, res.header.Get("Content-Type"), res.body)
		}
	}

	r := httpx.NewRouter()
	RegisterPostsController(r, as(&ent.User{ID: "u"}, org), newPerms(), nil, fakeAgentGraph{}, nil)
	if res := do(t, r, jsonRequest(http.MethodPost, "/posts/generator", `{"research":"short"}`)); res.status != 400 {
		t.Fatalf("validation: %d %s", res.status, res.body)
	}
}

func TestRewriteObjectKeepsOrder(t *testing.T) {
	got, err := rewriteObject([]byte(`{"id":"1","batchId":"b","integration":{"id":"i","token":"x"},"childrenPost":[],"z":null}`),
		[]string{"childrenPost", "batchId"}, map[string]any{"integration": map[string]string{"id": "i"}})
	if err != nil || string(got) != `{"id":"1","integration":{"id":"i"},"z":null}` {
		t.Fatalf("%s %v", got, err)
	}
}
