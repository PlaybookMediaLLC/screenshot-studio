package product

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/frontendactivation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/frontendsource"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourceapp"
	fd "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/frontenddeploy"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
)

// WithFrontendHTTP supplies an isolated transport in integration tests.
func (c *Configuration) WithFrontendHTTP(h *http.Client) *Configuration { c.frontendHTTP = h; return c }

type frontendGitHubReader interface {
	DeploymentChecks(context.Context, int64, string, string) ([]fd.Check, error)
	DeploymentDeliveries(context.Context, int64, string, time.Time) ([]fd.GitHubRecoveredDelivery, bool, error)
}

// PollFrontends is run by the existing serialized Temporal maintenance runner.
// Network reads happen outside acceptance transactions. Each observation commits
// independently, then the checkpoint advances; a crash safely repeats the overlap.
func (c *Configuration) PollFrontends(ctx context.Context) (int, error) {
	started := time.Now().UTC()
	var cursorTime time.Time
	cursorID := ""
	count := 0
	for count < 20 {
		// Page past ineligible sources without consuming the provider budget.
		// The fixed cutoff excludes sources updated by this invocation; the ID
		// tie-breaker keeps equal timestamps from hiding rows across pages.
		query := c.client.FrontendSource.Query().Where(frontendsource.Enabled(true), frontendsource.UpdatedAtLTE(started))
		if cursorID != "" {
			query.Where(frontendsource.Or(frontendsource.UpdatedAtGT(cursorTime), frontendsource.And(frontendsource.UpdatedAtEQ(cursorTime), frontendsource.IDGT(cursorID))))
		}
		rows, err := query.Order(ent.Asc(frontendsource.FieldUpdatedAt), ent.Asc(frontendsource.FieldID)).Limit(100).All(ctx)
		if err != nil {
			return count, err
		}
		if len(rows) == 0 {
			break
		}
		last := rows[len(rows)-1]
		cursorTime, cursorID = last.UpdatedAt, last.ID
		for _, s := range rows {
			if count >= 20 {
				break
			}
			if until, e := time.Parse(time.RFC3339Nano, s.Checkpoint["retryAfter"]); e == nil && time.Now().Before(until) {
				continue
			}
			if err := c.authorizeRoles(ctx, Actor{OrganizationID: s.OrganizationID, Kind: "service"}); err != nil {
				continue
			}
			err := c.pollFrontend(ctx, s)
			if ctx.Err() != nil {
				return count, ctx.Err()
			}
			if err != nil {
				health := "provider_unavailable"
				delay := time.Minute
				var api *fd.APIError
				if errors.As(err, &api) {
					health = api.Code
					if api.RetryAfter > delay {
						delay = api.RetryAfter
					}
				}
				checkpoint := s.Checkpoint
				checkpoint["retryAfter"] = time.Now().Add(min(delay, 24*time.Hour)).Format(time.RFC3339Nano)
				if e := c.saveFrontendPollState(ctx, s, health, checkpoint, time.Now(), false); e != nil {
					return count, e
				}
			}
			count++
		}
		if len(rows) < 100 {
			break
		}
	}
	return count, nil
}

func (c *Configuration) pollFrontend(ctx context.Context, s *ent.FrontendSource) error {
	started := time.Now().UTC()
	since := s.BaselineAt
	if s.LastPollAt != nil {
		since = s.LastPollAt.Add(-10 * time.Minute)
	}
	if s.Provider == "github" {
		return c.recoverFrontendGitHub(ctx, s, since, started)
	}
	token, err := webhooks.Open(c.webhookKey, s.EncryptedToken)
	if err != nil {
		return &fd.APIError{Code: "credential_unavailable"}
	}
	client := fd.Client{HTTP: c.frontendHTTP}
	batch, err := client.Poll(ctx, s.Provider, s.AccountID, s.ProjectID, token, since)
	if err != nil {
		return err
	}
	baseline := s.LastPollAt == nil
	// Netlify gives a provider-authenticated commit URL, not a GitHub repository
	// ID. Resolve its repository through the already-authorized installation.
	if batch.Current != nil && batch.Current.RepositoryName != "" && s.GithubSourceID != "" {
		src, e := c.client.SourceApp.Query().Where(sourceapp.ID(s.GithubSourceID), sourceapp.OrganizationID(s.OrganizationID)).Only(ctx)
		if e != nil {
			return e
		}
		if e := automationSourceAccess(ctx, c.client, src); e != nil {
			return e
		}
		install, e := c.client.GitHubInstallation.Get(ctx, *src.GithubInstallationID)
		if e != nil {
			return e
		}
		if reader, ok := c.github.(GitHubReader); ok {
			repo, e := reader.Repository(ctx, install.InstallationID, *src.ExternalID)
			if e != nil {
				return e
			}
			if strings.EqualFold(repo.FullName, batch.Current.RepositoryName) && strconv.FormatInt(repo.ID, 10) == *src.ExternalID {
				batch.Current.RepositoryID = *src.ExternalID
			}
		}
	}
	for _, o := range batch.Observations {
		if err := c.acceptFrontendObservation(ctx, s.OrganizationID, s.ID, o, baseline); err != nil {
			return err
		}
	}
	checkpoint := s.Checkpoint
	if o := batch.Current; o != nil {
		// Pages has no promotion occurrence ID; retain a plainly local transition
		// identity. A restart before checkpoint commit computes the same identity.
		identity := o.DeploymentID + ":" + o.ActivationKey
		generation, _ := strconv.Atoi(checkpoint["generation"])
		if checkpoint["current"] != identity {
			generation++
		}
		if o.ActivationID == "" {
			o.ActivationKey = "observed-transition:" + strconv.Itoa(generation)
			o.Key = o.Key + ":" + o.ActivationKey
		}
		if checkpoint["current"] != "" && checkpoint["current"] != identity && !strings.HasPrefix(checkpoint["current"], o.DeploymentID+":") && (s.Provider == "netlify" || s.Provider == "cloudflare_pages") {
			previous, err := c.client.FrontendActivation.Query().Where(frontendactivation.OrganizationID(s.OrganizationID), frontendactivation.SourceID(s.ID), frontendactivation.ActivationKeyHasPrefix(o.Provider+":"+o.DeploymentID+":")).Limit(100).All(ctx)
			if err != nil {
				return err
			}
			for _, a := range previous {
				if a.Snapshot.Production == "active" {
					o.Rollback = true
					o.Evidence = append(o.Evidence, "Provider's production target returned to a previously observed active deployment; restoration observed.")
					break
				}
			}
		}
		if checkpoint["current"] != "" && checkpoint["current"] != identity {
			o.Evidence = append(o.Evidence, "Production target changed since the previous authenticated observation; an older object may have been restored.")
		}
		if s.Provider == "cloudflare_pages" && checkpoint["current"] != identity && !baseline {
			o.Evidence = append(o.Evidence, "Activation occurrence time is unavailable; this is an observed transition, not a fabricated provider timestamp.")
		}
		// A restored old object is a new observed activation even when its build
		// predates connection. Receipt time is explicit in the evidence and UI.
		if !baseline && checkpoint["current"] != identity && o.ActivationID == "" {
			o.Evidence = append(o.Evidence, "Provider timestamp describes the artifact; activation observation time is recorded separately.")
			o.ActivationObservedAt = &started
		}
		if err := c.acceptFrontendObservation(ctx, s.OrganizationID, s.ID, *o, baseline); err != nil {
			return err
		}
		checkpoint["current"] = identity
		checkpoint["generation"] = strconv.Itoa(generation)
	}
	if err := c.pollFrontendChecks(ctx, s, client, token); err != nil {
		return err
	}
	health := batch.Health
	if s.Health == "activation_history_gap_review_required" || s.LastPollAt != nil && started.Sub(*s.LastPollAt) > 30*time.Minute && (s.Provider == "cloudflare_pages" || s.Provider == "netlify") {
		health = "activation_history_gap_review_required"
		checkpoint["coverageGap"] = health
	}
	if checkpoint["coverageGap"] != "" {
		health = checkpoint["coverageGap"]
	}
	return c.saveFrontendPollState(ctx, s, health, checkpoint, started, batch.Complete)

}

func (c *Configuration) pollFrontendChecks(ctx context.Context, s *ent.FrontendSource, client fd.Client, token string) error {
	rows, err := c.client.FrontendActivation.Query().Where(frontendactivation.OrganizationID(s.OrganizationID), frontendactivation.SourceID(s.ID), frontendactivation.Historical(false)).Order(ent.Desc(frontendactivation.FieldCreatedAt)).Limit(20).All(ctx)
	if err != nil {
		return err
	}
	for _, a := range rows {
		if len(a.Policy.Checks) == 0 || a.Decision.State == "matched" || a.Snapshot.Production != "active" {
			continue
		}
		checks := []fd.Check{}
		wantVercel, wantGitHub := false, false
		for _, rule := range a.Policy.Checks {
			wantVercel = wantVercel || rule.Source == "vercel_check"
			wantGitHub = wantGitHub || rule.Source == "github_check" || rule.Source == "github_status"
		}
		if wantVercel && s.Provider == "vercel" {
			got, e := client.VercelChecks(ctx, s.AccountID, a.Snapshot.DeploymentID, token)
			if e != nil {
				return e
			}
			checks = append(checks, got...)
		}
		if wantGitHub && a.Snapshot.Revision != "" {
			src, e := c.client.SourceApp.Query().Where(sourceapp.ID(frontendGitHubSourceID(s)), sourceapp.OrganizationID(s.OrganizationID)).Only(ctx)
			if e != nil {
				return e
			}
			if src.GithubInstallationID != nil {
				if e := automationSourceAccess(ctx, c.client, src); e != nil {
					return e
				}
				install, e := c.client.GitHubInstallation.Get(ctx, *src.GithubInstallationID)
				if e != nil {
					return e
				}
				if reader, ok := c.github.(frontendGitHubReader); ok {
					got, e := reader.DeploymentChecks(ctx, install.InstallationID, *src.ExternalID, a.Snapshot.Revision)
					if e != nil {
						return e
					}
					checks = append(checks, got...)
				}
			}
		}
		if len(checks) == 0 {
			continue
		}
		raw, _ := json.Marshal(checks)
		o := fd.Observation{Provider: s.Provider, AccountID: s.AccountID, ProjectID: s.ProjectID, Kind: "checks.observed", Key: "checks:" + a.ID + ":" + fd.Fingerprint(raw), OccurredAt: time.Now().UTC(), Checks: checks, Evidence: []string{"Authenticated read-only check API; exact deployment/revision correlation required."}}
		if err := c.acceptFrontendObservation(ctx, s.OrganizationID, s.ID, o, false); err != nil {
			return err
		}
	}
	return nil
}

func (c *Configuration) recoverFrontendGitHub(ctx context.Context, s *ent.FrontendSource, since, started time.Time) error {
	src, err := c.client.SourceApp.Query().Where(sourceapp.ID(frontendGitHubSourceID(s)), sourceapp.OrganizationID(s.OrganizationID)).Only(ctx)
	if err != nil {
		return err
	}
	if err := automationSourceAccess(ctx, c.client, src); err != nil {
		return err
	}
	reader, ok := c.github.(frontendGitHubReader)
	if !ok {
		return c.saveFrontendPollState(ctx, s, "github_delivery_recovery_unavailable", s.Checkpoint, started, false)
	}
	installation, err := c.client.GitHubInstallation.Get(ctx, *src.GithubInstallationID)
	if err != nil {
		return err
	}
	deliveries, complete, err := reader.DeploymentDeliveries(ctx, installation.InstallationID, *src.ExternalID, since)
	if err != nil {
		return err
	}
	for _, d := range deliveries {
		o, err := fd.NormalizeGitHub(d.EventName, d.DeliveryID, d.Body)
		if err != nil {
			return err
		}
		if o.AccountID != s.AccountID || o.ProjectID != s.ProjectID {
			return fd.ErrPayload
		}
		if err := c.acceptFrontendObservation(ctx, s.OrganizationID, s.ID, o, s.LastPollAt == nil); err != nil {
			return err
		}
	}
	if err := c.pollFrontendChecks(ctx, s, fd.Client{}, ""); err != nil {
		return err
	}
	health := "ready"
	if !complete || started.Sub(since) > 72*time.Hour {
		health = "github_delivery_history_gap"
		s.Checkpoint["coverageGap"] = health
	}
	if s.Checkpoint["coverageGap"] != "" {
		health = s.Checkpoint["coverageGap"]
	}
	return c.saveFrontendPollState(ctx, s, health, s.Checkpoint, started, complete)
}

func (c *Configuration) saveFrontendPollState(ctx context.Context, prior *ent.FrontendSource, health string, checkpoint map[string]string, at time.Time, complete bool) error {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	n, err := tx.FrontendSource.Update().Where(frontendsource.ID(prior.ID), frontendsource.OrganizationID(prior.OrganizationID), frontendsource.Revision(prior.Revision)).SetUpdatedAt(at).Save(ctx)
	if err != nil || n == 0 {
		return err
	}
	s, err := tx.FrontendSource.Get(ctx, prior.ID)
	if err != nil {
		return err
	}
	checkpoint["latestActivationAt"] = s.Checkpoint["latestActivationAt"]
	if complete {
		delete(checkpoint, "retryAfter")
	}
	u := s.Update().SetHealth(health).SetCheckpoint(checkpoint)
	if complete {
		u.SetLastPollAt(at)
	}
	if err := u.Exec(ctx); err != nil {
		return err
	}
	if s.Enabled && s.Health != health && slices.Contains(s.Policy.Alerts, "needs_attention") && !slices.Contains([]string{"ready", "workers_history_bounded", "promotion_history_requires_webhooks"}, health) {
		key := health + ":" + at.Format(time.RFC3339Nano)
		if err := activity.Emit(ctx, tx, s.OrganizationID, "frontend.connection_attention", "frontend_source", s.ID, "", key, nil); err != nil {
			return err
		}
	}
	return tx.Commit()
}
