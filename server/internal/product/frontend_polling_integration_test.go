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
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/frontendsource"
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
