package mastodon

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQuotesRequireAPIVersionAndPermissionAndPreserveNativeID(t *testing.T) {
	for _, scenario := range []string{"accepted", "old server", "denied", "pending"} {
		t.Run(scenario, func(t *testing.T) {
			t.Setenv("DISABLE_SSRF_PROTECTION", "true")
			mutations := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v2/instance" {
					version := 7
					if scenario == "old server" {
						version = 6
					}
					fmt.Fprintf(w, `{"api_versions":{"mastodon":%d}}`, version)
					return
				}
				if r.Header.Get("Authorization") != "Bearer token" {
					t.Error("missing account authorization")
				}
				approval := "automatic"
				if scenario == "denied" {
					approval = "denied"
				}
				source := fmt.Sprintf(`{"id":"123","url":"https://source.social/@author/42","visibility":"public","quote_approval":{"current_user":%q}}`, approval)
				switch r.URL.Path {
				case "/api/v2/search":
					if r.URL.Query().Get("q") != "https://source.social/@author/42" {
						t.Error("wrong URL")
					}
					fmt.Fprintf(w, `{"statuses":[%s]}`, source)
				case "/api/v1/statuses/123":
					fmt.Fprint(w, source)
				case "/api/v1/statuses":
					mutations++
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Fatal(err)
					}
					if r.FormValue("quoted_status_id") != "123" {
						t.Error("native reference missing")
					}
					state := "accepted"
					if scenario == "pending" {
						state = "pending"
					}
					fmt.Fprintf(w, `{"id":"900","quote":{"state":%q}}`, state)
				default:
					t.Errorf("unexpected endpoint %s", r.URL.Path)
				}
			}))
			defer srv.Close()
			p := New()
			post := integrations.PostDetails{ID: "job", Message: "Commentary", Settings: json.RawMessage(`{"quote_uri":"https://source.social/@author/42"}`)}
			result, err := p.DynamicPostPending(context.Background(), "", "token", srv.URL, []integrations.PostDetails{post})
			if scenario == "old server" || scenario == "denied" {
				if err == nil || mutations != 0 {
					t.Fatalf("unsafe mutation %d %v", mutations, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			final, err := p.FinalizePost(context.Background(), "token", result[0].PendingData, nil)
			if scenario == "pending" {
				if temporalx.FailureType(err) != temporalx.TypeUnknownDelivery || mutations != 1 {
					t.Fatalf("unconfirmed quote allowed retry: %v", err)
				}
				return
			}
			if err != nil || final.PostID != "900" || mutations != 1 {
				t.Fatalf("result %+v %v mutations=%d", final, err, mutations)
			}
			if _, err = p.DynamicComment(context.Background(), "", "900", "", "token", srv.URL, []integrations.PostDetails{{Message: "Finisher", Settings: json.RawMessage(`{"quote_uri":"123"}`)}}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
