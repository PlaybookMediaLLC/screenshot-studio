package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

type fakeUsers struct {
	byID       map[string]*ent.User
	byEmail    map[string]*ent.User
	byProvider map[string]*ent.User
	activated  []string
	passwords  map[string]string
}

func newFakeUsers() *fakeUsers {
	return &fakeUsers{byID: map[string]*ent.User{}, byEmail: map[string]*ent.User{}, byProvider: map[string]*ent.User{}, passwords: map[string]string{}}
}

func (f *fakeUsers) GetUserByID(_ context.Context, id string) (*ent.User, error) {
	if u := f.byID[id]; u != nil {
		cp := *u
		return &cp, nil
	}
	return nil, nil
}
func (f *fakeUsers) GetUserByEmail(_ context.Context, email string) (*ent.User, error) {
	return f.byEmail[strings.ToLower(email)], nil
}
func (f *fakeUsers) GetUserByProvider(_ context.Context, providerID string, provider user.ProviderName) (*ent.User, error) {
	return f.byProvider[string(provider)+":"+providerID], nil
}
func (f *fakeUsers) ActivateUser(_ context.Context, id string) (*ent.User, error) {
	f.activated = append(f.activated, id)
	return &ent.User{ID: id, Activated: true}, nil
}
func (f *fakeUsers) UpdatePassword(_ context.Context, id, password string) (*ent.User, error) {
	f.passwords[id] = password
	return &ent.User{ID: id}, nil
}

type fakeOrgs struct {
	count       int
	orgsByUser  map[string][]*ent.Organization
	userOrgs    map[string]*ent.UserOrganization
	byAPIKey    map[string]*ent.Organization
	byID        map[string]*ent.Organization
	superAdmin  map[string]bool
	updatedKeys []string
	created     []CreateOrgAndUserBody
	added       []string
}

func newFakeOrgs() *fakeOrgs {
	return &fakeOrgs{orgsByUser: map[string][]*ent.Organization{}, userOrgs: map[string]*ent.UserOrganization{},
		byAPIKey: map[string]*ent.Organization{}, byID: map[string]*ent.Organization{}, superAdmin: map[string]bool{}}
}

func (f *fakeOrgs) GetCount(context.Context) (int, error) { return f.count, nil }
func (f *fakeOrgs) CreateOrgAndUser(_ context.Context, body CreateOrgAndUserBody, ip, ua string) (*ent.Organization, error) {
	f.created = append(f.created, body)
	pw := body.Password
	u := &ent.User{ID: "new-user", Email: body.Email, Password: &pw, ProviderName: body.Provider, Activated: body.Provider != user.ProviderNameLOCAL}
	return &ent.Organization{ID: "new-org", Edges: ent.OrganizationEdges{Users: []*ent.UserOrganization{{Edges: ent.UserOrganizationEdges{User: u}}}}}, nil
}
func (f *fakeOrgs) AddUserToOrg(_ context.Context, userID, id, orgID string, role userorganization.Role) (*ent.UserOrganization, error) {
	f.added = append(f.added, userID+"|"+id+"|"+orgID+"|"+string(role))
	return &ent.UserOrganization{ID: id, UserID: userID, OrganizationID: orgID, Role: role}, nil
}
func (f *fakeOrgs) GetUserOrg(_ context.Context, id string) (*ent.UserOrganization, error) {
	return f.userOrgs[id], nil
}
func (f *fakeOrgs) GetOrgsByUserID(_ context.Context, userID string) ([]*ent.Organization, error) {
	return f.orgsByUser[userID], nil
}
func (f *fakeOrgs) UpdateAPIKey(_ context.Context, orgID string) (*ent.Organization, error) {
	f.updatedKeys = append(f.updatedKeys, orgID)
	return &ent.Organization{ID: orgID}, nil
}
func (f *fakeOrgs) GetOrgByAPIKey(_ context.Context, key string) (*ent.Organization, error) {
	return f.byAPIKey[key], nil
}
func (f *fakeOrgs) CanUseSuperAdminAPI(_ context.Context, orgID string) (bool, error) {
	return f.superAdmin[orgID], nil
}
func (f *fakeOrgs) GetOrgByIDWithSubscription(_ context.Context, id string) (*ent.Organization, error) {
	return f.byID[id], nil
}

type fakeOAuth map[string]*ent.OAuthAuthorization

func (f fakeOAuth) GetOrgByOAuthToken(_ context.Context, token string) (*ent.OAuthAuthorization, error) {
	return f[token], nil
}

type fakeEmail struct{ sent []string }

func (f *fakeEmail) SendEmailSync(_ context.Context, to, subject, html string) error {
	f.sent = append(f.sent, to+"|"+subject+"|"+html)
	return nil
}

type fakeNewsletter struct{ registered []string }

func (f *fakeNewsletter) Register(_ context.Context, email string) error {
	f.registered = append(f.registered, email)
	return nil
}

func strPtr(s string) *string { return &s }

func member(userID string, role userorganization.Role, disabled bool) *ent.UserOrganization {
	return &ent.UserOrganization{UserID: userID, Role: role, Disabled: disabled}
}

func org(id string, users ...*ent.UserOrganization) *ent.Organization {
	return &ent.Organization{ID: id, APIKey: strPtr("key-" + id), CreatedAt: time.Now(), Edges: ent.OrganizationEdges{Users: users}}
}

// serve runs one request through a router with the given middleware and
// returns the recorder and the ctx the handler saw.
func serve(t *testing.T, method, target string, mutate func(*http.Request), m ...httpx.Middleware) (*httptest.ResponseRecorder, *httpx.Ctx) {
	t.Helper()
	var seen *httpx.Ctx
	r := httpx.NewRouter()
	path := strings.Split(target, "?")[0]
	r.Group("", m...).Handle(method, path, func(c *httpx.Ctx) (any, error) {
		seen = c
		return map[string]bool{"ok": true}, nil
	})
	req := httptest.NewRequest(method, target, nil)
	if mutate != nil {
		mutate(req)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec, seen
}
