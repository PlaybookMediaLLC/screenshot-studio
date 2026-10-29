package frontenddeploy

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

var fixtureTime = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

func TestGitHubPayloadBudgetPreservesBoundedSnapshots(t *testing.T) {
	body, err := json.Marshal(map[string]any{
		"installation": map[string]int{"id": 77}, "repository": map[string]int{"id": 1001},
		"deployment":        map[string]any{"id": 501, "environment": "production", "sha": "revision1"},
		"deployment_status": map[string]any{"id": 601, "state": "success", "created_at": fixtureTime.Format(time.RFC3339Nano)},
		"unused_metadata":   strings.Repeat("x", 2*MaxBody),
	})
	if err != nil {
		t.Fatal(err)
	}
	observation, err := NormalizeGitHub("deployment_status", "large-github-delivery", body)
	if err != nil || observation.Production != "active" {
		t.Fatalf("valid GitHub payload rejected: %+v %v", observation, err)
	}
	snapshot, _ := json.Marshal(observation)
	if len(snapshot) > 10000 {
		t.Fatal("unselected GitHub metadata leaked into the stored snapshot")
	}
	if _, err := decode(body); !errors.Is(err, ErrPayload) {
		t.Fatal("hosting-provider response budget was widened")
	}
	if _, err := NormalizeGitHub("deployment_status", "too-large", make([]byte, releaseautomation.MaxGitHubPayloadBytes+1)); !errors.Is(err, ErrPayload) {
		t.Fatal("GitHub payload budget was not enforced")
	}
}

func policyFixture() Policy {
	return Policy{SchemaVersion: 1, Environments: []string{"production"}, Alerts: []string{"matched"}, Checks: []CheckRule{}}
}
func activeFixture() Observation {
	return Observation{Provider: "vercel", ProjectID: "prj_web", DeploymentID: "dpl_1", ActivationID: "evt_promote", Environment: "production", RepositoryID: "1001", Revision: "abc123", Production: "active", Status: "success", OccurredAt: fixtureTime}
}

func TestRequiredChecksAreExactAndNeverImplicit(t *testing.T) {
	p := policyFixture()
	p.Checks = []CheckRule{{Source: "github_check", Name: "frontend-tests", AppID: "44", Scope: "commit", Passing: []string{"success"}, MaxAgeSeconds: 3600}}
	c := Check{Source: "github_check", Name: "frontend-tests", AppID: "44", ID: "check1", RepositoryID: "1001", Revision: "abc123", Status: "completed", Conclusion: "success", OccurredAt: fixtureTime}
	for _, test := range []struct {
		name, want string
		change     func(*Observation)
	}{
		{"pass", "matched", func(o *Observation) {}},
		{"wrong revision", "needs_attention", func(o *Observation) { o.Checks[0].Revision = "old" }},
		{"wrong repository", "needs_attention", func(o *Observation) { o.Checks[0].RepositoryID = "another" }},
		{"wrong app", "needs_attention", func(o *Observation) { o.Checks[0].AppID = "untrusted" }},
		{"pending", "pending", func(o *Observation) { o.Checks[0].Status = "in_progress" }},
		{"skipped", "needs_attention", func(o *Observation) { o.Checks[0].Conclusion = "skipped" }},
		{"failed", "failed", func(o *Observation) { o.Checks[0].Conclusion = "failure" }},
		{"stale", "needs_attention", func(o *Observation) { o.Checks[0].OccurredAt = fixtureTime.Add(-2 * time.Hour) }},
		{"missing", "needs_attention", func(o *Observation) { o.Checks = nil }},
		{"unlinked job", "needs_attention", func(o *Observation) { o.RunID = "123"; o.RunAttempt = 1 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			o := activeFixture()
			o.Checks = []Check{c}
			rules := p
			if test.name == "unlinked job" {
				rules.Job = "deploy"
			}
			test.change(&o)
			d := Evaluate(rules, o, fixtureTime)
			if d.State != test.want || d.VerifiedLive || d.ReleaseReady {
				t.Fatalf("%+v", d)
			}
		})
	}
	o := activeFixture()
	o.Checks = []Check{c}
	p.Checks[0].Scope = "deployment"
	if Evaluate(p, o, fixtureTime).State == "matched" {
		t.Fatal("commit check passed deployment scope")
	}
	o.Checks[0].DeploymentID = o.DeploymentID
	if Evaluate(p, o, fixtureTime).State != "matched" {
		t.Fatal("matching deployment check rejected")
	}
}

func TestVercelPromotionIsDistinctFromReadinessAndRollbackRequest(t *testing.T) {
	for _, tc := range []struct{ kind, target, want string }{{"deployment.promoted", "", "matched"}, {"deployment.ready", "production", "pending"}, {"deployment.succeeded", "production", "pending"}, {"deployment.ready", "preview", "not_matched"}, {"deployment.error", "production", "failed"}, {"deployment.rollback", "", "pending"}} {
		body, _ := json.Marshal(map[string]any{"id": "evt_1", "type": tc.kind, "createdAt": fixtureTime.UnixMilli(), "payload": map[string]any{"team": map[string]string{"id": "team_1"}, "project": map[string]string{"id": "prj_web"}, "deployment": map[string]any{"id": "dpl_1", "meta": map[string]string{"githubCommitSha": "abc123", "githubRepoId": "1001"}}, "target": tc.target, "toDeploymentId": "dpl_old"}})
		o, err := NormalizeWebhook("vercel", body)
		if err != nil {
			t.Fatal(err)
		}
		d := Evaluate(policyFixture(), o, fixtureTime)
		if d.State != tc.want {
			t.Errorf("%s: %+v", tc.kind, d)
		}
		if d.State == "matched" && (d.Checks != "not_configured" || strings.Contains(d.Reason, "checks passed")) {
			t.Fatal("claimed unconfigured checks passed")
		}
	}
}

func TestNetlifyRequiresPublishedSiteAndPagesRequiresFinalStage(t *testing.T) {
	notification := []byte(`{"id":"new","site_id":"site1","context":"production","state":"ready","updated_at":"2026-10-28T12:00:00Z"}`)
	o, e := NormalizeWebhook("netlify", notification)
	if e != nil {
		t.Fatal(e)
	}
	if Evaluate(policyFixture(), o, fixtureTime).State != "pending" {
		t.Fatal("unpublished deploy passed")
	}
	site := []byte(`{"id":"site1","account_id":"account1","published_deploy":{"id":"old","context":"production","state":"ready","published_at":"2026-10-28T12:00:00Z"}}`)
	o, e = NetlifyPublication(site)
	if e != nil || o.DeploymentID != "old" || Evaluate(policyFixture(), o, fixtureTime).State != "matched" {
		t.Fatalf("%+v %v", o, e)
	}
	for _, tc := range []struct {
		environment, stage, status, want string
		canonical                        bool
	}{{"production", "deploy", "success", "matched", true}, {"preview", "deploy", "success", "not_matched", true}, {"production", "build", "success", "pending", true}, {"production", "deploy", "skipped", "not_matched", true}, {"production", "deploy", "active", "pending", true}, {"production", "deploy", "success", "pending", false}} {
		body, _ := json.Marshal(map[string]any{"id": "pages1", "environment": tc.environment, "created_on": fixtureTime.Format(time.RFC3339), "latest_stage": map[string]string{"name": tc.stage, "status": tc.status, "ended_on": fixtureTime.Format(time.RFC3339)}})
		o, e := PagesDeployment("account1", "web", body, tc.canonical)
		if e != nil {
			t.Fatal(e)
		}
		if d := Evaluate(policyFixture(), o, fixtureTime); d.State != tc.want {
			t.Errorf("%+v => %+v", tc, d)
		}
	}
}

func TestWorkersRequireVersionTrafficEvidence(t *testing.T) {
	for _, tc := range []struct{ versions, want string }{{`[]`, "pending"}, {`[{"version_id":"v1","percentage":10},{"version_id":"v2","percentage":90}]`, "pending"}, {`[{"version_id":"v2","percentage":100}]`, "matched"}} {
		o, e := WorkerDeployment("account1", "web", []byte(`{"id":"activation1","created_on":"2026-10-28T12:00:00Z","versions":`+tc.versions+`}`))
		if e != nil {
			t.Fatal(e)
		}
		if got := Evaluate(policyFixture(), o, fixtureTime).State; got != tc.want {
			t.Fatalf("%s: %s", tc.versions, got)
		}
	}
	if _, err := WorkerDeployment("a", "web", []byte(`{"build_id":"b1","status":"success"}`)); err == nil {
		t.Fatal("build was accepted as deployment")
	}
}

func TestProviderSignaturesBindOriginalBodyAndAlgorithm(t *testing.T) {
	body := []byte(`{"site_id":"site1","state":"ready"}`)
	secret := "fixture-secret-only"
	m := hmac.New(sha1.New, []byte(secret))
	m.Write(body)
	sig := hex.EncodeToString(m.Sum(nil))
	if !VerifyWebhook("vercel", secret, sig, body) || VerifyWebhook("vercel", secret, sig, append(body, ' ')) {
		t.Fatal("Vercel signature binding")
	}
	jwt := func(alg, iss string, b []byte) string {
		h := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"` + alg + `"}`))
		digest := sha256.Sum256(b)
		p := base64.RawURLEncoding.EncodeToString([]byte(`{"iss":"` + iss + `","sha256":"` + hex.EncodeToString(digest[:]) + `"}`))
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(h + "." + p))
		return h + "." + p + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	}
	valid := jwt("HS256", "netlify", body)
	if !VerifyWebhook("netlify", secret, valid, body) {
		t.Fatal("Netlify signature rejected")
	}
	for _, bad := range []string{jwt("none", "netlify", body), jwt("HS256", "other", body), jwt("HS256", "netlify", []byte("{}")), valid + "x", ""} {
		if VerifyWebhook("netlify", secret, bad, body) {
			t.Fatal("invalid Netlify signature accepted")
		}
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestProviderReadsAreBoundedAndFailuresAreExplicit(t *testing.T) {
	for _, provider := range []string{"vercel", "netlify", "cloudflare_pages", "cloudflare_workers"} {
		for _, tc := range []struct {
			status int
			code   string
		}{{401, "credential_revoked"}, {403, "permission_missing"}, {404, "project_unavailable"}, {429, "rate_limited"}, {302, "provider_unavailable"}, {503, "provider_unavailable"}} {
			calls := 0
			c := Client{HTTP: &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer test-token" {
					t.Fatal("unexpected outbound request")
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Retry-After": []string{"120"}}, Body: io.NopCloser(strings.NewReader("{}"))}, nil
			})}}
			_, err := c.Poll(context.Background(), provider, "a", "web", "test-token", fixtureTime)
			var api *APIError
			if !errors.As(err, &api) || api.Code != tc.code {
				t.Fatalf("%s %d: %v", provider, tc.status, err)
			}
			if calls != 1 || api.RetryAfter != 120*time.Second {
				t.Fatalf("%s retried inside SDK or lost backoff: calls=%d error=%+v", provider, calls, api)
			}
		}
	}
}

func TestProviderSDKOwnershipRequests(t *testing.T) {
	t.Setenv("CLOUDFLARE_API_KEY", "unrelated-process-key")
	t.Setenv("CLOUDFLARE_API_EMAIL", "unrelated@example.test")
	t.Setenv("CLOUDFLARE_API_TOKEN", "unrelated-process-token")
	for _, tc := range []struct{ provider, path, body string }{
		{"vercel", "/v9/projects/web", `{"id":"web","accountId":"account"}`},
		{"netlify", "/api/v1/sites/web", `{"id":"web","account_id":"account"}`},
		{"cloudflare_pages", "/client/v4/accounts/account/pages/projects/web", `{"success":true,"result":{"name":"web"}}`},
		{"cloudflare_workers", "/client/v4/accounts/account/workers/scripts/web/deployments", `{"success":true,"result":{"deployments":[]}}`},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			c := Client{HTTP: &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != tc.path || r.Header.Get("Authorization") != "Bearer isolated-token" {
					t.Fatalf("SDK request: %s", r.URL.Path)
				}
				if _, present := r.Header["X-Auth-Key"]; present {
					t.Fatal("SDK sent a second authentication mechanism")
				}
				if _, present := r.Header["X-Auth-Email"]; present {
					t.Fatal("SDK inherited process-level credentials")
				}
				if tc.provider == "vercel" && r.URL.Query().Get("teamId") != "account" {
					t.Fatal("team scope missing")
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})}}
			if err := c.Verify(context.Background(), tc.provider, "account", "web", "isolated-token"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProviderSDKRejectsOversizedAndMalformedEvidence(t *testing.T) {
	for _, provider := range []string{"vercel", "netlify", "cloudflare_pages", "cloudflare_workers"} {
		for _, body := range []string{strings.Repeat(" ", MaxBody+1), `{} {}`, `null`, `{"success":false,"result":{"name":"web"}}`} {
			c := Client{HTTP: &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}}
			if err := c.Verify(context.Background(), provider, "account", "web", "isolated-token"); err == nil {
				t.Fatalf("%s accepted invalid provider response", provider)
			}
		}
	}
}

func TestVercelSDKChecksKeepDeploymentIdentityAndTime(t *testing.T) {
	c := Client{HTTP: &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/deployments/dpl_1/checks" || r.URL.Query().Get("teamId") != "team_1" {
			t.Fatalf("wrong scoped check request: %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"checks":[{"id":"c1","name":"smoke","integrationId":"app1","status":"completed","conclusion":"succeeded","updatedAt":1793188800000}]}`))}, nil
	})}}
	checks, err := c.VercelChecks(context.Background(), "team_1", "dpl_1", "isolated-token")
	if err != nil || len(checks) != 1 {
		t.Fatalf("%+v %v", checks, err)
	}
	if checks[0].DeploymentID != "dpl_1" || checks[0].AppID != "app1" || checks[0].Conclusion != "success" || checks[0].OccurredAt.UnixMilli() != 1793188800000 {
		t.Fatalf("lost check evidence: %+v", checks[0])
	}
}

func TestProviderSDKPaginationKeepsBoundedCoverage(t *testing.T) {
	for _, provider := range []string{"netlify", "cloudflare_pages", "cloudflare_workers"} {
		t.Run(provider, func(t *testing.T) {
			pagesRead := 0
			c := Client{HTTP: &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
				var body string
				if strings.HasSuffix(r.URL.Path, "/web") {
					body = `{"id":"web","account_id":"account"}`
					if provider == "cloudflare_pages" {
						body = `{"success":true,"result":{"name":"web"}}`
					}
				} else {
					pagesRead++
					if r.URL.Query().Get("page") != strconv.Itoa(pagesRead) || r.URL.Query().Get("per_page") != "50" {
						t.Fatalf("unexpected page: %s", r.URL.RawQuery)
					}
					item := `{"id":"d1","site_id":"web","context":"production","state":"ready","updated_at":"2026-10-28T12:00:00Z"}`
					if provider == "cloudflare_pages" {
						item = `{"id":"d1","environment":"production","created_on":"2026-10-28T12:00:00Z","latest_stage":{"name":"deploy","status":"success"}}`
					}
					if provider == "cloudflare_workers" {
						item = `{"id":"d1","created_on":"2026-10-28T12:00:00Z","versions":[{"version_id":"v1","percentage":100}]}`
					}
					body = "[" + strings.TrimSuffix(strings.Repeat(item+",", 50), ",") + "]"
					if provider == "cloudflare_pages" {
						body = `{"success":true,"result":` + body + `}`
					}
					if provider == "cloudflare_workers" {
						body = `{"success":true,"result":{"deployments":` + body + `}}`
					}
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}}
			batch, err := c.Poll(context.Background(), provider, "account", "web", "isolated-token", fixtureTime.Add(-time.Hour))
			if err != nil {
				t.Fatal(err)
			}
			if pagesRead != 4 || batch.Complete || batch.Health != "history_gap_page_limit" {
				t.Fatalf("unbounded or silently complete history: calls=%d batch=%+v", pagesRead, batch)
			}
		})
	}
}

func TestGitHubActionsSuccessNeverMeansDeployment(t *testing.T) {
	for _, name := range []string{"workflow_run", "workflow_job"} {
		body := []byte(`{"installation":{"id":1},"repository":{"id":2},"` + name + `":{"id":3,"run_id":4,"run_attempt":2,"name":"deploy","head_sha":"abc","conclusion":"success","completed_at":"2026-10-28T12:00:00Z"}}`)
		o, e := NormalizeGitHub(name, "delivery", body)
		if e != nil {
			t.Fatal(e)
		}
		if d := Evaluate(policyFixture(), o, fixtureTime); d.State == "matched" {
			t.Fatal("build-only/no-op Actions result passed")
		}
	}
}

func TestConflictingChecksAndFailurePriority(t *testing.T) {
	p := policyFixture()
	p.Checks = []CheckRule{{Source: "vercel_check", Name: "smoke", Scope: "deployment", Passing: []string{"success"}, MaxAgeSeconds: 3600}, {Source: "vercel_check", Name: "security", Scope: "deployment", Passing: []string{"success"}, MaxAgeSeconds: 3600}}
	o := activeFixture()
	o.Checks = []Check{{Source: "vercel_check", Name: "security", DeploymentID: o.DeploymentID, Status: "completed", Conclusion: "failure", OccurredAt: fixtureTime}}
	if got := Evaluate(p, o, fixtureTime); got.State != "failed" {
		t.Fatalf("missing check hid failure: %+v", got)
	}
	p.Checks = p.Checks[1:]
	pass := o.Checks[0]
	pass.ID = "other"
	pass.Conclusion = "success"
	o.Checks = append(o.Checks, pass)
	if got := Evaluate(p, o, fixtureTime); got.State != "needs_attention" {
		t.Fatalf("conflict passed: %+v", got)
	}
	latest := pass
	latest.OccurredAt = fixtureTime.Add(time.Second)
	o.Checks = append(o.Checks, latest)
	if got := Evaluate(p, o, fixtureTime.Add(time.Second)); got.State != "matched" {
		t.Fatalf("newer result did not supersede: %+v", got)
	}
}

func TestWorkersPollOnlyCurrentDeploymentCanQualify(t *testing.T) {
	httpClient := &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"success":true,"result":{"deployments":[{"id":"current","created_on":"2026-10-28T12:01:00Z","versions":[{"version_id":"v2","percentage":50},{"version_id":"v1","percentage":50}]},{"id":"old","created_on":"2026-10-28T12:00:00Z","versions":[{"version_id":"v1","percentage":100}]}]}}`))}, nil
	})}
	b, err := (Client{HTTP: httpClient}).Poll(context.Background(), "cloudflare_workers", "account", "script", "fixture", fixtureTime.Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if b.Current == nil || b.Current.DeploymentID != "current" || Evaluate(policyFixture(), *b.Current, fixtureTime).State == "matched" {
		t.Fatalf("wrong current deployment %+v", b)
	}
	for _, o := range b.Observations {
		if Evaluate(policyFixture(), o, fixtureTime).State == "matched" {
			t.Fatal("old Worker deployment announced")
		}
	}
}

func TestPagesSkippedAndDirtyCommitCannotPass(t *testing.T) {
	raw := []byte(`{"id":"d1","environment":"production","is_skipped":true,"created_on":"2026-10-28T12:00:00Z","latest_stage":{"name":"deploy","status":"success"},"source":{"type":"github","config":{"repo_id":"1001"}},"deployment_trigger":{"type":"github:push","metadata":{"commit_hash":"abc123","commit_dirty":true}}}`)
	o, err := PagesDeployment("account", "project", raw, true)
	if err != nil {
		t.Fatal(err)
	}
	if o.RepositoryID != "" || Evaluate(policyFixture(), o, fixtureTime).State != "not_matched" {
		t.Fatalf("unsafe Pages evidence %+v", o)
	}
}

func TestMalformedWorkerVersionCannotBeDiscardedToClaimFullTraffic(t *testing.T) {
	_, err := WorkerDeployment("account", "frontend", []byte(`{"id":"deployment","created_on":"2026-10-28T12:00:00Z","versions":[{"version_id":"v1","percentage":100},null]}`))
	if err == nil {
		t.Fatal("malformed traffic allocation accepted")
	}
}
