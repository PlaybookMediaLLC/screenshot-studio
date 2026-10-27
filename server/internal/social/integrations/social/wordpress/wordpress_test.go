package wordpress

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.CustomFielder = (*Provider)(nil)
	_ integrations.InlineImager  = (*Provider)(nil)
)

func setup(t *testing.T, handler http.HandlerFunc) (*Provider, string) {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	p := New()
	p.RetryDelay = 0
	return p, srv.URL
}

func token(domain string) string {
	return base64.StdEncoding.EncodeToString([]byte(`{"domain":"` + domain + `","username":"admin","password":"app pass"}`))
}

func TestAuthenticate(t *testing.T) {
	p, url := setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/wp-json/wp/v2/users/me" || r.Header.Get("User-Agent") != userAgent {
			t.Errorf("unexpected %s %v", r.URL.Path, r.Header)
		}
		if r.Header.Get("Authorization") == "Basic "+base64.StdEncoding.EncodeToString([]byte("admin:app pass")) {
			w.Write([]byte(`{"id":3,"name":"Admin","avatar_urls":{"24":"s","96":"big","48":"m"}}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"code":"rest_not_logged_in"}`))
	})
	code := token(url + "/ ")
	got, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: code}, nil)
	if err != nil || got.ID != url+"/ _3" || got.Picture != "big" || got.Name != "Admin" || got.AccessToken != code {
		t.Fatalf("got %+v %v", got, err)
	}
	bad := base64.StdEncoding.EncodeToString([]byte(`{"domain":"` + url + `","username":"x","password":"y"}`))
	_, err = p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: bad}, nil)
	if err == nil || !strings.HasPrefix(err.Error(), "WordPress rejected the login.") {
		t.Fatalf("got %v", err)
	}
}

func TestPostWithMainImage(t *testing.T) {
	var srvURL string
	var article map[string]any
	p, url := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cover.png":
			w.Header().Set("Content-Type", "image/png")
			w.Write([]byte("png"))
		case "/wp-json/wp/v2/media":
			data, _ := io.ReadAll(r.Body)
			if string(data) != "png" || r.Header.Get("Content-Disposition") != `attachment; filename="cover.png"` || r.Header.Get("Content-Type") != "image/png" {
				t.Errorf("bad media upload")
			}
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"id":55}`))
		case "/wp-json/wp/v2/posts":
			json.NewDecoder(r.Body).Decode(&article)
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"id":101,"link":"https://site/hello"}`))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	srvURL = url
	settings := `{"title":"Hello World!","type":"posts","categories":["4","x",5],"main_image":{"id":"m","path":"` + srvURL + `/cover.png"}}`
	out, err := p.Post(context.Background(), "id", token(srvURL), []integrations.PostDetails{{ID: "p1", Message: "<p>hi</p>", Settings: json.RawMessage(settings)}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].PostID != "101" || out[0].ReleaseURL != "https://site/hello" {
		t.Fatalf("got %+v", out[0])
	}
	if article["slug"] != "hello-world" || article["status"] != "publish" || article["featured_media"] != float64(55) ||
		len(article["categories"].([]any)) != 2 || article["tags"] != nil {
		t.Fatalf("article %v", article)
	}
}

func TestPostInsufficientPermissions(t *testing.T) {
	p, url := setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"code":"rest_cannot_create"}`))
	})
	_, err := p.Post(context.Background(), "id", token(url), []integrations.PostDetails{{Settings: json.RawMessage(`{"title":"ab","type":"posts"}`)}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "The connect user has insufficient permissions to create posts" {
		t.Fatalf("got %v", err)
	}
}

func TestPostTypesKeepsOrder(t *testing.T) {
	p, url := setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"post":{"rest_base":"posts","name":"Posts"},"attachment":{"rest_base":"media"},"wp_block":{},"page":{"rest_base":"pages","name":"Pages"}}`))
	})
	got, err := p.PostTypes(context.Background(), token(url))
	if err != nil || len(got) != 2 || got[0].ID != "posts" || got[1].Name != "Pages" {
		t.Fatalf("got %+v %v", got, err)
	}
}

func TestValidate(t *testing.T) {
	status := "nope"
	d := &SettingsDTO{Categories: "x", Status: &status, MainImage: &MediaDTO{}}
	got := strings.Join(d.Validate(), "|")
	want := strings.Join([]string{
		"title should not be null or undefined", "title must be longer than or equal to 2 characters", "title must be a string",
		"main_image.id should not be null or undefined", "main_image.id must be a string",
		"main_image.path should not be null or undefined",
		"main_image.File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4",
		"main_image.path must be a string",
		"type should not be null or undefined", "type must be a string",
		"each value in categories must be a number conforming to the specified constraints", "categories must be an array",
		"status must be one of the following values: publish, draft, pending, private",
	}, "|")
	if got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}
