package linkedin

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestOrganizationLookupCurrentEndpointAndNativeIdentity(t *testing.T) {
	f, _ := newFake(t, map[string]http.HandlerFunc{"GET /rest/organizations": func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("q") != "vanityName" || r.URL.Query().Get("vanityName") != "acme&safe" || r.Header.Get("Linkedin-Version") == "" {
			t.Errorf("incorrect lookup: %s", r.URL.String())
		}
		_, _ = w.Write([]byte(`{"elements":[{"id":42,"localizedName":"Acme [Research]"},{"id":42,"localizedName":"Duplicate"},{"id":-1,"localizedName":"Invalid"},{"id":3,"localizedName":""}]}`))
	}})
	p := New()
	got, _, err := p.Mention(context.Background(), "tok", "acme&safe", "", nil)
	if err != nil || len(got) != 1 || got[0].ID != "42" {
		t.Fatalf("mentions=%+v %v", got, err)
	}
	if mention := p.MentionFormat(got[0].ID, got[0].Label); mention != `@[Acme \[Research\]](urn:li:organization:42)` {
		t.Fatalf("native mention=%s", mention)
	}
	input, _ := json.Marshal(map[string]string{"url": "https://www.linkedin.com/company/acme&safe"})
	if _, err := p.Company(context.Background(), "tok", input); err != nil {
		t.Fatal(err)
	}
	f.routes["GET /rest/organizations"] = func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"message":"ACCESS_DENIED"}`))
	}
	if _, _, err := p.Mention(context.Background(), "tok", "acme&safe", "", nil); err == nil {
		t.Fatal("refusal hidden")
	}
}
