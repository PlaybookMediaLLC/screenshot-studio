package frontenddeploy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// Client issues bounded GETs only, to fixed official API hosts. Tests supply an
// isolated RoundTripper; no caller can configure an outbound API base URL.
type Client struct{ HTTP *http.Client }
type APIError struct {
	Code       string
	RetryAfter time.Duration
}

func (e *APIError) Error() string { return e.Code }

type Batch struct {
	Observations []Observation
	Current      *Observation
	Complete     bool
	Health       string
}

type GitHubRecoveredDelivery struct {
	DeliveryID string
	EventName  string
	Body       json.RawMessage
	OccurredAt time.Time
}

// Verify checks provider ownership using only authenticated project metadata.
func (c Client) Verify(ctx context.Context, provider, account, project, token string) error {
	raw, e := c.project(ctx, provider, account, project, token)
	if e != nil {
		return e
	}
	m, e := decode(raw)
	if e != nil {
		return e
	}
	valid := false
	switch provider {
	case "vercel":
		valid = str(m, "id") == project && str(m, "accountId") == account
	case "netlify":
		valid = str(m, "id") == project && str(m, "account_id") == account
	case "cloudflare_pages":
		valid = m["success"] == true && str(obj(m, "result"), "name") == project
	case "cloudflare_workers":
		valid = m["success"] == true && obj(m, "result") != nil
	}
	if !valid {
		return &APIError{Code: "account_project_mismatch"}
	}
	return nil
}

func (c Client) Poll(ctx context.Context, provider, account, project, token string, since time.Time) (Batch, error) {
	b := Batch{Observations: []Observation{}, Complete: true, Health: "ready"}
	switch provider {
	case "netlify":
		raw, e := c.project(ctx, provider, account, project, token)
		if e != nil {
			return b, e
		}
		site, e := decode(raw)
		if e != nil {
			return b, e
		}
		if str(site, "id") != project || str(site, "account_id") != account {
			return b, &APIError{Code: "account_project_mismatch"}
		}
		if len(obj(site, "published_deploy")) > 0 {
			o, e := NetlifyPublication(raw)
			if e != nil {
				return b, e
			}
			b.Current = &o
		}
		for page := 1; page <= 4; page++ {
			raw, e = c.deployments(ctx, provider, account, project, token, page)
			if e != nil {
				return b, e
			}
			var items []json.RawMessage
			if json.Unmarshal(raw, &items) != nil {
				return b, ErrPayload
			}
			reached := false
			for _, item := range items {
				o, e := NormalizeWebhook("netlify", item)
				if e != nil {
					return b, e
				}
				o.Kind = "deploy.observed"
				o.Evidence = []string{"Authenticated Netlify deployment API; publication requires the site's current published_deploy."}
				if o.ProjectID != project {
					return b, ErrPayload
				}
				if !since.IsZero() && o.OccurredAt.Before(since) {
					reached = true
				}
				b.Observations = append(b.Observations, o)
			}
			if len(items) < 50 || reached {
				break
			}
			if page == 4 {
				b.Complete = false
			}
		}
	case "cloudflare_pages":
		raw, e := c.project(ctx, provider, account, project, token)
		if e != nil {
			return b, e
		}
		root, e := decode(raw)
		if e != nil || root["success"] != true {
			return b, ErrPayload
		}
		p := obj(root, "result")
		if str(p, "name") != project {
			return b, ErrPayload
		}
		canonical := obj(p, "canonical_deployment")
		if len(canonical) > 0 {
			raw, _ := json.Marshal(canonical)
			o, e := PagesDeployment(account, project, raw, true)
			if e != nil {
				return b, e
			}
			b.Current = &o
		}
		for page := 1; page <= 4; page++ {
			raw, e = c.deployments(ctx, provider, account, project, token, page)
			if e != nil {
				return b, e
			}
			root, e = decode(raw)
			if e != nil || root["success"] != true {
				return b, ErrPayload
			}
			items := list(root, "result")
			if items == nil {
				return b, ErrPayload
			}
			reached := false
			for _, item := range items {
				raw, _ := json.Marshal(item)
				o, e := PagesDeployment(account, project, raw, false)
				if e != nil {
					return b, e
				}
				if !since.IsZero() && o.OccurredAt.Before(since) {
					reached = true
				}
				b.Observations = append(b.Observations, o)
			}
			if len(items) < 50 || reached {
				break
			}
			if page == 4 {
				b.Complete = false
			}
		}
	case "cloudflare_workers":
		for page := 1; page <= 4; page++ {
			raw, e := c.deployments(ctx, provider, account, project, token, page)
			if e != nil {
				return b, e
			}
			root, e := decode(raw)
			if e != nil || root["success"] != true {
				return b, ErrPayload
			}
			items := list(obj(root, "result"), "deployments")
			if items == nil {
				return b, ErrPayload
			}
			reached := false
			for index, item := range items {
				raw, _ := json.Marshal(item)
				o, e := WorkerDeployment(account, project, raw)
				if e != nil {
					return b, e
				}
				if !since.IsZero() && o.OccurredAt.Before(since) {
					reached = true
				}
				if page == 1 && index == 0 {
					b.Current = &o
				} else {
					o.Production = "superseded"
					o.Evidence = append(o.Evidence, "Historical Worker deployment; a newer traffic configuration is active.")
					b.Observations = append(b.Observations, o)
				}
			}
			if len(items) < 50 || reached {
				break
			}
			if page == 4 {
				b.Complete = false
			}
		}
		// The provider retains a bounded deployment history; this cannot prove
		// absence of deployment activity during a gap beyond retained history.
		b.Health = "workers_history_bounded"
	case "vercel":
		raw, e := c.project(ctx, provider, account, project, token)
		if e != nil {
			return b, e
		}
		p, e := decode(raw)
		if e != nil || str(p, "id") != project || str(p, "accountId") != account {
			return b, &APIError{Code: "account_project_mismatch"}
		}
		// A project target/build list is not a promotion history. Only the signed
		// promoted event establishes traffic activation in this integration.
		b.Health = "promotion_history_requires_webhooks"
	default:
		return b, errors.New("unsupported provider polling")
	}
	if !b.Complete {
		b.Health = "history_gap_page_limit"
	}
	return b, nil
}

func (c Client) VercelChecks(ctx context.Context, account, deployment, token string) ([]Check, error) {
	raw, err := c.vercelChecks(ctx, account, deployment, token)
	if err != nil {
		return nil, err
	}
	m, err := decode(raw)
	if err != nil {
		return nil, err
	}
	items := list(m, "checks")
	if items == nil {
		return nil, ErrPayload
	}
	if len(items) > 100 {
		return nil, fmt.Errorf("check result limit exceeded")
	}
	out := []Check{}
	for _, item := range items {
		conclusion := str(item, "conclusion")
		if conclusion == "succeeded" {
			conclusion = "success"
		}
		if conclusion == "canceled" {
			conclusion = "cancelled"
		}
		if conclusion == "failed" {
			conclusion = "failure"
		}
		out = append(out, Check{Source: "vercel_check", ID: str(item, "id"), Name: str(item, "name"), AppID: str(item, "integrationId"), DeploymentID: deployment, Status: str(item, "status"), Conclusion: conclusion, OccurredAt: stamp(item, "updatedAt")})
	}
	return out, nil
}
