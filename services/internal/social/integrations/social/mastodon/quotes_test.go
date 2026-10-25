package mastodon

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNativeQuoteRequiresServerAndPermission(t *testing.T) {
	for _, tc := range []struct {
		name       string
		version    int
		permission string
		mismatch   bool
		want       bool
	}{
		{"supported", 7, "automatic", false, true}, {"old server", 6, "automatic", false, false},
		{"denied", 7, "denied", false, false}, {"manual", 7, "manual", false, false},
		{"missing policy", 7, "", false, false}, {"wrong resolved post", 7, "automatic", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DISABLE_SSRF_PROTECTION", "true")
			target := "https://remote.example/@alice/123"
			writes := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/v2/instance":
					fmt.Fprintf(w, `{"api_versions":{"mastodon":%d}}`, tc.version)
				case "/api/v2/search":
					if r.Header.Get("Authorization") != "Bearer test-token" || r.URL.Query().Get("q") != target || r.URL.Query().Get("resolve") != "true" {
						t.Error("wrong search or token scope")
					}
					returned := target
					if tc.mismatch {
						returned += "9"
					}
					fmt.Fprintf(w, `{"statuses":[{"id":"456","url":%q,"visibility":"public","quote_approval":{"current_user":%q}}]}`, returned, tc.permission)
				case "/api/v1/statuses":
					writes++
					_ = r.ParseMultipartForm(1 << 20)
					if r.Form.Get("quoted_status_id") != "456" || r.Form.Get("status") != "Comment" || r.Header.Get("Idempotency-Key") == "" {
						t.Error("native quote or idempotency missing")
					}
					fmt.Fprint(w, `{"id":"789","quote":{"state":"pending"}}`)
				default:
					t.Error("unexpected call", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer srv.Close()
			result, err := New().DynamicPost(context.Background(), "me", "test-token", srv.URL, []integrations.PostDetails{{ID: "quote", Message: "Comment", Settings: json.RawMessage(`{"quote_url":"` + target + `"}`)}})
			if (err == nil) != tc.want || writes != map[bool]int{true: 1, false: 0}[tc.want] {
				t.Fatalf("err=%v writes=%d", err, writes)
			}
			if tc.want && (len(result) != 1 || result[0].PostID != "789" || result[0].QuoteState != "pending" || result[0].Status != "completed") {
				t.Fatalf("lost confirmed post or pending quote receipt: %#v", result)
			}
		})
	}
}

func TestQuoteReceiptDoesNotInventApproval(t *testing.T) {
	for _, state := range []string{"pending", "accepted", "rejected", "revoked", "deleted", "unauthorized"} {
		if confirmedQuoteState(true, state) != state {
			t.Fatal(state)
		}
	}
	for _, state := range []string{"", "future-state"} {
		if confirmedQuoteState(true, state) != "unconfirmed" {
			t.Fatal(state)
		}
	}
	if confirmedQuoteState(false, "accepted") != "" {
		t.Fatal("ordinary post got a quote receipt")
	}
}
