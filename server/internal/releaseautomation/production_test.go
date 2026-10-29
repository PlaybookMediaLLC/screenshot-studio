package releaseautomation

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func productionFixture(t *testing.T) (ProductionPolicy, GitHubEvidence) {
	t.Helper()
	body, err := os.ReadFile("testdata/deployment-status.json")
	if err != nil {
		t.Fatal(err)
	}
	e, err := NormalizeGitHubEvidence("deployment_status", body)
	if err != nil {
		t.Fatal(err)
	}
	p := ProductionPolicy{SchemaVersion: 1, Enabled: true, InstallationID: 77, RepositoryID: "1001", Environments: []string{"production", "prod-us"}, Refs: []string{"main"}, Signal: "deployment_status", Workflows: []GitHubWorkflow{{ID: 301, Name: "Web image", Path: ".github/workflows/web-image.yml"}}, JobNames: []string{"deploy"}, TrustedAppIDs: []int64{900}, RequireChangeReceipt: true, DefinitionID: "shots-workflow"}
	return p, *e
}
func TestProductionPolicyEvidenceAndConflicts(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		change     func(*ProductionPolicy, *GitHubEvidence)
	}{
		{"reported-change", "matched", func(*ProductionPolicy, *GitHubEvidence) {}},
		{"staging-flagged-production", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) {
			e.Environment = "staging"
			e.DeploymentEnvironment = "staging"
		}},
		{"explicit-nonproduction", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { v := false; e.Production = &v }},
		{"conflicting-environments", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.DeploymentEnvironment = "preview" }},
		{"missing-environment", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.Environment = "" }},
		{"alias", "matched", func(_ *ProductionPolicy, e *GitHubEvidence) {
			e.Environment = "prod-us"
			e.DeploymentEnvironment = "prod-us"
		}},
		{"wrong-installation", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) { e.InstallationID = 88 }},
		{"wrong-repository", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) { e.RepositoryID = "1002" }},
		{"failed-deployment", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) { e.State = "failure" }},
		{"missing-workflow-association", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.Association = "" }},
		{"same-name-new-id", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) { e.Workflow.ID = 302 }},
		{"renamed-workflow", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.Workflow.Name = "Renamed" }},
		{"different-job", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) { e.JobName = "build" }},
		{"missing-job", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.JobID = 0 }},
		{"no-op", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) { v := false; e.ChangeReceipt = &v }},
		{"unknown-no-op", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.ChangeReceipt = nil }},
		{"wrong-revision", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.ReceiptRevision = "other" }},
		{"untrusted-reporter", "not_matched", func(_ *ProductionPolicy, e *GitHubEvidence) { e.AppID = 901 }},
		{"paused", "not_matched", func(p *ProductionPolicy, _ *GitHubEvidence) { p.Enabled = false }},
		{"missing-ref", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.Ref = "" }},
		{"conflicting-identity", "needs_attention", func(_ *ProductionPolicy, e *GitHubEvidence) { e.Conflict = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, e := productionFixture(t)
			tc.change(&p, &e)
			d := EvaluateProduction(p, e)
			if d.Status != tc.want {
				t.Fatalf("%+v", d)
			}
			if len(d.Checks) == 0 || d.Reason == "" {
				t.Fatal("unexplained decision")
			}
		})
	}
}
func TestActionsOutcomesRequireExplicitTrust(t *testing.T) {
	for _, name := range []string{"workflow_run", "workflow_job"} {
		body, err := os.ReadFile("testdata/" + strings.ReplaceAll(name, "_", "-") + ".json")
		if err != nil {
			t.Fatal(err)
		}
		e, err := NormalizeGitHubEvidence(name, body)
		if err != nil {
			t.Fatal(err)
		}
		p, _ := productionFixture(t)
		if d := EvaluateProduction(p, *e); d.Status != "not_matched" {
			t.Fatal("Actions success became a deployment", d)
		}
		p.Signal = name
		p.Environments = []string{"production"}
		p.TrustedAppIDs = nil
		p.RequireChangeReceipt = false
		p.TrustActionsOutcome = true
		if name == "workflow_run" {
			p.JobNames = nil
		} else {
			e.Workflow = p.Workflows[0]
			e.Association = "run_attempt_api"
		}
		d := EvaluateProduction(p, *e)
		if d.Status != "matched" || d.Strength != "trusted_actions_outcome" {
			t.Fatal(d)
		}
		if event := ProductionEvent(*e, p); event.ObjectID != e.ObjectKey || ValidateEvent(event) != nil {
			t.Fatal("Actions attempt identity lost downstream", event)
		}
		e.State = "skipped"
		if EvaluateProduction(p, *e).Status != "not_matched" {
			t.Fatal("skipped job matched")
		}
		p.TrustActionsOutcome = false
		if ValidateProductionPolicy(p) == nil {
			t.Fatal("implicit trust accepted")
		}
	}
}
func TestGitHubObservationIdentitiesAndBounds(t *testing.T) {
	p, e := productionFixture(t)
	if e.ObjectKey != "deployment:1001:501" || e.Key != "deployment:1001:501:status:601" || e.URL != "https://app.example.com/" {
		t.Fatal(e)
	}
	if event := ProductionEvent(e, p); ValidateEvent(event) != nil {
		t.Fatal(event)
	}
	body, _ := os.ReadFile("testdata/deployment-status.json")
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	status := payload["deployment_status"].(map[string]any)
	status["state"] = "failure"
	status["id"] = 602
	body, _ = json.Marshal(payload)
	failed, err := NormalizeGitHubEvidence("deployment_status", body)
	if err != nil || failed.Key == e.Key || failed.ObjectKey != e.ObjectKey || failed.State != "failure" {
		t.Fatal(failed, err)
	}
	payload["padding"] = strings.Repeat("x", 2<<20)
	body, _ = json.Marshal(payload)
	if _, err := NormalizeGitHubEvidence("deployment_status", body); err != nil {
		t.Fatal("valid payload above old 1 MiB bound rejected", err)
	}
	if _, err := NormalizeGitHubEvidence("deployment_status", make([]byte, MaxGitHubPayloadBytes+1)); err == nil {
		t.Fatal("unbounded payload")
	}
	for _, body := range []string{`{`, `{"installation":{"id":77},"repository":{"id":1001},"deployment":{"id":1},"deployment_status":{"state":"success","created_at":"2026-10-28T00:00:00Z"}}`} {
		if _, err := NormalizeGitHubEvidence("deployment_status", []byte(body)); err == nil {
			t.Fatal("missing source identity accepted")
		}
	}
	body, _ = os.ReadFile("testdata/workflow-run.json")
	first, _ := NormalizeGitHubEvidence("workflow_run", body)
	body = []byte(strings.ReplaceAll(string(body), `"run_attempt":1`, `"run_attempt":2`))
	rerun, _ := NormalizeGitHubEvidence("workflow_run", body)
	if first.ObjectKey == rerun.ObjectKey || first.SHA != rerun.SHA {
		t.Fatal("rerun merged by SHA")
	}
	if e.OccurredAt.Equal(time.Time{}) {
		t.Fatal("provider time lost")
	}
}

func TestProductionEventPreservesDeploymentGraphFields(t *testing.T) {
	p, _ := productionFixture(t)
	body, err := os.ReadFile("testdata/deployment-status.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		edit func(map[string]any)
	}{
		{"common metadata", func(map[string]any) {}},
		{"missing metadata stays missing", func(payload map[string]any) {
			delete(payload, "sender")
			delete(payload["repository"].(map[string]any), "full_name")
			delete(payload["repository"].(map[string]any), "default_branch")
			delete(payload["deployment"].(map[string]any), "sha")
		}},
		{"implicit success action", func(payload map[string]any) { delete(payload, "action") }},
		{"target URL fallback", func(payload map[string]any) {
			status := payload["deployment_status"].(map[string]any)
			delete(status, "environment_url")
			status["target_url"] = "https://app.example.com/deployment?token=private"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var payload map[string]any
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatal(err)
			}
			tc.edit(payload)
			modified, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			_, legacy, err := NormalizeGitHub("deployment_status", modified)
			if err != nil {
				t.Fatal(err)
			}
			evidence, err := NormalizeGitHubEvidence("deployment_status", modified)
			if err != nil {
				t.Fatal(err)
			}
			// The observation is persisted before the graph adapter reads it.
			stored, err := json.Marshal(evidence)
			if err != nil {
				t.Fatal(err)
			}
			var restored GitHubEvidence
			if err := json.Unmarshal(stored, &restored); err != nil {
				t.Fatal(err)
			}
			event := ProductionEvent(restored, p)
			if err := ValidateEvent(event); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(event.Fields, legacy.Fields) || event.DefaultBranch != legacy.DefaultBranch || event.URL != SafeEvidenceURL(legacy.URL) {
				t.Errorf("qualified event lost deployment metadata: got %+v, legacy %+v", event, legacy)
			}
			for _, field := range []string{"repository.name", "actor.login", "deployment.sha"} {
				condition := Condition{Field: field, Operator: "eq", Values: []string{"unknown"}}
				observed, present := legacy.Fields[field]
				if present {
					condition.Values = observed.Values
				}
				decision := Evaluate(condition, event)
				if present && (decision.Status != "evaluated" || !decision.Match) || !present && decision.Status != "missing" {
					t.Errorf("graph condition %s lost its evidence: %+v", field, decision)
				}
			}
		})
	}
}

func TestRepositoryWorkflowsCanSucceedWithoutDeploying(t *testing.T) {
	for _, file := range []string{"web-image.yml", "social-backend-image.yml"} {
		body, err := os.ReadFile("../../../.github/workflows/" + file)
		if err != nil {
			t.Fatal(err)
		}
		for _, evidence := range []string{"workflow_dispatch:", "inputs.deploy", "newer", "environment: production"} {
			if !strings.Contains(string(body), evidence) {
				t.Fatalf("update concrete workflow fixture: %s lacks %s", file, evidence)
			}
		}
	}
	p, e := productionFixture(t)
	e.ChangeReceipt = nil
	if EvaluateProduction(p, e).Status != "needs_attention" {
		t.Fatal("success without change receipt proved a new deployment")
	}
}
