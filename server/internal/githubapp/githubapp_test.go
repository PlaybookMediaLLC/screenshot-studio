package githubapp

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
	"github.com/golang-jwt/jwt/v5"
)

func testApp(t *testing.T, handler http.HandlerFunc) (*App, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &App{ID: "12345", ClientID: "Iv1.client", ClientSecret: "secret", Key: key, HTTP: server.Client(),
		API: server.URL, Web: server.URL}, key
}

func TestAppJWTAndCachedInstallationTokens(t *testing.T) {
	var minted atomic.Int32
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	var publicKey *rsa.PublicKey
	app, key := testApp(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/app/installations/77/access_tokens" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		claims := jwt.RegisteredClaims{}
		token, err := jwt.ParseWithClaims(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), &claims,
			func(*jwt.Token) (any, error) { return publicKey, nil }, jwt.WithValidMethods([]string{"RS256"}),
			jwt.WithTimeFunc(func() time.Time { return now }))
		if err != nil || !token.Valid || claims.Issuer != "12345" || claims.ExpiresAt.Sub(claims.IssuedAt.Time) > 10*time.Minute {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		minted.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"token": fmt.Sprintf("ghs_%d", minted.Load()), "expires_at": now.Add(time.Hour)})
	})
	publicKey = &key.PublicKey
	app.Now = func() time.Time { return now }
	first, err := app.InstallationToken(context.Background(), 77)
	if err != nil || first != "ghs_1" {
		t.Fatalf("token=%q err=%v", first, err)
	}
	again, _ := app.InstallationToken(context.Background(), 77)
	if again != "ghs_1" || minted.Load() != 1 {
		t.Fatalf("token not reused: %q minted=%d", again, minted.Load())
	}
	now = now.Add(56 * time.Minute) // within five minutes of expiry
	refreshed, _ := app.InstallationToken(context.Background(), 77)
	if refreshed != "ghs_2" {
		t.Fatalf("token not refreshed near expiry: %q", refreshed)
	}
}

func TestUserVerificationAndRepositoryReads(t *testing.T) {
	app, _ := testApp(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/login/oauth/access_token":
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["code"] == "good" && body["client_secret"] == "secret" {
				_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "ghu_user"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad_verification_code"})
		case r.URL.Path == "/user/installations" && r.Header.Get("Authorization") == "Bearer ghu_user":
			page := r.URL.Query().Get("page")
			items := []map[string]any{}
			if page == "1" {
				for i := int64(0); i < 100; i++ {
					items = append(items, map[string]any{"id": i})
				}
			} else if page == "2" {
				items = append(items, map[string]any{"id": 500, "account": map[string]string{"login": "acme", "type": "Organization"},
					"repository_selection": "selected", "suspended_at": "2026-10-16T00:00:00Z"})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"installations": items})
		case strings.HasSuffix(r.URL.Path, "/access_tokens"):
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "ghs_x", "expires_at": time.Now().Add(time.Hour)})
		case r.URL.Path == "/repositories/9/pulls" && r.Header.Get("Authorization") == "token ghs_x":
			_, _ = w.Write([]byte(`[{"number":1,"title":"merged","merged_at":"2026-10-16T10:00:00Z","user":{"login":"octocat","type":"User"}},
				{"number":2,"title":"closed unmerged","merged_at":null}]`))
		default:
			http.NotFound(w, r)
		}
	})
	if _, err := app.ExchangeCode(context.Background(), "bad"); err == nil {
		t.Fatal("a bad code was accepted")
	}
	userToken, err := app.ExchangeCode(context.Background(), "good")
	if err != nil || userToken != "ghu_user" {
		t.Fatalf("user token=%q err=%v", userToken, err)
	}
	installations, err := app.UserInstallations(context.Background(), userToken)
	if err != nil || len(installations) != 101 || installations[100] != (Installation{ID: 500, AccountLogin: "acme",
		AccountType: "Organization", RepositorySelection: "selected", Suspended: true}) {
		t.Fatalf("installations=%d last=%+v err=%v", len(installations), installations[len(installations)-1], err)
	}
	merged, err := app.MergedPullRequests(context.Background(), 77, "9", "main", 30)
	if err != nil || len(merged) != 1 || merged[0].Number != 1 || merged[0].User.Login != "octocat" {
		t.Fatalf("merged=%+v err=%v", merged, err)
	}
	var status StatusError
	if _, err := app.Releases(context.Background(), 77, "404", 5); !errors.As(err, &status) || status.Status != http.StatusNotFound {
		t.Fatalf("missing repository err=%v", err)
	}
}

func TestPullRequestFilesRequireCompleteEvidence(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		count *int
		short bool
		want  int
		fail  bool
	}{
		{"paginated", intPointer(101), false, 101, false},
		{"empty", intPointer(0), false, 0, false},
		{"missing_count", nil, false, 0, true},
		{"truncated", intPointer(101), true, 0, true},
		{"provider_limit", intPointer(3001), false, 0, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			app, _ := testApp(t, func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasSuffix(r.URL.Path, "/access_tokens"):
					_ = json.NewEncoder(w).Encode(map[string]any{"token": "fixture", "expires_at": time.Now().Add(time.Hour)})
				case strings.HasSuffix(r.URL.Path, "/pulls/7"):
					_ = json.NewEncoder(w).Encode(map[string]any{"changed_files": scenario.count})
				case strings.HasSuffix(r.URL.Path, "/files"):
					files := []map[string]string{}
					if r.URL.Query().Get("page") == "1" {
						for i := 0; i < 100; i++ {
							files = append(files, map[string]string{"filename": fmt.Sprintf("src/%d.go", i)})
						}
					} else if !scenario.short {
						files = append(files, map[string]string{"filename": "src/last.go"})
					}
					_ = json.NewEncoder(w).Encode(files)
				default:
					http.NotFound(w, r)
				}
			})
			files, err := app.PullRequestFiles(context.Background(), 77, "9", 7)
			if scenario.fail {
				if !errors.Is(err, ErrIncompleteFiles) || files != nil {
					t.Fatalf("partial evidence accepted: %v %v", files, err)
				}
				return
			}
			if err != nil || len(files) != scenario.want {
				t.Fatalf("files=%d err=%v", len(files), err)
			}
		})
	}
}

func intPointer(value int) *int { return &value }

func TestRateLimitIsDistinguishedFromRevocation(t *testing.T) {
	app, _ := testApp(t, func(w http.ResponseWriter, _ *http.Request) { w.Header().Set("Retry-After", "60"); w.WriteHeader(403) })
	err := app.request(context.Background(), http.MethodGet, app.API, "", "", nil, nil)
	var status StatusError
	if !errors.As(err, &status) || !status.RateLimited {
		t.Fatalf("rate limit lost: %v", err)
	}
}

func TestProductionWorkflowPaginationAndAttemptCorrelation(t *testing.T) {
	for _, incomplete := range []bool{false, true} {
		app, _ := testApp(t, func(w http.ResponseWriter, r *http.Request) {
			switch {
			case strings.HasSuffix(r.URL.Path, "/access_tokens"):
				_ = json.NewEncoder(w).Encode(map[string]any{"token": "fixture", "expires_at": time.Now().Add(time.Hour)})
			case strings.HasSuffix(r.URL.Path, "/actions/workflows"):
				items := []map[string]any{}
				count := 100
				if r.URL.Query().Get("page") == "2" {
					count = 1
					if incomplete {
						count = 0
					}
				}
				for i := 0; i < count; i++ {
					id := i + 1
					if r.URL.Query().Get("page") == "2" {
						id = 101
					}
					items = append(items, map[string]any{"id": id, "name": "deploy", "path": ".github/workflows/deploy.yml", "state": "active"})
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"total_count": 101, "workflows": items})
			case strings.HasSuffix(r.URL.Path, "/runs/401/attempts/2"):
				_, _ = w.Write([]byte(`{"id":401,"run_attempt":2,"workflow_id":301,"name":"Web image","path":".github/workflows/web-image.yml","repository":{"id":1001}}`))
			case strings.HasSuffix(r.URL.Path, "/runs/401/attempts/2/jobs"):
				_, _ = w.Write([]byte(`{"total_count":1,"jobs":[{"id":701,"run_id":401,"run_attempt":2,"name":"deploy","status":"completed","conclusion":"success"}]}`))
			default:
				http.NotFound(w, r)
			}
		})
		workflows, err := app.Workflows(context.Background(), 77, "1001")
		if incomplete {
			if !errors.Is(err, ErrIncompleteEvidence) {
				t.Fatal("partial workflow list accepted", err)
			}
		} else if err != nil || len(workflows) != 101 {
			t.Fatal(len(workflows), err)
		}
		e, err := app.EnrichProductionEvidence(context.Background(), automation.GitHubEvidence{RepositoryID: "1001", InstallationID: 77, RunID: 401, RunAttempt: 2, JobID: 701, JobName: "deploy"})
		if err != nil || e.Workflow.ID != 301 || e.Association != "run_attempt_api" {
			t.Fatal(e, err)
		}
		e.JobID = 702
		if _, err := app.EnrichProductionEvidence(context.Background(), e); err == nil {
			t.Fatal("unrelated job correlated")
		}
	}
}

func TestAppDeliveryPaginationAndEmptyRedeliveryAcknowledgement(t *testing.T) {
	app, _ := testApp(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("delivery API did not use App JWT")
		}
		if r.Method == http.MethodPost {
			w.WriteHeader(202)
			return
		}
		if r.URL.Query().Get("cursor") == "" {
			w.Header().Set("Link", fmt.Sprintf(`<http://%s/app/hook/deliveries?cursor=next>; rel="next"`, r.Host))
		}
		_, _ = w.Write([]byte(`[{"id":123,"guid":"fixture","installation_id":77,"repository_id":1001,"event":"workflow_run","delivered_at":"2026-10-28T12:00:00Z","status_code":500}]`))
	})
	page, err := app.Deliveries(context.Background(), "")
	if err != nil || page.NextCursor != "next" || len(page.Deliveries) != 1 {
		t.Fatal(page, err)
	}
	if err := app.Redeliver(context.Background(), "123"); err != nil {
		t.Fatal("empty 202 rejected", err)
	}
	if err := app.Redeliver(context.Background(), "../config"); err == nil {
		t.Fatal("unsafe delivery id accepted")
	}
}
