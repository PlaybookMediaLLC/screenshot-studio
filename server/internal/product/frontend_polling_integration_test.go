package product

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	ra "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/frontendactivation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/frontendobservation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/frontendsource"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/githubobservation"
	fd "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/frontenddeploy"
)

func TestFrontendPagesPollingBaselineRestorationAndRestart(t *testing.T) {
	w := newTestWorkspace(t)
	frontendFixtureCleanup(t, w)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	now := time.Now().UTC()
	current := "old"
	unauthorized := false
	deployment := func(id string) map[string]any {
		at := now.Add(-24 * time.Hour)
		if id == "new" {
			at = now
		}
		return map[string]any{"id": id, "environment": "production", "url": "https://web.pages.dev", "created_on": at.Format(time.RFC3339Nano), "latest_stage": map[string]string{"name": "deploy", "status": "success", "ended_on": at.Format(time.RFC3339Nano)}}
	}
	transport := &http.Client{Transport: frontendTransport(func(r *http.Request) (*http.Response, error) {
		if unauthorized {
			res := frontendResponse(`{}`)
			res.StatusCode = 401
			return res, nil
		}
		var value any = map[string]any{"success": true, "result": map[string]any{"name": "web", "canonical_deployment": deployment(current)}}
		if strings.Contains(r.URL.Path, "/deployments") {
			value = map[string]any{"success": true, "result": []any{deployment("new"), deployment("old")}}
		}
		body, _ := json.Marshal(value)
		return frontendResponse(string(body)), nil
	})}
	w.repo.WithWebhooks(make([]byte, 32), nil).WithFrontendHTTP(transport)
	s, err := w.repo.SaveFrontendSource(w.ctx, w.owner, FrontendSourceInput{Name: "Pages", Provider: "cloudflare_pages", AccountID: "account1", ProjectID: "web", Token: "test-token", Enabled: true, Policy: frontendPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	w.exec(t, `UPDATE frontend_source SET "effectiveAt"=now()-interval '1 minute' WHERE id=$1`, s.ID)
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, w) != 0 {
		t.Fatal("initial history sent live alerts")
	}
	current = "new"
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, w) != 1 {
		t.Fatal("new canonical activation missing")
	}
	w.repo = NewConfiguration(w.db.Client).WithWebhooks(make([]byte, 32), nil).WithFrontendHTTP(transport)
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, w) != 1 {
		t.Fatal("restart duplicated activation")
	}
	current = "old"
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, w) != 2 {
		t.Fatal("restoration of old deployment was discarded")
	}
	rows := w.db.Client.FrontendActivation.Query().Where(frontendactivation.SourceID(s.ID), frontendactivation.Historical(false)).AllX(w.ctx)
	found := false
	for _, a := range rows {
		if a.Snapshot.DeploymentID == "old" {
			found = true
			if a.Snapshot.ActivationID != "" || a.Snapshot.ActivationObservedAt == nil || !a.Snapshot.OccurredAt.Before(s.BaselineAt) {
				t.Fatal("provider activation identity/time fabricated")
			}
		}
	}
	if !found {
		t.Fatal("restoration evidence missing")
	}
	before := w.db.Client.FrontendSource.GetX(w.ctx, s.ID).LastPollAt
	unauthorized = true
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	after := w.db.Client.FrontendSource.GetX(w.ctx, s.ID)
	if after.Health != "credential_revoked" || !after.LastPollAt.Equal(*before) {
		t.Fatalf("failed poll advanced checkpoint: %+v", after)
	}
}

type frontendRecoveryReader struct {
	fakeReader
	deliveries []fd.GitHubRecoveredDelivery
	complete   bool
}

func (f frontendRecoveryReader) DeploymentChecks(context.Context, int64, string, string) ([]fd.Check, error) {
	return []fd.Check{}, nil
}
func (f frontendRecoveryReader) DeploymentDeliveries(context.Context, int64, string, time.Time) ([]fd.GitHubRecoveredDelivery, bool, error) {
	return f.deliveries, f.complete, nil
}

func TestFrontendSharedRepositoryKeepsProjectsDistinct(t *testing.T) {
	f := newAutomationFixture(t)
	frontendFixtureCleanup(t, f.testWorkspace)
	f.repo.WithWebhooks(make([]byte, 32), nil).WithFrontendHTTP(&http.Client{Transport: frontendTransport(func(r *http.Request) (*http.Response, error) {
		parts := strings.Split(r.URL.Path, "/")
		project := parts[len(parts)-1]
		return frontendResponse(`{"id":"` + project + `","accountId":"team1"}`), nil
	})})
	for _, project := range []string{"prj_web", "prj_docs"} {
		s, err := f.repo.SaveFrontendSource(f.ctx, f.owner, FrontendSourceInput{Name: project, GitHubSourceID: f.source.ID, Provider: "vercel", AccountID: "team1", ProjectID: project, Token: "fixture", Secret: "test-only-signing-secret", Enabled: true, Policy: frontendPolicy()})
		if err != nil {
			t.Fatal(err)
		}
		f.exec(t, `UPDATE frontend_source SET "effectiveAt"=now()-interval '1 hour' WHERE id=$1`, s.ID)
		body := frontendVercel("deployment.promoted", "event-"+project, "deployment-"+project, time.Now())
		body = []byte(strings.ReplaceAll(string(body), "prj_web", project))
		if err := f.repo.AcceptFrontendWebhook(f.ctx, s.ID, frontendSignature(body), body); err != nil {
			t.Fatal(err)
		}
	}
	if frontendAlerts(t, f.testWorkspace) != 2 {
		t.Fatal("distinct projects sharing SHA were merged")
	}
	check, _ := json.Marshal(map[string]any{"installation": map[string]any{"id": f.installation}, "repository": map[string]any{"id": 1001}, "check_run": map[string]any{"id": 1, "name": "ci", "head_sha": "revision1", "status": "completed", "conclusion": "success", "completed_at": time.Now().Format(time.RFC3339Nano), "app": map[string]any{"id": 44}}})
	if _, err := f.repo.AcceptGitHubEvent(f.ctx, AcceptGitHubEventInput{DeliveryID: "same-check", EventName: "check_run", Body: check}); err != nil {
		t.Fatal(err)
	}
	rows := f.db.Client.FrontendSource.Query().Where(frontendsource.OrganizationID(f.org)).AllX(f.ctx)
	if len(rows) != 2 {
		t.Fatal("linked projects missing")
	}
	for _, s := range rows {
		history, err := f.repo.FrontendHistory(f.ctx, f.owner, s.ID)
		if err != nil || len(history) != 2 {
			t.Fatalf("check fanout: %d %v", len(history), err)
		}
	}
}

func TestFrontendNetlifyLockedPublishAndRestore(t *testing.T) {
	w := newTestWorkspace(t)
	frontendFixtureCleanup(t, w)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	now := time.Now().UTC()
	current := "baseline"
	deploy := func(id string) map[string]any {
		return map[string]any{"id": id, "site_id": "site1", "context": "production", "state": "ready", "locked": true, "commit_ref": "revision1", "commit_url": "https://github.com/acme/app/commit/revision1", "updated_at": now.Format(time.RFC3339Nano), "published_at": now.Add(-time.Hour).Format(time.RFC3339Nano)}
	}
	transport := &http.Client{Transport: frontendTransport(func(r *http.Request) (*http.Response, error) {
		var value any = map[string]any{"id": "site1", "account_id": "account1", "published_deploy": deploy(current), "ssl_url": "https://example.netlify.app"}
		if strings.HasSuffix(r.URL.Path, "/deploys") {
			preview := deploy("preview")
			preview["context"] = "deploy-preview"
			value = []any{deploy("unpublished"), preview}
		}
		raw, _ := json.Marshal(value)
		return frontendResponse(string(raw)), nil
	})}
	w.repo.WithWebhooks(make([]byte, 32), nil).WithFrontendHTTP(transport)
	policy := frontendPolicy()
	policy.Alerts = []string{"matched", "rollback"}
	s, err := w.repo.SaveFrontendSource(w.ctx, w.owner, FrontendSourceInput{Name: "Netlify", Provider: "netlify", AccountID: "account1", ProjectID: "site1", Token: "fixture", Secret: "test-only-signing-secret", Enabled: true, Policy: policy})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := w.repo.PollFrontends(w.ctx); err != nil {
			t.Fatal(err)
		}
	}
	if frontendAlerts(t, w) != 0 {
		t.Fatal("locked ready deployment or preview announced")
	}
	current = "unpublished"
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, w) != 1 {
		t.Fatal("manual publication not announced")
	}
	current = "baseline"
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, w) != 2 {
		t.Fatal("old deployment restoration not announced")
	}
	if _, err := w.repo.PollFrontends(w.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, w) != 2 {
		t.Fatal("restoration retry duplicated")
	}
	if n := w.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(w.org), outboxevent.Type("activity.frontend.rollback")).CountX(w.ctx); n != 1 {
		t.Fatalf("restoration alert count=%d", n)
	}
	_ = s
}

func TestFrontendGitHubDeliveryRecoveryPinsWorkflow(t *testing.T) {
	f := newAutomationFixture(t)
	frontendFixtureCleanup(t, f.testWorkspace)
	f.graph.Family = ra.Deployed
	f.graph.Qualification = ra.Condition{Field: "deployment.environment", Operator: "eq", Values: []string{"production"}}
	f.graph.Nodes[1].Condition = &ra.Condition{Field: "deployment.state", Operator: "eq", Values: []string{"success"}}
	active := f.activate(t)
	p := frontendPolicy()
	p.WorkflowVersionID = *active.ActiveVersionID
	s, err := f.repo.SaveFrontendSource(f.ctx, f.owner, FrontendSourceInput{ID: f.source.ID, Name: "GitHub frontend", Provider: "github", AccountID: strconv.FormatInt(f.installation, 10), ProjectID: "1001", Enabled: true, Policy: p})
	if err != nil {
		t.Fatal(err)
	}
	f.exec(t, `UPDATE frontend_source SET "effectiveAt"=now()-interval '1 hour',"baselineAt"=now()-interval '1 hour' WHERE id=$1`, s.ID)
	reader := &frontendRecoveryReader{fakeReader: f.repo.github.(fakeReader), complete: true}
	f.repo.WithGitHubApp(reader)
	if _, err := f.repo.PollFrontends(f.ctx); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"installation": map[string]any{"id": f.installation}, "repository": map[string]any{"id": 1001}, "deployment": map[string]any{"id": 501, "sha": "revision1", "environment": "production"}, "deployment_status": map[string]any{"id": 901, "state": "success", "created_at": time.Now().Format(time.RFC3339Nano)}})
	reader.deliveries = []fd.GitHubRecoveredDelivery{{DeliveryID: "missed-delivery", EventName: "deployment_status", Body: raw}}
	for i := 0; i < 2; i++ {
		if _, err := f.repo.PollFrontends(f.ctx); err != nil {
			t.Fatal(err)
		}
	}
	if frontendAlerts(t, f.testWorkspace) != 1 {
		t.Fatal("recovery missing or duplicated alert")
	}
	history, err := f.repo.ListAutomationHistory(f.ctx, f.owner, AutomationHistoryFilter{})
	if err != nil || len(history) != 1 {
		t.Fatalf("workflow history %+v %v", history, err)
	}
	loaded, err := f.repo.LoadReleaseAutomation(f.ctx, f.org, history[0].Run.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Event.Family != ra.Deployed || len(loaded.Event.Fields["deployment.sha"].Values) != 1 || loaded.Event.Fields["deployment.sha"].Values[0] != "revision1" {
		t.Fatalf("wrong workflow evidence %+v", loaded.Event)
	}
	if n := f.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(f.org), outboxevent.Type(EventReleaseAutomationDispatch)).CountX(f.ctx); n != 1 {
		t.Fatalf("dispatch intents %d", n)
	}
	reader.complete = false
	if _, err := f.repo.PollFrontends(f.ctx); err != nil {
		t.Fatal(err)
	}
	if f.db.Client.FrontendSource.GetX(f.ctx, s.ID).Health != "github_delivery_history_gap" {
		t.Fatal("unrecoverable gap hidden")
	}
	reader.complete = true
	if _, err := f.repo.PollFrontends(f.ctx); err != nil {
		t.Fatal(err)
	}
	if f.db.Client.FrontendSource.GetX(f.ctx, s.ID).Health != "github_delivery_history_gap" {
		t.Fatal("a later successful read erased the unrecovered gap")
	}

}

func TestFrontendOnlySelectedEnvironmentsSupersedeProduction(t *testing.T) {
	for _, environment := range []string{"staging", "preview", "", "production", "live"} {
		t.Run(environment, func(t *testing.T) {
			f := newAutomationFixture(t)
			frontendFixtureCleanup(t, f.testWorkspace)
			f.graph.Family = ra.Deployed
			f.graph.Qualification = ra.Condition{Field: "deployment.environment", Operator: "eq", Values: []string{"production"}}
			f.graph.Nodes[1].Condition = &ra.Condition{Field: "deployment.state", Operator: "eq", Values: []string{"success"}}
			active := f.activate(t)
			policy := frontendPolicy()
			policy.Environments = []string{"production", "live"}
			policy.WorkflowVersionID = *active.ActiveVersionID
			policy.Checks = []fd.CheckRule{{Source: "github_check", Name: "ci", AppID: "44", Scope: "commit", Passing: []string{"success"}, MaxAgeSeconds: 3600}}
			source, err := f.repo.SaveFrontendSource(f.ctx, f.owner, FrontendSourceInput{ID: f.source.ID, Name: "GitHub frontend", Provider: "github", AccountID: strconv.FormatInt(f.installation, 10), ProjectID: "1001", Enabled: true, Policy: policy})
			if err != nil {
				t.Fatal(err)
			}
			f.exec(t, `UPDATE frontend_source SET "effectiveAt"=now()-interval '1 hour' WHERE id=$1`, source.ID)
			at := time.Now().UTC().Add(-time.Minute)
			for i, target := range []string{"production", environment} {
				body, _ := json.Marshal(map[string]any{"installation": map[string]any{"id": f.installation}, "repository": map[string]any{"id": 1001}, "deployment": map[string]any{"id": 501 + i, "sha": "revision" + strconv.Itoa(i), "environment": target}, "deployment_status": map[string]any{"id": 901 + i, "state": "success", "created_at": at.Add(time.Duration(i) * time.Second).Format(time.RFC3339Nano)}})
				_, err := f.repo.AcceptGitHubEvent(f.ctx, AcceptGitHubEventInput{DeliveryID: "deployment-" + strconv.Itoa(i), EventName: "deployment_status", Body: body})
				if err != nil {
					t.Fatal(err)
				}
				if target == "" {
					row := f.db.Client.FrontendObservation.Query().Where(frontendobservation.SourceID(source.ID), frontendobservation.EventKey("delivery:deployment-1")).OnlyX(f.ctx)
					if row.Decision.State != "needs_attention" {
						t.Fatalf("missing environment must remain reviewable and unqualified: %+v", row.Decision)
					}
				}
			}
			if frontendAlerts(t, f.testWorkspace) != 0 {
				t.Fatal("deployment alerted before its required check")
			}
			body, _ := json.Marshal(map[string]any{"installation": map[string]any{"id": f.installation}, "repository": map[string]any{"id": 1001}, "check_run": map[string]any{"id": 10, "name": "ci", "head_sha": "revision0", "status": "completed", "conclusion": "success", "completed_at": at.Add(2 * time.Second).Format(time.RFC3339Nano), "app": map[string]any{"id": 44}}})
			if _, err := f.repo.AcceptGitHubEvent(f.ctx, AcceptGitHubEventInput{DeliveryID: "late-check", EventName: "check_run", Body: body}); err != nil {
				t.Fatal(err)
			}
			want := 1
			if environment == "production" || environment == "live" {
				want = 0
			}
			if got := frontendAlerts(t, f.testWorkspace); got != want {
				t.Fatalf("late production check after %q activation: alerts=%d, want %d", environment, got, want)
			}
			if got := f.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(f.org), outboxevent.Type(EventReleaseAutomationDispatch)).CountX(f.ctx); got != want {
				t.Fatalf("late production check after %q activation: workflow dispatches=%d, want %d", environment, got, want)
			}
		})
	}
}

func TestFrontendPollingPagesPastIneligibleSources(t *testing.T) {
	w, template := frontendTestSource(t)
	blocked := newTestWorkspace(t)
	frontendFixtureCleanup(t, blocked)
	w.db.Client.FrontendSource.UpdateOneID(template.ID).SetEnabled(false).ExecX(w.ctx)
	token := w.db.Client.FrontendSource.GetX(w.ctx, template.ID).EncryptedToken
	at := time.Now().UTC().Add(-time.Hour)
	policy, _ := json.Marshal(frontendPolicy())
	seed := func(prefix, org string, count int, checkpoint map[string]string) {
		t.Helper()
		w.exec(t, `INSERT INTO source_app (id,"organizationId",name,provider,"externalId","allowedHosts",status,"updatedAt")
			SELECT $1||n,$2,$1||n,'vercel',$1||n,'[]','ACTIVE',$4 FROM generate_series(1,$3::int) n`, prefix, org, count, at)
		encoded, _ := json.Marshal(checkpoint)
		w.exec(t, `INSERT INTO frontend_source (id,"organizationId",provider,"accountId","projectId",policy,enabled,"encryptedToken",checkpoint,"updatedAt")
			SELECT $1||n,$2,'vercel','team1',$1||n,$4::jsonb,true,$5,$6::jsonb,$7 FROM generate_series(1,$3::int) n`, prefix, org, count, string(policy), token, string(encoded), at)
	}
	seed("a-backoff-"+w.id, w.org, 101, map[string]string{"retryAfter": time.Now().Add(time.Hour).Format(time.RFC3339Nano)})
	seed("b-unavailable-"+blocked.id, blocked.org, 101, map[string]string{})
	seed("c-healthy-"+w.id, w.org, 21, map[string]string{})
	blocked.exec(t, `INSERT INTO workspace_deletion (id,"organizationId","requestedByUserId","scheduledFor","updatedAt") VALUES ($1,$2,$3,now()+interval '7 days',now())`, "deletion-"+blocked.id, blocked.org, blocked.owner.UserID)
	requests := map[string]int{}
	w.repo.WithFrontendHTTP(&http.Client{Transport: frontendTransport(func(r *http.Request) (*http.Response, error) {
		project := strings.TrimPrefix(r.URL.Path, "/v9/projects/")
		if !strings.HasPrefix(project, "c-healthy-") {
			t.Errorf("ineligible source contacted provider: %s", project)
		}
		requests[project]++
		return frontendResponse(`{"id":"` + project + `","accountId":"team1"}`), nil
	})})
	for run := 0; run < 2; run++ {
		count, err := w.repo.PollFrontends(w.ctx)
		if err != nil || count != 20 {
			t.Fatalf("poll %d: count=%d, err=%v", run, count, err)
		}
		total := 0
		for _, n := range requests {
			total += n
		}
		if total != 20*(run+1) {
			t.Fatalf("provider request budget: %d", total)
		}
	}
	if len(requests) != 21 {
		t.Fatalf("eligible sources starved across batches: %d/21 polled", len(requests))
	}
	if got := w.db.Client.FrontendSource.Query().Where(frontendsource.Enabled(true), frontendsource.LastPollAtNotNil(), frontendsource.Or(frontendsource.OrganizationID(w.org), frontendsource.OrganizationID(blocked.org))).CountX(w.ctx); got != 21 {
		t.Fatalf("ineligible source checkpoint changed: completed polls=%d", got)
	}
}

func TestFrontendAuthorityPreservesGitHubEvidenceAndQueuedWork(t *testing.T) {
	f, active, _, _ := productionWorkspace(t)
	frontendFixtureCleanup(t, f.testWorkspace)
	queued := productionDelivery(t, f, 501, 601, "success", "before-frontend", time.Now().Add(time.Second))
	if _, err := f.repo.AcceptGitHubEvent(f.ctx, queued); err != nil {
		t.Fatal(err)
	}
	prior := f.db.Client.GitHubObservation.Query().Where(githubobservation.OrganizationID(f.org)).OnlyX(f.ctx)
	f.repo.WithWebhooks(make([]byte, 32), nil).WithFrontendHTTP(&http.Client{Transport: frontendTransport(func(*http.Request) (*http.Response, error) {
		return frontendResponse(`{"id":"prj_web","accountId":"team1"}`), nil
	})})
	policy := frontendPolicy()
	policy.WorkflowVersionID = *active.ActiveVersionID
	source, err := f.repo.SaveFrontendSource(f.ctx, f.owner, FrontendSourceInput{Name: "Host frontend", GitHubSourceID: f.source.ID, Provider: "vercel", AccountID: "team1", ProjectID: "prj_web", Token: "fixture", Secret: "test-only-signing-secret", Enabled: true, Policy: policy})
	if err != nil {
		t.Fatal(err)
	}
	// Work accepted before the authority change retains its pinned GitHub policy.
	if err := f.repo.processGitHubObservation(f.ctx, f.org, prior.ID); err != nil {
		t.Fatal(err)
	}
	if got := f.db.Client.GitHubObservation.GetX(f.ctx, prior.ID); got.Status != "matched" || got.EventID == nil {
		t.Fatalf("queued GitHub work changed: %+v", got)
	}
	input := productionDelivery(t, f, 502, 602, "success", "after-frontend", time.Now().Add(2*time.Second))
	for i := 0; i < 2; i++ {
		if _, err := f.repo.AcceptGitHubEvent(f.ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	observation := f.db.Client.GitHubObservation.Query().Where(githubobservation.OrganizationID(f.org), githubobservation.DeliveryID(input.DeliveryID)).OnlyX(f.ctx)
	if observation.Status != "not_matched" || observation.PolicyID == nil || observation.DuplicateCount != 1 {
		t.Fatalf("new GitHub evidence was lost or allowed parallel automation: %+v", observation)
	}
	if err := f.repo.processGitHubObservation(f.ctx, f.org, observation.ID); err != nil {
		t.Fatal(err)
	}
	if count := f.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(f.org), outboxevent.Type(EventGitHubObservation)).CountX(f.ctx); count != 1 {
		t.Fatalf("new GitHub processing enqueued after frontend opt-in: %d", count)
	}
	body := frontendVercel("deployment.promoted", "host-authority", "host-deployment", time.Now().Add(3*time.Second))
	for i := 0; i < 2; i++ {
		if err := f.repo.AcceptFrontendWebhook(f.ctx, source.ID, frontendSignature(body), body); err != nil {
			t.Fatal(err)
		}
	}
	if frontendAlerts(t, f.testWorkspace) != 1 {
		t.Fatal("authoritative provider did not emit exactly one frontend alert")
	}
	if count := f.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(f.org), outboxevent.Type(EventReleaseAutomationDispatch)).CountX(f.ctx); count != 2 {
		t.Fatalf("expected one previously queued workflow and one frontend workflow, got %d", count)
	}
}

func TestFrontendGitHubRecoveryDeliveryRemainsReviewOnly(t *testing.T) {
	f := newAutomationFixture(t)
	frontendFixtureCleanup(t, f.testWorkspace)
	source, err := f.repo.SaveFrontendSource(f.ctx, f.owner, FrontendSourceInput{ID: f.source.ID, Name: "GitHub frontend", Provider: "github", AccountID: strconv.FormatInt(f.installation, 10), ProjectID: "1001", Enabled: true, Policy: frontendPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	input := productionDelivery(t, f, 501, 601, "success", "recovered-"+f.id, time.Now().Add(time.Second))
	f.exec(t, `INSERT INTO github_delivery_recovery (id,guid,"installationId","repositoryId","eventName","deliveredAt","statusCode",recovery) VALUES ($1,$2,$3,'1001','deployment_status',now(),500,true)`, "recovery-"+f.id, input.DeliveryID, f.installation)
	t.Cleanup(func() {
		if _, err := f.db.SQL.ExecContext(f.ctx, `DELETE FROM github_delivery_recovery WHERE "installationId"=$1`, f.installation); err != nil {
			t.Error(err)
		}
	})
	if _, err := f.repo.AcceptGitHubEvent(f.ctx, input); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, f.testWorkspace) != 0 {
		t.Fatal("provider redelivery marked for review triggered a live frontend alert")
	}
	if count := f.db.Client.FrontendObservation.Query().Where(frontendobservation.SourceID(source.ID), frontendobservation.Historical(true)).CountX(f.ctx); count != 1 {
		t.Fatalf("recovered frontend evidence was not retained for review: %d", count)
	}
	polled := productionDelivery(t, f, 502, 602, "success", "polled-recovery-"+f.id, time.Now().Add(2*time.Second))
	f.exec(t, `INSERT INTO github_delivery_recovery (id,guid,"installationId","repositoryId","eventName","deliveredAt","statusCode",recovery) VALUES ($1,$2,$3,'1001','deployment_status',now(),500,true)`, "polled-recovery-"+f.id, polled.DeliveryID, f.installation)
	f.db.Client.FrontendSource.UpdateOneID(source.ID).SetLastPollAt(time.Now().Add(-time.Minute)).ExecX(f.ctx)
	f.repo.WithGitHubApp(frontendRecoveryReader{fakeReader: f.repo.github.(fakeReader), complete: true, deliveries: []fd.GitHubRecoveredDelivery{{DeliveryID: polled.DeliveryID, EventName: polled.EventName, Body: polled.Body}}})
	if _, err := f.repo.PollFrontends(f.ctx); err != nil {
		t.Fatal(err)
	}
	if frontendAlerts(t, f.testWorkspace) != 0 || f.db.Client.FrontendObservation.Query().Where(frontendobservation.SourceID(source.ID), frontendobservation.Historical(true)).CountX(f.ctx) != 2 {
		t.Fatal("API polling bypassed the recovered-delivery review boundary")
	}
}
