package publicapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/posts"
	postsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

type fakeOrgs struct{ byKey map[string]*ent.Organization }

func (f *fakeOrgs) GetCount(context.Context) (int, error) { return 0, nil }
func (f *fakeOrgs) CreateOrgAndUser(context.Context, auth.CreateOrgAndUserBody, string, string) (*ent.Organization, error) {
	return nil, nil
}
func (f *fakeOrgs) AddUserToOrg(context.Context, string, string, string, userorganization.Role) (*ent.UserOrganization, error) {
	return nil, nil
}
func (f *fakeOrgs) GetUserOrg(context.Context, string) (*ent.UserOrganization, error) {
	return nil, nil
}
func (f *fakeOrgs) GetOrgsByUserID(context.Context, string) ([]*ent.Organization, error) {
	return nil, nil
}
func (f *fakeOrgs) UpdateAPIKey(context.Context, string) (*ent.Organization, error) { return nil, nil }
func (f *fakeOrgs) GetOrgByAPIKey(_ context.Context, key string) (*ent.Organization, error) {
	return f.byKey[key], nil
}
func (f *fakeOrgs) CanUseSuperAdminAPI(context.Context, string) (bool, error) { return false, nil }
func (f *fakeOrgs) GetOrgByIDWithSubscription(context.Context, string) (*ent.Organization, error) {
	return nil, nil
}

type fakeOAuth struct{}

func (fakeOAuth) GetOrgByOAuthToken(context.Context, string) (*ent.OAuthAuthorization, error) {
	return nil, nil
}

// fakePosts implements the createPost path; the rest is unused here.
type fakePosts struct {
	PostsService
	validation []posts.PostValidation
	mapped     *postsdto.CreatePostDto
	created    *postsdto.CreatePostDto
	method     post.CreationMethod
}

func (f *fakePosts) MapTypeToPost(_ context.Context, body *postsdto.CreatePostDto, _ string, replaceDraft bool) (*postsdto.CreatePostDto, error) {
	if !replaceDraft {
		panic("replaceDraft must be true")
	}
	f.mapped = body
	mapped := *body
	mapped.Type = "schedule"
	return &mapped, nil
}
func (f *fakePosts) ValidatePosts(context.Context, string, []postsdto.Post) ([]posts.PostValidation, error) {
	return f.validation, nil
}
func (f *fakePosts) CreatePost(_ context.Context, orgID string, body *postsdto.CreatePostDto, method post.CreationMethod, keepGroup bool) ([]posts.CreatedPost, error) {
	f.created, f.method = body, method
	return []posts.CreatedPost{{PostID: "p1", Integration: body.Posts[0].Integration.ID}}, nil
}

func setup(t *testing.T) (*httpx.Router, *fakePosts) {
	t.Helper()
	fp := &fakePosts{validation: []posts.PostValidation{{Identifier: "x", Name: "X", Valid: true, Errors: true}}}
	r := httpx.NewRouter()
	RegisterPublicIntegrationsController(r, Deps{
		Orgs:  &fakeOrgs{byKey: map[string]*ent.Organization{"key": {ID: "org1", Name: "Acme"}}},
		OAuth: fakeOAuth{},
		Store: redis.NewMemory(),
		Perms: auth.NewPermissionsService(nil, nil, nil, nil),
		Posts: fp,
	})
	return r, fp
}

func do(t *testing.T, r http.Handler, method, path, key, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", key)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	data, _ := io.ReadAll(rec.Body)
	return rec.Code, string(data)
}

func TestPublicAuth(t *testing.T) {
	r, _ := setup(t)
	for _, tc := range []struct{ key, want string }{
		{"", `{"msg":"No API Key found"}`},
		{"bad", `{"msg":"Invalid API key"}`},
	} {
		if status, body := do(t, r, http.MethodGet, "/public/v1/is-connected", tc.key, ""); status != http.StatusUnauthorized || body != tc.want {
			t.Fatalf("key %q: %d %s", tc.key, status, body)
		}
	}
	if status, body := do(t, r, http.MethodGet, "/public/v1/is-connected", "key", ""); status != http.StatusOK || body != `{"connected":true}` {
		t.Fatalf("valid key: %d %s", status, body)
	}
	// SuperAdminGuard
	if status, body := do(t, r, http.MethodGet, "/public/v1/users?name=a", "key", ""); status != http.StatusForbidden || body != `{"msg":"Unauthorized"}` {
		t.Fatalf("super admin: %d %s", status, body)
	}
}

const createBody = `{"type":"draft","creationMethod":"CLI","date":"2026-01-01T10:00:00Z","shortLink":false,"tags":[],
"posts":[{"integration":{"id":"i1"},"date":"2026-02-01T10:00:00Z","value":[{"content":"hello","image":[]}],"settings":{"__type":"x"}}]}`

func TestCreatePost(t *testing.T) {
	r, fp := setup(t)
	status, body := do(t, r, http.MethodPost, "/public/v1/posts", "key", createBody)
	if status != http.StatusCreated || body != `[{"postId":"p1","integration":"i1"}]` {
		t.Fatalf("got %d %s", status, body)
	}
	if fp.mapped.Posts[0].Date != "" {
		t.Fatal("per-channel date must be dropped")
	}
	if fp.created.Type != "draft" || fp.method != post.CreationMethodCLI {
		t.Fatalf("type %q method %q", fp.created.Type, fp.method)
	}
}

func TestCreatePostValidation(t *testing.T) {
	r, fp := setup(t)
	fp.validation = []posts.PostValidation{{Identifier: "x", Name: "X", Valid: true, Errors: "Image too big"}}
	schedule := strings.Replace(createBody, `"type":"draft"`, `"type":"schedule"`, 1)
	status, body := do(t, r, http.MethodPost, "/public/v1/posts", "key", schedule)
	var got map[string]any
	_ = json.Unmarshal([]byte(body), &got)
	if status != http.StatusBadRequest || got["provider"] != "x" || got["message"] != "Image too big" {
		t.Fatalf("got %d %s", status, body)
	}

	t.Setenv("RESTRICT_UPLOAD_DOMAINS", "uploads.postiz.com")
	withImage := strings.Replace(createBody, `"image":[]`, `"image":[{"id":"m","path":"https://evil.com/a.png"}]`, 1)
	status, body = do(t, r, http.MethodPost, "/public/v1/posts", "key", withImage)
	if status != http.StatusBadRequest || !strings.Contains(body, `"msg":"All media must be uploaded`) {
		t.Fatalf("restrict: %d %s", status, body)
	}
}

// posts.Service is wired directly as PostsService.
var _ PostsService = (*posts.Service)(nil)
