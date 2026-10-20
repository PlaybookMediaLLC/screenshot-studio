package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspacesettings"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Experiments (RFC 043) are declared here, and only here: the web renders this
// list and the backend enforces it where each feature is used. A browser can
// ask to opt in; it cannot invent an experiment or turn on one it is refused.

// Experiment is one feature in the registry.
type Experiment struct {
	Dependencies  []string `json:"dependencies"`
	Description   string   `json:"description"`
	Enforcement   string   `json:"enforcement"`
	Entitlement   string   `json:"entitlement"`
	ID            string   `json:"id"`
	MinAppVersion string   `json:"minAppVersion"`
	Name          string   `json:"name"`
	// Status is experimental, available, promoted or unavailable.
	Status       string `json:"status"`
	UserEditable bool   `json:"userEditable"`
}

// Experiment IDs the backend enforces.
const (
	ExperimentDraftPlanning = "draft-planning"
	ExperimentDraftTags     = "draft-tags"
)

var experimentRegistry = []Experiment{
	{ID: "realistic-previews", Name: "Realistic previews",
		Description: "See each channel's post as it will appear before you schedule it.",
		Status:      "promoted", Entitlement: contentDraftFeature, MinAppVersion: "2.24.0",
		Enforcement: "Part of the composer for every workspace with drafts; there is nothing to turn on."},
	{ID: "substack-notes", Name: "Substack Notes",
		Description: "Publish drafts as Substack Notes.",
		Status:      "unavailable",
		Enforcement: "Screenshot Studio has no Substack channel, so drafts cannot be sent there."},
	{ID: ExperimentDraftPlanning, Name: "Plan drafts on the calendar",
		Description: "Put a draft on a day of the calendar without scheduling it.",
		Status:      "experimental", Entitlement: contentDraftFeature, MinAppVersion: "2.25.0", UserEditable: true,
		Enforcement: "The backend refuses a planned date unless you opted in and your workspace allows it."},
	{ID: ExperimentDraftTags, Name: "Draft tags",
		Description: "Label drafts so you can find them again.",
		Status:      "experimental", Entitlement: contentDraftFeature, MinAppVersion: "2.25.0", UserEditable: true,
		Enforcement: "The backend refuses tag changes unless you opted in and your workspace allows it."},
}

// ExperimentState is an experiment as one person sees it in one workspace.
type ExperimentState struct {
	Experiment
	// DisabledByAdmin is true when an owner or admin turned it off here.
	DisabledByAdmin bool `json:"disabledByAdmin"`
	// Enabled is whether the feature works for this person now.
	Enabled bool `json:"enabled"`
	// Entitled is whether the workspace's plan includes what it needs.
	Entitled bool `json:"entitled"`
	OptedIn  bool `json:"optedIn"`
}

func findExperiment(id string) (Experiment, bool) {
	for _, experiment := range experimentRegistry {
		if experiment.ID == id {
			return experiment, true
		}
	}
	return Experiment{}, false
}

// workspaceDisabledExperiments lists the experiments an admin turned off.
func (c *Configuration) workspaceDisabledExperiments(ctx context.Context, organizationID string) (map[string]bool, error) {
	settings, err := c.client.WorkspaceSettings.Get(ctx, organizationID)
	if ent.IsNotFound(err) {
		return map[string]bool{}, nil
	}
	if err != nil {
		return nil, err
	}
	disabled := map[string]bool{}
	for _, id := range settings.DisabledExperiments {
		disabled[id] = true
	}
	return disabled, nil
}

// experimentStates evaluates every experiment for actor.
func (c *Configuration) experimentStates(ctx context.Context, actor Actor, optIns map[string]bool) ([]ExperimentState, error) {
	disabled, err := c.workspaceDisabledExperiments(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	row, err := c.client.WorkspaceEntitlement.Get(ctx, actor.OrganizationID)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	_, _, features := evaluateBootstrapEntitlement(row, time.Now().UTC())
	states := make([]ExperimentState, 0, len(experimentRegistry))
	for _, experiment := range experimentRegistry {
		state := ExperimentState{Experiment: experiment, DisabledByAdmin: disabled[experiment.ID],
			Entitled: experiment.Entitlement == "" || features[experiment.Entitlement], OptedIn: optIns[experiment.ID]}
		state.Dependencies = nonNilStrings(experiment.Dependencies)
		switch experiment.Status {
		case "promoted", "available":
			state.Enabled = state.Entitled && !state.DisabledByAdmin
		case "experimental":
			state.Enabled = state.Entitled && !state.DisabledByAdmin && state.OptedIn
		}
		states = append(states, state)
	}
	return states, nil
}

// ListExperiments lists every experiment as the signed-in person sees it.
func (c *Configuration) ListExperiments(ctx context.Context, actor Actor) ([]ExperimentState, error) {
	preferences, err := c.GetUserPreferences(ctx, actor)
	if err != nil {
		return nil, err
	}
	return c.experimentStates(ctx, actor, preferences.Experiments)
}

// checkExperimentChoice refuses an opt-in the registry does not allow.
func (c *Configuration) checkExperimentChoice(ctx context.Context, actor Actor, id string, on bool) error {
	experiment, ok := findExperiment(id)
	if !ok {
		return invalid("There is no experiment called " + id + ".")
	}
	if !experiment.UserEditable || (experiment.Status != "experimental" && experiment.Status != "available") {
		return invalid(experiment.Name + " cannot be turned on or off.")
	}
	if !on {
		return nil
	}
	states, err := c.experimentStates(ctx, actor, map[string]bool{id: true})
	if err != nil {
		return err
	}
	for _, state := range states {
		if state.ID != id {
			continue
		}
		if state.DisabledByAdmin {
			return forbidden("An admin turned " + experiment.Name + " off for this workspace.")
		}
		if !state.Entitled {
			return &FeatureNotEntitledError{Feature: experiment.Entitlement, RequiredPlan: minimumFeaturePlan[experiment.Entitlement]}
		}
	}
	return nil
}

// requireExperiment refuses a feature the actor has not opted in to, or that
// the workspace turned off. Only a signed-in person opts in, so a credential
// is refused.
func (c *Configuration) requireExperiment(ctx context.Context, actor Actor, id string) error {
	experiment, _ := findExperiment(id)
	if !actor.IsSession() {
		return forbidden(experiment.Name + " is an experiment for signed-in people; API keys cannot use it.")
	}
	preferences, err := c.client.UserPreference.Get(ctx, actor.UserID)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	optIns := map[string]bool{}
	if preferences != nil {
		optIns = preferences.Experiments
	}
	states, err := c.experimentStates(ctx, actor, optIns)
	if err != nil {
		return err
	}
	for _, state := range states {
		if state.ID == id && state.Enabled {
			return nil
		}
	}
	return forbidden("Turn on " + experiment.Name + " in Settings → Experimental first.")
}

// SetWorkspaceExperiment lets an owner or admin turn an experiment off, or
// back on, for the whole workspace.
func (c *Configuration) SetWorkspaceExperiment(ctx context.Context, actor Actor, id string, disabled bool) ([]ExperimentState, error) {
	if !actor.IsSession() {
		return nil, publishing.ErrForbidden
	}
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	experiment, ok := findExperiment(id)
	if !ok || !experiment.UserEditable {
		return nil, invalid("Only an experiment people can turn on can be turned off for the workspace.")
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.PlatformExec(ctx, `INSERT INTO workspace_settings ("organizationId","updatedAt") VALUES ($1, now()) ON CONFLICT ("organizationId") DO NOTHING`, actor.OrganizationID); err != nil {
		return nil, err
	}
	if _, err := tx.PlatformExec(ctx, `SELECT 1 FROM workspace_settings WHERE "organizationId"=$1 FOR UPDATE`, actor.OrganizationID); err != nil {
		return nil, err
	}
	settings, err := tx.WorkspaceSettings.Query().Where(workspacesettings.ID(actor.OrganizationID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	next := make([]string, 0, len(settings.DisabledExperiments)+1)
	for _, current := range settings.DisabledExperiments {
		if current != id {
			next = append(next, current)
		}
	}
	if disabled {
		next = append(next, id)
	}
	if _, err := tx.WorkspaceSettings.UpdateOneID(actor.OrganizationID).SetDisabledExperiments(next).Save(ctx); err != nil {
		return nil, err
	}
	action := "product.experiment_enabled"
	if disabled {
		action = "product.experiment_disabled"
	}
	if err := appendConfigurationAudit(ctx, tx, actor, action, "experiment", id, map[string]any{"scope": "workspace"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return c.ListExperiments(ctx, actor)
}

// auditNow records an audit entry in a transaction of its own.
func (c *Configuration) auditNow(ctx context.Context, actor Actor, action, entityType, entityID string, metadata map[string]any) error {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := appendConfigurationAudit(ctx, tx, actor, action, entityType, entityID, metadata); err != nil {
		return err
	}
	return tx.Commit()
}
