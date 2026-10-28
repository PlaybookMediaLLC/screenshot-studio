package frontenddeploy

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrPayload = errors.New("invalid provider payload")

type object map[string]any

func decode(body []byte) (object, error) {
	var m object
	if len(body) == 0 || len(body) > MaxBody {
		return nil, ErrPayload
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	if d.Decode(&m) != nil || m == nil {
		return nil, ErrPayload
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, ErrPayload
	}
	return m, nil
}
func obj(m object, k string) object { v, _ := m[k].(map[string]any); return object(v) }
func str(m object, k string) string {
	switch v := m[k].(type) {
	case string:
		if len(v) <= 2000 {
			return v
		}
	case json.Number:
		return v.String()
	}
	return ""
}
func stamp(m object, k string) time.Time {
	s := str(m, k)
	if n, e := strconv.ParseInt(s, 10, 64); e == nil && n > 0 {
		return time.UnixMilli(n).UTC()
	}
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}
func list(m object, k string) []object {
	a, ok := m[k].([]any)
	if !ok {
		return nil
	}
	out := []object{}
	for _, v := range a {
		if o, ok := v.(map[string]any); ok {
			out = append(out, object(o))
		} else {
			return nil
		}
	}
	return out
}
func first(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}
func state(s string) string {
	switch strings.ToLower(s) {
	case "success", "succeeded", "ready", "completed":
		return "success"
	case "error", "failed", "failure":
		return "failure"
	case "cancelled", "canceled":
		return "cancelled"
	case "skipped":
		return "skipped"
	}
	return "pending"
}

func NormalizeWebhook(provider string, body []byte) (Observation, error) {
	m, e := decode(body)
	if e != nil {
		return Observation{}, e
	}
	o := Observation{Provider: provider, Key: "body:" + Fingerprint(body), Checks: []Check{}, Evidence: []string{}}
	switch provider {
	case "vercel":
		p := obj(m, "payload")
		dep := obj(p, "deployment")
		meta := obj(dep, "meta")
		o.ProviderEventID = str(m, "id")
		o.Key = "event:" + o.ProviderEventID
		o.Kind = str(m, "type")
		o.OccurredAt = stamp(m, "createdAt")
		o.AccountID = first(str(obj(p, "team"), "id"), str(obj(p, "user"), "id"))
		o.ProjectID = str(obj(p, "project"), "id")
		o.DeploymentID = str(dep, "id")
		o.Environment = str(p, "target")
		o.Revision = str(meta, "githubCommitSha")
		o.Branch = str(meta, "githubCommitRef")
		o.RepositoryID = str(meta, "githubRepoId")
		o.URL = SafeURL(str(obj(p, "links"), "deployment"))
		o.Status = "pending"
		switch o.Kind {
		case "deployment.promoted":
			o.Environment = "production"
			o.Production = "active"
			o.Status = "success"
			o.Build = "success"
			o.ActivationID = o.ProviderEventID
			o.Evidence = append(o.Evidence, "Vercel deployment.promoted: production traffic promotion reported complete.")
		case "deployment.ready", "deployment.succeeded":
			o.Build = "success"
			o.Production = "pending"
			o.Evidence = append(o.Evidence, "Build ready; awaiting explicit production promotion.")
		case "deployment.error":
			o.Status = "failure"
			o.Build = "failure"
		case "deployment.canceled":
			o.Status = "cancelled"
		case "deployment.rollback":
			o.DeploymentID = str(p, "toDeploymentId")
			o.Environment = "production"
			o.Rollback = true
			o.Production = "pending"
			o.Evidence = append(o.Evidence, "Rollback request accepted; traffic switch is not confirmed.")
		case "deployment.created":
			o.Production = "pending"
		default:
			return Observation{}, ErrPayload
		}
		if o.ProviderEventID == "" || o.AccountID == "" {
			return Observation{}, ErrPayload
		}
	case "netlify":
		o.Kind = "deploy.notification"
		o.ProjectID = str(m, "site_id")
		o.AccountID = str(m, "account_id")
		o.DeploymentID = str(m, "id")
		o.Environment = str(m, "context")
		o.Revision = str(m, "commit_ref")
		o.RepositoryName = githubCommitRepository(str(m, "commit_url"), o.Revision)
		o.Branch = str(m, "branch")
		o.OccurredAt = stamp(m, "updated_at")
		o.Build = state(str(m, "state"))
		o.Status = o.Build
		if m["skipped"] == true {
			o.Status = "skipped"
		}
		o.Production = "pending"
		o.URL = SafeURL(str(m, "admin_url"))
		o.Evidence = append(o.Evidence, "Signed Netlify notification; publication requires a fresh site's published_deploy observation.")
	default:
		return Observation{}, ErrPayload
	}
	if o.ProjectID == "" || o.DeploymentID == "" || o.OccurredAt.IsZero() {
		return Observation{}, ErrPayload
	}
	return o, nil
}

// NormalizeGitHub keeps Actions and checks as observations, never as production
// proof. Deployment status IDs identify status occurrences independently of SHA.
func NormalizeGitHub(name, delivery string, body []byte) (Observation, error) {
	m, e := decode(body)
	if e != nil {
		return Observation{}, e
	}
	o := Observation{Provider: "github", AccountID: str(obj(m, "installation"), "id"), ProjectID: str(obj(m, "repository"), "id"), RepositoryID: str(obj(m, "repository"), "id"), Key: "delivery:" + delivery, ProviderEventID: delivery, Kind: name, Checks: []Check{}, Evidence: []string{}}
	if o.AccountID == "" || o.ProjectID == "" || delivery == "" {
		return o, ErrPayload
	}
	switch name {
	case "deployment_status":
		d, s := obj(m, "deployment"), obj(m, "deployment_status")
		o.DeploymentID = str(d, "id")
		o.ActivationID = str(s, "id")
		o.Environment = first(str(s, "environment"), str(d, "environment"))
		o.Revision = str(d, "sha")
		o.OccurredAt = stamp(s, "created_at")
		o.Status = state(str(s, "state"))
		o.URL = SafeURL(str(s, "environment_url"))
		o.Production = "pending"
		// ref may be a tag or a branch; do not guess either from its spelling.
		if o.Status == "success" {
			o.Production = "active"
			o.Evidence = append(o.Evidence, "GitHub deployment_status reported success for this environment.")
		}
		if o.ActivationID == "" {
			o.Production = "unknown"
			o.Evidence = append(o.Evidence, "Missing deployment status identity; activation cannot be deduplicated safely.")
		}
	case "workflow_run", "workflow_job":
		r := obj(m, name)
		o.RunID = first(str(r, "run_id"), str(r, "id"))
		o.RunAttempt, _ = strconv.Atoi(str(r, "run_attempt"))
		o.WorkflowID = str(r, "workflow_id")
		o.Revision = str(r, "head_sha")
		o.Branch = str(r, "head_branch")
		o.Status = state(str(r, "conclusion"))
		o.OccurredAt = stamp(r, "updated_at")
		if o.OccurredAt.IsZero() {
			o.OccurredAt = stamp(r, "completed_at")
		}
		if o.OccurredAt.IsZero() {
			o.OccurredAt = stamp(r, "started_at")
		}
		if o.OccurredAt.IsZero() {
			o.OccurredAt = stamp(r, "created_at")
		}
		o.URL = SafeURL(str(r, "html_url"))
		if name == "workflow_job" {
			o.JobID = str(r, "id")
			o.Job = str(r, "name")
		}
		o.Evidence = append(o.Evidence, "Actions result retained. No provider-established deployment association; a successful or no-op job does not prove publication.")
	case "check_run":
		r := obj(m, name)
		o.Revision = str(r, "head_sha")
		o.OccurredAt = stamp(r, "completed_at")
		if o.OccurredAt.IsZero() {
			o.OccurredAt = stamp(r, "started_at")
		}
		o.Checks = []Check{{Source: "github_check", ID: str(r, "id"), Name: str(r, "name"), AppID: str(obj(r, "app"), "id"), RepositoryID: o.RepositoryID, Revision: o.Revision, Status: str(r, "status"), Conclusion: str(r, "conclusion"), OccurredAt: o.OccurredAt}}
	case "status":
		o.Revision = str(m, "sha")
		o.OccurredAt = stamp(m, "updated_at")
		status := "completed"
		if str(m, "state") == "pending" {
			status = "pending"
		}
		o.Checks = []Check{{Source: "github_status", ID: str(m, "id"), Name: str(m, "context"), RepositoryID: o.RepositoryID, Revision: o.Revision, Status: status, Conclusion: str(m, "state"), OccurredAt: o.OccurredAt}}
	default:
		return o, ErrPayload
	}
	if o.OccurredAt.IsZero() {
		o.Evidence = append(o.Evidence, "Provider occurrence time is unavailable; this observation cannot establish a live activation or a passing check.")
		if o.Production == "active" {
			o.Production = "unknown"
		}
	}
	return o, nil
}

// NetlifyPublication uses the authenticated site's current published deploy,
// not deploy.state=ready, which also describes locked/unpublished deployments.
func NetlifyPublication(body []byte) (Observation, error) {
	m, e := decode(body)
	if e != nil {
		return Observation{}, e
	}
	d := obj(m, "published_deploy")
	o := Observation{Provider: "netlify", AccountID: str(m, "account_id"), ProjectID: str(m, "id"), Kind: "site.published_deploy", DeploymentID: str(d, "id"), Environment: str(d, "context"), Revision: str(d, "commit_ref"), Branch: str(d, "branch"), Status: state(str(d, "state")), URL: SafeURL(first(str(m, "ssl_url"), str(m, "url"))), OccurredAt: stamp(d, "published_at"), Checks: []Check{}, Evidence: []string{"Authenticated site.published_deploy identifies the deployment serving the main site."}}
	o.RepositoryName = githubCommitRepository(str(d, "commit_url"), o.Revision)
	o.Build = o.Status
	if d["skipped"] == true {
		o.Status = "skipped"
	}
	if o.Status == "success" && o.Environment == "production" {
		o.Production = "active"
	}
	o.ActivationKey = o.DeploymentID + ":" + str(d, "published_at")
	o.Key = "publication:" + o.ActivationKey
	if o.DeploymentID == "" || o.OccurredAt.IsZero() || o.ProjectID == "" {
		return o, ErrPayload
	}
	return o, nil
}

func PagesDeployment(account, project string, body []byte, canonical bool) (Observation, error) {
	m, e := decode(body)
	if e != nil {
		return Observation{}, e
	}
	stage := obj(m, "latest_stage")
	meta := obj(obj(m, "deployment_trigger"), "metadata")
	o := Observation{Provider: "cloudflare_pages", AccountID: account, ProjectID: project, Kind: "pages.deployment", DeploymentID: str(m, "id"), Environment: str(m, "environment"), Branch: str(meta, "branch"), Revision: str(meta, "commit_hash"), Status: state(str(stage, "status")), URL: SafeURL(str(m, "url")), OccurredAt: stamp(stage, "ended_on"), Checks: []Check{}, Evidence: []string{"Authenticated Pages deployment API."}}
	if o.OccurredAt.IsZero() {
		o.OccurredAt = stamp(m, "created_on")
	}
	if m["is_skipped"] == true {
		o.Status = "skipped"
	}
	source := obj(m, "source")
	if str(source, "type") == "github" && str(obj(m, "deployment_trigger"), "type") == "github:push" && meta["commit_dirty"] != true {
		o.RepositoryID = str(obj(source, "config"), "repo_id")
	}
	o.Key = "snapshot:" + Fingerprint(body)
	o.Production = "pending"
	if str(stage, "name") == "build" && o.Status == "success" {
		o.Build = "success"
	}
	if str(stage, "name") == "deploy" && o.Status == "success" && o.Environment == "production" && canonical {
		o.Production = "active"
		o.Build = "success"
		o.Evidence = append(o.Evidence, "Successful final deploy stage and project canonical_deployment agree.")
	}
	if o.DeploymentID == "" || o.OccurredAt.IsZero() {
		return o, ErrPayload
	}
	return o, nil
}

func WorkerDeployment(account, script string, body []byte) (Observation, error) {
	m, e := decode(body)
	if e != nil {
		return Observation{}, e
	}
	o := Observation{Provider: "cloudflare_workers", AccountID: account, ProjectID: script, Kind: "workers.deployment", DeploymentID: str(m, "id"), ActivationID: str(m, "id"), Environment: "production", OccurredAt: stamp(m, "created_on"), Status: "pending", Production: "pending", Checks: []Check{}, Evidence: []string{"Authenticated Worker deployments API; script is explicitly selected as the production frontend."}}
	versions := list(m, "versions")
	if versions == nil {
		return o, ErrPayload
	}
	if len(versions) == 1 && str(versions[0], "percentage") == "100" && str(versions[0], "version_id") != "" {
		o.Production = "active"
		o.Status = "success"
		o.Evidence = append(o.Evidence, "Worker version "+str(versions[0], "version_id")+" receives 100% of traffic.")
	}
	o.Key = "deployment:" + o.ActivationID
	if o.DeploymentID == "" || o.OccurredAt.IsZero() {
		return o, ErrPayload
	}
	return o, nil
}

// The provider's commit URL binds its revision to a repository; it is never
// fetched. Repository identity is resolved independently via the installed App.
func githubCommitRepository(raw, sha string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || sha == "" {
		return ""
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) != 4 || parts[2] != "commit" || parts[3] != sha {
		return ""
	}
	return parts[0] + "/" + parts[1]
}
