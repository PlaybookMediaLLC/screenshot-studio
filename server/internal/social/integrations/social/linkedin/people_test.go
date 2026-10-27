package linkedin

import (
	"context"
	"net/http"
	"slices"
	"testing"
)

func TestPeopleLookupRequiresApprovedPageAccess(t *testing.T) {
	f, _ := newFake(t, nil)
	t.Setenv("PLATFORM_LINKEDIN_PEOPLE_MENTIONS_ENABLED", "")
	if slices.Contains(PageOAuthScopes(), "r_organization_followers") {
		t.Fatal("restricted scope requested without activation")
	}
	p := WithIdentifier("linkedin-page")
	if _, err := p.People(context.Background(), "tok", "Ann", "42"); err == nil {
		t.Fatal("disabled lookup permitted")
	}
	t.Setenv("PLATFORM_LINKEDIN_PEOPLE_MENTIONS_ENABLED", "true")
	if !slices.Contains(PageOAuthScopes(), "r_organization_followers") {
		t.Fatal("missing approved scope")
	}
	if _, err := New().People(context.Background(), "tok", "Ann", "42"); err == nil {
		t.Fatal("personal account directory lookup permitted")
	}
	for _, q := range []string{"a", "  "} {
		if _, err := p.People(context.Background(), "tok", q, "42"); err == nil {
			t.Fatal("short query permitted")
		}
	}
	if len(f.calls) != 0 {
		t.Fatal("unsupported query reached provider")
	}
}

func TestPeopleLookupUsesNativeFollowerEndpointAndDoesNotHideRefusal(t *testing.T) {
	t.Setenv("PLATFORM_LINKEDIN_PEOPLE_MENTIONS_ENABLED", "true")
	f, _ := newFake(t, map[string]http.HandlerFunc{"GET /rest/peopleTypeahead": func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("q") != "organizationFollowers" || q.Get("organization") != "urn:li:organization:42" || q.Get("keywords") != "Ann" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("incorrect scope: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"elements":[{"member":"urn:li:person:Ab1","firstName":"Ann","lastName":"Doe"},{"personUrn":"urn:li:person:Ab1","firstName":"Duplicate"},{"member":"urn:li:organization:42","firstName":"Wrong kind"},{"member":"urn:li:person:invalid/path","firstName":"Invalid"}]}`))
	}})
	p := WithIdentifier("linkedin-page")
	got, err := p.People(context.Background(), "tok", "Ann", "42")
	if err != nil || len(got) != 1 || got[0].ID != "urn:li:person:Ab1" || got[0].Label != "Ann Doe" {
		t.Fatalf("people=%+v err=%v", got, err)
	}
	f.routes["GET /rest/peopleTypeahead"] = func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"message":"ACCESS_DENIED"}`))
	}
	if _, err = p.People(context.Background(), "tok", "Ann", "42"); err == nil {
		t.Fatal("provider refusal hidden as empty success")
	}
}
