// Package frontenddeploy owns production evidence. A build, an activation and
// human release qualification are deliberately different facts.
package frontenddeploy

import (
	"errors"
	"net/url"
	"slices"
	"strings"
	"time"
)

const MaxBody = 1 << 20

type CheckRule struct {
	Source        string   `json:"source"`
	Name          string   `json:"name"`
	AppID         string   `json:"appId"`
	Scope         string   `json:"scope"`
	Passing       []string `json:"passing"`
	MaxAgeSeconds int      `json:"maxAgeSeconds"`
}

type Policy struct {
	SchemaVersion     int         `json:"schemaVersion"`
	Environments      []string    `json:"environments"`
	Branch            string      `json:"branch"`
	Tag               string      `json:"tag"`
	Domain            string      `json:"domain"`
	WorkflowID        string      `json:"workflowId"`
	Job               string      `json:"job"`
	Checks            []CheckRule `json:"checks"`
	Alerts            []string    `json:"alerts"`
	WorkflowVersionID string      `json:"workflowVersionId"`
}

type Check struct {
	Source       string    `json:"source"`
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	AppID        string    `json:"appId"`
	RepositoryID string    `json:"repositoryId"`
	Revision     string    `json:"revision"`
	DeploymentID string    `json:"deploymentId"`
	Status       string    `json:"status"`
	Conclusion   string    `json:"conclusion"`
	OccurredAt   time.Time `json:"occurredAt"`
}

// Observation contains only bounded provider facts. Key is a local deduplication
// key; ProviderEventID and ActivationID are never invented when absent upstream.
type Observation struct {
	Provider             string     `json:"provider"`
	AccountID            string     `json:"accountId"`
	ProjectID            string     `json:"projectId"`
	Key                  string     `json:"key"`
	ProviderEventID      string     `json:"providerEventId"`
	Kind                 string     `json:"kind"`
	DeploymentID         string     `json:"deploymentId"`
	ActivationID         string     `json:"activationId"`
	ActivationKey        string     `json:"activationKey"`
	Environment          string     `json:"environment"`
	Branch               string     `json:"branch"`
	Tag                  string     `json:"tag"`
	Revision             string     `json:"revision"`
	RepositoryID         string     `json:"repositoryId"`
	RepositoryName       string     `json:"repositoryName"`
	RunID                string     `json:"runId"`
	RunAttempt           int        `json:"runAttempt"`
	WorkflowID           string     `json:"workflowId"`
	JobID                string     `json:"jobId"`
	Job                  string     `json:"job"`
	WorkflowLinked       bool       `json:"workflowLinked"`
	URL                  string     `json:"url"`
	Status               string     `json:"status"`
	Build                string     `json:"build"`
	Production           string     `json:"production"`
	Rollback             bool       `json:"rollback"`
	OccurredAt           time.Time  `json:"occurredAt"`
	Checks               []Check    `json:"checks"`
	ActivationObservedAt *time.Time `json:"activationObservedAt"`
	Evidence             []string   `json:"evidence"`
}

type Decision struct {
	State        string `json:"state"`
	Reason       string `json:"reason"`
	Checks       string `json:"checks"`
	VerifiedLive bool   `json:"verifiedLive"`
	ReleaseReady bool   `json:"releaseReady"`
}

func ValidatePolicy(p Policy) error {
	if p.SchemaVersion != 1 || len(p.Environments) == 0 || len(p.Environments) > 10 || len(p.Checks) > 20 || len(p.Alerts) > 4 {
		return errors.New("invalid deployment policy")
	}
	for _, s := range append(append([]string{}, p.Environments...), p.Branch, p.Tag, p.Domain, p.WorkflowID, p.Job, p.WorkflowVersionID) {
		if len(s) > 255 || strings.ContainsAny(s, "\r\n\x00") {
			return errors.New("invalid policy selector")
		}
	}
	if p.Domain != "" {
		u, e := url.Parse("https://" + p.Domain)
		if e != nil || u.Hostname() != p.Domain || u.User != nil {
			return errors.New("domain must be a hostname")
		}
	}
	for _, a := range p.Alerts {
		if !slices.Contains([]string{"matched", "failed", "needs_attention", "rollback"}, a) {
			return errors.New("invalid alert")
		}
	}
	seen := map[string]bool{}
	for _, c := range p.Checks {
		key := c.Source + ":" + c.AppID + ":" + c.Name
		if seen[key] || c.Name == "" || len(c.Name) > 200 || len(c.AppID) > 100 || !slices.Contains([]string{"github_check", "github_status", "vercel_check"}, c.Source) || !slices.Contains([]string{"commit", "deployment"}, c.Scope) || len(c.Passing) == 0 || len(c.Passing) > 3 || c.MaxAgeSeconds < 60 || c.MaxAgeSeconds > 604800 {
			return errors.New("invalid required check")
		}
		if c.Source == "github_check" && c.AppID == "" {
			return errors.New("GitHub checks require their App ID")
		}
		for _, pass := range c.Passing {
			if !slices.Contains([]string{"success", "neutral"}, pass) {
				return errors.New("only explicit success or neutral conclusions may pass")
			}
		}
		seen[key] = true
	}
	return nil
}

// Evaluate is also the preview evaluator. It performs no network, writes or
// automation. Missing and skipped checks cannot fall through to success.
func Evaluate(p Policy, o Observation, now time.Time) Decision {
	d := Decision{State: "needs_attention", Reason: "Production activation evidence is missing.", Checks: "not_configured"}
	if len(p.Checks) > 0 {
		d.Checks = "missing"
	}
	if ValidatePolicy(p) != nil {
		d.Reason = "Invalid policy."
		return d
	}
	if o.Environment != "" && !slices.Contains(p.Environments, o.Environment) {
		d.State = "not_matched"
		d.Reason = "Environment is not selected production."
		return d
	}
	for _, s := range []struct{ want, got, name string }{{p.Branch, o.Branch, "branch"}, {p.Tag, o.Tag, "tag"}} {
		if s.want == "" {
			continue
		}
		if s.got == "" {
			d.Reason = "Provider did not report the selected " + s.name + "."
			return d
		}
		if s.want != s.got {
			d.State = "not_matched"
			d.Reason = "Different " + s.name + "."
			return d
		}
	}
	if o.Status == "failure" || o.Build == "failure" {
		d.State = "failed"
		d.Reason = "Provider reported a deployment or build failure."
		return d
	}
	if o.Status == "skipped" || o.Status == "cancelled" {
		d.State = "not_matched"
		d.Reason = "Deployment was skipped or cancelled."
		return d
	}
	if o.Production != "active" || o.Environment == "" || o.DeploymentID == "" {
		if o.Production == "pending" || o.Status == "pending" {
			d.State = "pending"
			d.Reason = "Build or production publication remains pending."
		}
		return d
	}
	if p.Domain != "" {
		u, e := url.Parse(o.URL)
		if e != nil || u.Hostname() != p.Domain {
			d.Reason = "Provider evidence does not identify the selected production domain."
			return d
		}
	}
	if p.WorkflowID != "" || p.Job != "" {
		if !o.WorkflowLinked || o.RunID == "" || o.RunAttempt < 1 {
			d.Reason = "No provider-established link from this deployment to the selected GitHub run and attempt."
			return d
		}
		if p.WorkflowID != "" && p.WorkflowID != o.WorkflowID || p.Job != "" && p.Job != o.Job {
			d.State = "not_matched"
			d.Reason = "Different deployment workflow or job."
			return d
		}
	}
	var blocked Decision
	priority := map[string]int{"pending": 1, "needs_attention": 2, "failed": 3}
	for _, rule := range p.Checks {
		result := evaluateCheck(rule, o, now)
		if priority[result.State] > priority[blocked.State] {
			blocked = result
		}
	}
	if blocked.State != "" {
		return blocked
	}
	d.State = "matched"
	d.Reason = "Provider reported a successful production deployment."
	if len(p.Checks) > 0 {
		d.Checks = "passed"
		d.Reason = "Production deployment reported successful; configured required checks passed."
	}
	return d
}

func evaluateCheck(rule CheckRule, o Observation, now time.Time) Decision {
	d := Decision{State: "needs_attention", Checks: "missing"}
	var found *Check
	conflict := false
	for i := range o.Checks {
		c := &o.Checks[i]
		if c.Source != rule.Source || c.Name != rule.Name || c.AppID != rule.AppID {
			continue
		}
		if rule.Scope == "deployment" {
			if c.DeploymentID == "" || c.DeploymentID != o.DeploymentID {
				continue
			}
		} else if o.Revision == "" || c.Revision != o.Revision || o.RepositoryID == "" || c.RepositoryID != o.RepositoryID {
			continue
		}
		if found == nil || c.OccurredAt.After(found.OccurredAt) {
			found = c
			conflict = false
		} else if c.OccurredAt.Equal(found.OccurredAt) && (c.Status != found.Status || c.Conclusion != found.Conclusion) {
			conflict = true
		}
	}
	if conflict {
		d.Reason = "Conflicting required check results: " + rule.Name
		return d
	}
	if found == nil {
		d.Reason = "Missing safely correlated required check: " + rule.Name
		return d
	}
	if found.OccurredAt.IsZero() || found.OccurredAt.After(now.Add(time.Minute)) || now.Sub(found.OccurredAt) > time.Duration(rule.MaxAgeSeconds)*time.Second {
		d.Checks = "stale"
		d.Reason = "Required check is stale or has an invalid time: " + rule.Name
		return d
	}
	if found.Status != "completed" {
		d.State = "pending"
		d.Checks = "pending"
		d.Reason = "Required check is pending: " + rule.Name
		return d
	}
	if slices.Contains([]string{"failure", "cancelled", "timed_out", "action_required", "error"}, found.Conclusion) {
		d.State = "failed"
		d.Checks = "failed"
		d.Reason = "Required check failed: " + rule.Name
		return d
	}
	if !slices.Contains(rule.Passing, found.Conclusion) {
		d.Checks = "not_passed"
		d.Reason = "Required check did not explicitly pass: " + rule.Name
		return d
	}
	return Decision{}
}

func SafeURL(s string) string {
	u, e := url.Parse(s)
	if e != nil || len(s) > 2000 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return ""
	}
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}
