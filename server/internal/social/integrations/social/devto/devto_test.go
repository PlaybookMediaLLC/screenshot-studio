package devto

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func setup(t *testing.T, h http.HandlerFunc) {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
}

func TestPost(t *testing.T) {
	var got struct {
		Article map[string]any `json:"article"`
	}
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/articles" || r.Header.Get("api-key") != "key" {
			t.Errorf("request %s", r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"id":99,"url":"https://dev.to/x"}`)
	})
	settings := json.RawMessage(`{"title":"T","main_image":{"id":"1","path":"https://cdn/a.png"},"tags":[{"value":1,"label":"go"}],"canonical":"https://c.com/x"}`)
	res, err := New().Post(t.Context(), "", "key", []integrations.PostDetails{{ID: "p1", Message: "# hi", Settings: settings}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	a := got.Article
	if a["title"] != "T" || a["body_markdown"] != "# hi" || a["published"] != true || a["main_image"] != "https://cdn/a.png" ||
		a["canonical_url"] != "https://c.com/x" || a["tags"].([]any)[0] != "go" {
		t.Fatalf("article %v", a)
	}
	if _, ok := a["organization_id"]; ok {
		t.Fatal("organization_id should be omitted")
	}
	if res[0].PostID != "99" || res[0].ReleaseURL != "https://dev.to/x" {
		t.Fatalf("%+v", res)
	}
}

func TestPostCanonicalTaken(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		io.WriteString(w, `{"error":"Canonical url has already been taken"}`)
	})
	_, err := New().Post(t.Context(), "", "key", []integrations.PostDetails{{ID: "p1", Message: "x", Settings: json.RawMessage(`{"title":"T"}`)}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Canonical URL already exists" {
		t.Fatalf("err %v", err)
	}
}

func TestValidCanonical(t *testing.T) {
	for s, want := range map[string]bool{
		"": true, "https://example.com/a": true, "http://www.example.com": true, "www.example.com": true,
		"https://wwwexample.com": false, "https://www": false, "example.com": false, "https://a b.com": false,
	} {
		if validCanonical(s) != want {
			t.Errorf("%q: want %v", s, want)
		}
	}
}

func TestValidate(t *testing.T) {
	var d DevToSettingsDto
	json.Unmarshal([]byte(`{"title":"T","canonical":"nope","main_image":{"id":"1","path":"x.txt"},"tags":[{"label":"a"},{},{},{},{}]}`), &d)
	got := d.Validate()
	want := []string{
		"title must be longer than or equal to 2 characters",
		"main_image.File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4",
		"Invalid URL",
		"tags.0.value must be a number conforming to the specified constraints",
	}
	if len(got) < len(want) {
		t.Fatal(got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%d: %q", i, got[i])
		}
	}
	// (post:...) canonicals are internal references and skip the URL check.
	c, title := "(post:abc)", "Title"
	if got := (&DevToSettingsDto{Title: &title, Canonical: &c}).Validate(); len(got) != 0 {
		t.Fatal(got)
	}
}
