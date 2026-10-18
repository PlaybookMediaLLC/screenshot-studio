package auth

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
)

func authFixture(t *testing.T) (*fakeOrgs, *fakeUsers, string) {
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://app.postiz.com")
	users := newFakeUsers()
	users.byID["u1"] = &ent.User{ID: "u1", Email: "a@b.com", Activated: true, Password: strPtr("hash")}
	orgs := newFakeOrgs()
	o2 := org("o2", member("u1", userorganization.RoleUSER, false))
	o2.APIKey = nil
	orgs.orgsByUser["u1"] = []*ent.Organization{
		org("o0", member("u1", userorganization.RoleADMIN, true)), // disabled membership is skipped
		org("o1", member("u1", userorganization.RoleADMIN, false)),
		o2,
	}
	token, err := helpers.SignJWT(map[string]any{"id": "u1", "isSuperAdmin": true})
	if err != nil {
		t.Fatal(err)
	}
	return orgs, users, token
}

func TestAuthMiddlewareMissingAuthClearsCookie(t *testing.T) {
	orgs, users, _ := authFixture(t)
	rec, seen := serve(t, "GET", "/posts", nil, AuthMiddleware(orgs, users))
	if rec.Code != http.StatusUnauthorized || rec.Body.Len() != 0 || seen != nil {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("logout") != "true" {
		t.Fatal("missing logout header")
	}
	cookie := rec.Header().Get("Set-Cookie")
	for _, want := range []string{"auth=;", "Domain=postiz.com", "Max-Age=0", "HttpOnly", "Secure", "SameSite=None"} {
		if !strings.Contains(cookie, want) {
			t.Fatalf("cookie %q lacks %q", cookie, want)
		}
	}
}

func TestAuthMiddlewareNotSecuredCookie(t *testing.T) {
	orgs, users, _ := authFixture(t)
	t.Setenv("NOT_SECURED", "true")
	rec, _ := serve(t, "GET", "/posts", nil, AuthMiddleware(orgs, users))
	if cookie := rec.Header().Get("Set-Cookie"); strings.Contains(cookie, "Secure") || strings.Contains(cookie, "SameSite") {
		t.Fatalf("cookie %q should not be secured", cookie)
	}
}

func TestAuthMiddlewareSelectsOrg(t *testing.T) {
	orgs, users, token := authFixture(t)

	rec, seen := serve(t, "GET", "/posts", func(r *http.Request) { r.Header.Set("auth", token) }, AuthMiddleware(orgs, users))
	if rec.Code != 200 || seen.Org.ID != "o1" || seen.User.ID != "u1" || seen.User.Password != nil {
		t.Fatalf("default org: %d %+v", rec.Code, seen)
	}
	if seen.User.IsSuperAdmin {
		t.Fatal("isSuperAdmin must come from the database, not the token")
	}

	// showorg cookie selects the org and backfills its missing API key.
	rec, seen = serve(t, "GET", "/posts", func(r *http.Request) {
		r.AddCookie(&http.Cookie{Name: "auth", Value: token})
		r.AddCookie(&http.Cookie{Name: "showorg", Value: "o2"})
	}, AuthMiddleware(orgs, users))
	if rec.Code != 200 || seen.Org.ID != "o2" || seen.Role() != "USER" {
		t.Fatalf("showorg: %d %+v", rec.Code, seen)
	}
	if len(orgs.updatedKeys) != 1 || orgs.updatedKeys[0] != "o2" {
		t.Fatalf("api key backfill: %v", orgs.updatedKeys)
	}

	// unknown org header falls back to the first enabled org
	_, seen = serve(t, "GET", "/posts", func(r *http.Request) {
		r.Header.Set("auth", token)
		r.Header.Set("showorg", "nope")
	}, AuthMiddleware(orgs, users))
	if seen.Org.ID != "o1" {
		t.Fatalf("fallback org %s", seen.Org.ID)
	}
}

func TestAuthMiddlewareRejects(t *testing.T) {
	cases := map[string]func(*fakeOrgs, *fakeUsers){
		"bad signature": func(*fakeOrgs, *fakeUsers) { t.Setenv("JWT_SECRET", "other") },
		"unknown user":  func(_ *fakeOrgs, u *fakeUsers) { delete(u.byID, "u1") },
		"inactive":      func(_ *fakeOrgs, u *fakeUsers) { u.byID["u1"].Activated = false },
		"no orgs":       func(o *fakeOrgs, _ *fakeUsers) { o.orgsByUser["u1"] = nil },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			orgs, users, token := authFixture(t)
			mutate(orgs, users)
			rec, seen := serve(t, "GET", "/posts", func(r *http.Request) { r.Header.Set("auth", token) }, AuthMiddleware(orgs, users))
			if rec.Code != 401 || seen != nil || rec.Header().Get("logout") != "true" {
				t.Fatalf("got %d", rec.Code)
			}
		})
	}
}

func TestAuthMiddlewareImpersonation(t *testing.T) {
	orgs, users, token := authFixture(t)
	target := &ent.User{ID: "u9", Email: "x@y.com", Activated: true, Password: strPtr("h")}
	impOrg := org("o9", member("u9", userorganization.RoleADMIN, false), member("u8", userorganization.RoleUSER, false))
	orgs.userOrgs["uo9"] = &ent.UserOrganization{ID: "uo9", Edges: ent.UserOrganizationEdges{User: target, Organization: impOrg}}

	// not a super admin: impersonation is ignored
	_, seen := serve(t, "GET", "/posts", func(r *http.Request) {
		r.Header.Set("auth", token)
		r.Header.Set("impersonate", "uo9")
	}, AuthMiddleware(orgs, users))
	if seen.User.ID != "u1" {
		t.Fatal("impersonated without super admin")
	}

	users.byID["u1"].IsSuperAdmin = true
	_, seen = serve(t, "GET", "/posts", func(r *http.Request) {
		r.Header.Set("auth", token)
		r.AddCookie(&http.Cookie{Name: "impersonate", Value: "uo9"})
	}, AuthMiddleware(orgs, users))
	if seen.User.ID != "u9" || !seen.User.IsSuperAdmin || seen.User.Password != nil {
		t.Fatalf("user %+v", seen.User)
	}
	if seen.Org.ID != "o9" || len(seen.Org.Edges.Users) != 1 || seen.Org.Edges.Users[0].UserID != "u9" {
		t.Fatalf("org %+v", seen.Org.Edges.Users)
	}
}

func TestPublicAuthMiddleware(t *testing.T) {
	t.Setenv("JWT_SECRET", "secret")
	orgs := newFakeOrgs()
	orgs.byAPIKey["k1"] = &ent.Organization{ID: "o1", Edges: ent.OrganizationEdges{Subscription: &ent.Subscription{}}}
	orgs.byAPIKey["k2"] = &ent.Organization{ID: "o2"}
	orgs.superAdmin["o1"] = true
	deleted := org("o3")
	deleted.DeletedAt = &deleted.CreatedAt
	orgs.byID["o3"] = deleted
	oauth := fakeOAuth{"pos_ok": {UserID: "u5", Edges: ent.OAuthAuthorizationEdges{Organization: &ent.Organization{ID: "o5"}}}}
	mw := PublicAuthMiddleware(orgs, oauth)

	cases := []struct {
		name    string
		headers map[string]string
		stripe  bool
		code    int
		body    string
	}{
		{"missing", nil, false, 401, `{"msg":"No API Key found"}`},
		{"bad key", map[string]string{"Authorization": "nope"}, false, 401, `{"msg":"Invalid API key"}`},
		{"bad oauth", map[string]string{"Authorization": "pos_bad"}, false, 401, `{"msg":"Invalid OAuth token"}`},
		{"no subscription", map[string]string{"Authorization": "k2"}, true, 401, `{"msg":"No subscription found"}`},
		{"override forbidden", map[string]string{"Authorization": "k2", "x-postiz-org": "o3"}, false, 403, `{"msg":"Unauthorized"}`},
		{"override oauth", map[string]string{"Authorization": "pos_ok", "x-postiz-org": "o3"}, false, 403, `{"msg":"Unauthorized"}`},
		{"override deleted", map[string]string{"Authorization": "k1", "x-postiz-org": "o3"}, true, 404, `{"msg":"Organization not found"}`},
		{"override missing", map[string]string{"Authorization": "k1", "x-postiz-org": "zz"}, true, 404, `{"msg":"Organization not found"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.stripe {
				t.Setenv("STRIPE_SECRET_KEY", "sk")
			}
			rec, seen := serve(t, "GET", "/public/v1/posts", func(r *http.Request) {
				for k, v := range tc.headers {
					r.Header.Set(k, v)
				}
			}, mw)
			if rec.Code != tc.code || strings.TrimSpace(rec.Body.String()) != tc.body || seen != nil {
				t.Fatalf("got %d %s", rec.Code, rec.Body.String())
			}
		})
	}

	_, seen := serve(t, "GET", "/public/v1/posts", func(r *http.Request) {
		r.Header.Set("Authorization", "k1")
		r.Header.Set("x-postiz-org", " o3 ")
		r.Header.Set("x-postiz-include-deleted", "true")
	}, mw)
	if seen.Org.ID != "o3" || seen.AuthOrgID != "o1" || !seen.IncludeDeleted || seen.IsOAuthApp || seen.Role() != "" || len(seen.Org.Edges.Users) != 1 {
		t.Fatalf("override: %+v", seen)
	}

	_, seen = serve(t, "GET", "/public/v1/posts", func(r *http.Request) { r.Header.Set("Authorization", "pos_ok") }, mw)
	if seen.Org.ID != "o5" || !seen.IsOAuthApp || seen.OAuthUserID != "u5" {
		t.Fatalf("oauth: %+v", seen)
	}
}

type fakeMedia map[string]*UploadTicket

func (f fakeMedia) GetUploadTicket(_ context.Context, t string) (*UploadTicket, error) {
	return f[t], nil
}

type fakeClipping map[string]*ClippingTicket

func (f fakeClipping) GetWidgetTicket(_ context.Context, t string) (*ClippingTicket, error) {
	return f[t], nil
}

func TestWidgetMiddlewares(t *testing.T) {
	upload := UploadWidgetAuthMiddleware(fakeMedia{"t1": {Org: "o1", SessionID: "s1"}})
	rec, _ := serve(t, "POST", "/media/widget?ticket=nope", nil, upload)
	if rec.Code != 401 || strings.TrimSpace(rec.Body.String()) != `{"msg":"Upload ticket not found or expired"}` || rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	rec, _ = serve(t, "POST", "/media/widget?ticket=t1&ticket=t1", nil, upload)
	if rec.Code != 401 {
		t.Fatal("array ticket accepted")
	}
	_, seen := serve(t, "POST", "/media/widget?ticket=t1", nil, upload)
	if seen.Org.ID != "o1" || UploadSession(seen) != "s1" {
		t.Fatalf("upload: %+v", seen)
	}

	clip := ClippingWidgetAuthMiddleware(fakeClipping{"c1": {Org: "o2", ID: "clip"}})
	rec, _ = serve(t, "GET", "/clipping/widget", nil, clip)
	if rec.Code != 401 || strings.TrimSpace(rec.Body.String()) != `{"msg":"Clipping ticket not found or expired"}` {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	_, seen = serve(t, "GET", "/clipping/widget?ticket=c1", nil, clip)
	if seen.Org.ID != "o2" || ClippingID(seen) != "clip" {
		t.Fatalf("clipping: %+v", seen)
	}
}

func TestSuperAdminGuard(t *testing.T) {
	orgs := newFakeOrgs()
	orgs.byAPIKey["k1"] = &ent.Organization{ID: "o1"}
	orgs.byAPIKey["k2"] = &ent.Organization{ID: "o2"}
	orgs.superAdmin["o1"] = true
	oauth := fakeOAuth{"pos_ok": {Edges: ent.OAuthAuthorizationEdges{Organization: &ent.Organization{ID: "o1"}}}}
	for key, code := range map[string]int{"k1": 200, "k2": 403, "pos_ok": 403} {
		rec, _ := serve(t, "GET", "/public/v1/admin", func(r *http.Request) { r.Header.Set("Authorization", key) },
			PublicAuthMiddleware(orgs, oauth), SuperAdminGuard(orgs))
		if rec.Code != code {
			t.Fatalf("%s: got %d", key, rec.Code)
		}
		if code == 403 && strings.TrimSpace(rec.Body.String()) != `{"msg":"Unauthorized"}` {
			t.Fatalf("body %s", rec.Body.String())
		}
	}
}
