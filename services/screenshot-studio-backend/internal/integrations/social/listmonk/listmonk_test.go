package listmonk

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.CustomFielder = (*Provider)(nil)
	_ integrations.InlineImager  = (*Provider)(nil)
)

func setup(t *testing.T, handler http.HandlerFunc) (*Provider, *ent.Integration, string) {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("JWT_SECRET", "secret")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	details, err := helpers.FixedEncryption(`{"url":"` + srv.URL + `","username":"u","password":"pw"}`)
	if err != nil {
		t.Fatal(err)
	}
	p := New()
	p.RetryDelay = 0
	return p, &ent.Integration{CustomInstanceDetails: &details}, srv.URL
}

func TestPost(t *testing.T) {
	var campaign map[string]any
	var statusCalled bool
	p, integration, url := setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Basic "+base64.StdEncoding.EncodeToString([]byte("u:pw")) {
			t.Error("bad auth")
		}
		switch r.URL.Path {
		case "/api/campaigns":
			json.NewDecoder(r.Body).Decode(&campaign)
			w.Write([]byte(`{"data":{"uuid":"uu-1","id":7}}`))
		case "/api/campaigns/7/status":
			statusCalled = r.Method == http.MethodPut
			w.Write([]byte(`{}`))
		}
	})
	out, err := p.Post(context.Background(), "id", "", []integrations.PostDetails{{
		ID: "p1", Message: "<p>Body</p>", Settings: json.RawMessage(`{"subject":"Big News!","preview":"Peek","list":"3","template":"0"}`),
	}}, integration)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].PostID != "uu-1" || out[0].ReleaseURL != url+"/api/campaigns/7/preview" || !statusCalled {
		t.Fatalf("got %+v", out[0])
	}
	body := campaign["body"].(string)
	if campaign["name"] != "big-news" || campaign["lists"].([]any)[0] != float64(3) || campaign["template_id"] != nil ||
		!strings.Contains(body, "    Peek\n") || !strings.Contains(body, "<div class=\"content\">\n    <p>Body</p>\n  </div>\n") {
		t.Fatalf("campaign %v", campaign)
	}
}

func TestPostErrorAndTemplates(t *testing.T) {
	p, integration, _ := setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/templates" {
			w.Write([]byte(`{"data":[{"id":2,"name":"Fancy"}]}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"message":"invalid list"}`))
	})
	_, err := p.Post(context.Background(), "id", "", []integrations.PostDetails{{Settings: json.RawMessage(`{"subject":"s","list":"x"}`)}}, integration)
	if temporalx.FailureType(err) != temporalx.TypeBadBody {
		t.Fatalf("got %v", err)
	}
	templates, err := p.Templates(context.Background(), integration)
	if err != nil || len(templates) != 2 || templates[0].Name != "Default" || templates[1].ID != float64(2) {
		t.Fatalf("got %+v %v", templates, err)
	}
}

func TestAuthenticate(t *testing.T) {
	p, _, url := setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"data":{"app.site_name":"News","app.logo_url":""}}`))
	})
	code := base64.StdEncoding.EncodeToString([]byte(`{"url":"` + url + `","username":"u","password":"pw"}`))
	got, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: code}, nil)
	if err != nil || got.Name != "News" || got.ID != base64.StdEncoding.EncodeToString([]byte(url)) || got.AccessToken != base64.StdEncoding.EncodeToString([]byte("u:pw")) {
		t.Fatalf("got %+v %v", got, err)
	}
}
