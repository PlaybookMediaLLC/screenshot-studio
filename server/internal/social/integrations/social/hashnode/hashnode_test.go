package hashnode

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func TestPublishPostMutation(t *testing.T) {
	t.Setenv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.com")
	t.Setenv("NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY", "uploads")
	var settings HashnodeSettingsDto
	json.Unmarshal([]byte(`{"title":"Hello \"world\"","publication":"pub1","canonical":"https://a.com/x",
		"tags":[{"value":"56744721958ef13879b94cad","label":"JavaScript"},{"value":"nope","label":"x"}],
		"subtitle":"Sub","main_image":{"id":"m","path":"/a.png"}}`), &settings)
	got, err := publishPostMutation(settings, "line1\nline2")
	if err != nil {
		t.Fatal(err)
	}
	want := "mutation {\n" +
		"    publishPost (input: {title: \"Hello \\\"world\\\"\", publicationId: \"pub1\", originalArticleURL: \"https://a.com/x\", contentMarkdown: \"line1\\nline2\", tags: [{slug: \"javascript\"}, {slug: undefined}], subtitle: \"Sub\", coverImage: \"https://api.example.com/uploads/a.png\"}) {\n" +
		"        post {\n" +
		"            id\n" +
		"            url\n" +
		"        }\n" +
		"    }\n" +
		"}"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func setup(t *testing.T, body string) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "key" {
			t.Errorf("auth %q", r.Header.Get("Authorization"))
		}
		io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old := gqlURL
	gqlURL = srv.URL
	t.Cleanup(func() { gqlURL = old })
}

var postSettings = json.RawMessage(`{"title":"Hello world","publication":"p","tags":[{"value":"56744721958ef13879b94cad","label":"JavaScript"}]}`)

func TestPost(t *testing.T) {
	setup(t, `{"data":{"publishPost":{"post":{"id":"h1","url":"https://blog/h1"}}}}`)
	res, err := New().Post(t.Context(), "", "key", []integrations.PostDetails{{ID: "p1", Message: "x", Settings: postSettings}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "h1" || res[0].ReleaseURL != "https://blog/h1" {
		t.Fatalf("%+v", res)
	}
}

func TestPostGraphQLError(t *testing.T) {
	setup(t, `{"errors":[{"message":"Invalid tag"}],"data":null}`)
	_, err := New().Post(t.Context(), "", "key", []integrations.PostDetails{{ID: "p1", Message: "x", Settings: postSettings}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Invalid tag" {
		t.Fatalf("err %v", err)
	}
}

func TestAuthenticate(t *testing.T) {
	setup(t, `{"data":{"me":{"name":"N","id":"i","profilePicture":"pic","username":"u"}}}`)
	// base64 of {"apiKey":"key"}
	details, err := New().Authenticate(t.Context(), integrations.AuthenticateParams{Code: "eyJhcGlLZXkiOiJrZXkifQ"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if details.ID != "i" || details.AccessToken != "key" || details.Picture != "pic" {
		t.Fatalf("%+v", details)
	}
}

func TestValidate(t *testing.T) {
	got := (&HashnodeSettingsDto{}).Validate()
	want := []string{
		"title should not be null or undefined", "title must be longer than or equal to 6 characters", "title must be a string",
		"publication should not be null or undefined", "publication must be a string",
		"tags must contain at least 1 elements", "tags must be an array",
	}
	if len(got) != len(want) {
		t.Fatal(got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatal(got)
		}
	}
	if len(tags) != 1000 || len(New().Tags()) != 1000 {
		t.Fatal("tags")
	}
}
