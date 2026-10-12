package mastodoncustom

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"go.temporal.io/sdk/temporal"
)

func TestCustomInstance(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://app.example.com")
	t.Setenv("MASTODON_URL", "")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseMultipartForm(1 << 20)
		switch r.URL.Path {
		case "/api/v1/apps":
			if r.FormValue("client_name") != "Postiz" || r.FormValue("redirect_uris") != "https://app.example.com/integrations/social/mastodon" ||
				r.FormValue("scopes") != "write:statuses profile write:media" || r.FormValue("website") != "https://app.example.com" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"client_id":"cid","client_secret":"secret","name":"Postiz"}`))
		case "/oauth/token":
			_, _ = w.Write([]byte(`{"access_token":"tok"}`))
		case "/api/v1/accounts/verify_credentials":
			_, _ = w.Write([]byte(`{"id":"7","acct":"me","username":"me"}`))
		case "/api/v1/statuses":
			if r.FormValue("in_reply_to_id") != "parent" {
				w.WriteHeader(500)
				return
			}
			w.WriteHeader(401)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	p := New()
	if info := p.Info(); info.Identifier != "mastodon-custom" || info.Name != "M. Instance" || info.MaxConcurrentJob != 5 {
		t.Fatalf("info %+v", info)
	}
	var _ integrations.ExternalURLer = p

	client, err := p.ExternalURL(context.Background(), server.URL)
	if err != nil || client.ClientID != "cid" || client.ClientSecret != "secret" {
		t.Fatalf("external url: %v %+v", err, client)
	}

	auth, err := p.GenerateAuthURL(context.Background(), &integrations.ClientInformation{ClientID: "cid", InstanceURL: server.URL})
	if err != nil || auth.URL[:len(server.URL)+32] != server.URL+"/oauth/authorize?client_id=cid&r" {
		t.Fatalf("auth url %v %+v", err, auth)
	}

	// no refresh token: "" rather than upstream's stored string "null"
	token, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c"}, &integrations.ClientInformation{ClientID: "cid", ClientSecret: "secret", InstanceURL: server.URL})
	if err != nil || token.AccessToken != "tok" || token.RefreshToken != "" {
		t.Fatalf("authenticate %v %+v", err, token)
	}

	// the stored instance URL is used, and failures carry the subclass id
	details, _ := helpers.FixedEncryption(`{"instanceUrl":"` + server.URL + `"}`)
	_, err = p.Comment(context.Background(), "", "parent", "", "tok", []integrations.PostDetails{{ID: "c", Message: "hi"}}, &ent.Integration{CustomInstanceDetails: &details})
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("want refresh_token, got %v", err)
	}
	var app *temporal.ApplicationError
	var d temporalx.FailureDetails
	if !errors.As(err, &app) || app.Details(&d) != nil || d.Identifier != "mastodon-custom" {
		t.Fatalf("identifier %q", d.Identifier)
	}

	if got := instanceURL(nil); got != "https://mastodon.social" {
		t.Fatalf("fallback %s", got)
	}
}
