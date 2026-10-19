package product

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	releaseautomation "github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releaseautomation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releaseautomationnode"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releaseautomationrun"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releaseautomationversion"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releasesourceevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourceapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

type AutomationDispatcher interface {
	Start(context.Context, string, string, int) (string, error)
	Cancel(context.Context, string, int) error
}

func (c *Configuration) WithAutomationDispatcher(dispatcher AutomationDispatcher) *Configuration {
	c.automation = dispatcher
	return c
}

var ErrAutomationStopped = errors.New("release automation authorization withdrawn")

type AutomationRun struct {
	ID              string             `json:"id"`
	EventID         string             `json:"eventId"`
	DefinitionID    *string            `json:"definitionId"`
	VersionID       *string            `json:"versionId"`
	WorkflowID      string             `json:"workflowId"`
	TemporalRunID   string             `json:"temporalRunId"`
	Status          string             `json:"status"`
	CancelRequested bool               `json:"cancelRequested"`
	RecoveryAttempt int                `json:"recoveryAttempt"`
	FailureCode     string             `json:"failureCode"`
	Reason          string             `json:"reason"`
	Outputs         automation.Outputs `json:"outputs"`
	CreatedAt       time.Time          `json:"createdAt"`
	CompletedAt     *time.Time         `json:"completedAt"`
}

type AutomationEvent struct {
	ID          string                      `json:"id"`
	SourceAppID string                      `json:"sourceAppId"`
	DeliveryID  string                      `json:"deliveryId"`
	Snapshot    automation.Event            `json:"snapshot"`
	VersionIDs  []string                    `json:"versionIds"`
	Mode        string                      `json:"mode"`
	Disposition string                      `json:"disposition"`
	Reason      string                      `json:"reason"`
	ReceivedAt  time.Time                   `json:"receivedAt"`
	EnrichedAt  *time.Time                  `json:"enrichedAt"`
	Enrichment  map[string]automation.Value `json:"enrichment"`
}

type AutomationNodeExecution struct {
	NodeID      string              `json:"nodeId"`
	ActionKey   string              `json:"actionKey"`
	Status      string              `json:"status"`
	Attempts    int                 `json:"attempts"`
	FailureCode string              `json:"failureCode"`
	Decision    automation.Decision `json:"decision"`
	Outputs     automation.Outputs  `json:"outputs"`
	StartedAt   time.Time           `json:"startedAt"`
	CompletedAt *time.Time          `json:"completedAt"`
}

type AutomationHistoryItem struct {
	Event AutomationEvent `json:"event"`
	Run   AutomationRun   `json:"run"`
}
type AutomationRunDetail struct {
	AutomationHistoryItem
	Nodes []AutomationNodeExecution `json:"nodes"`
}

func automationRun(row *ent.ReleaseAutomationRun) AutomationRun {
	return AutomationRun{ID: row.ID, EventID: row.EventID, DefinitionID: row.DefinitionID, VersionID: row.VersionID, WorkflowID: row.WorkflowID, TemporalRunID: row.TemporalRunID, Status: row.Status, CancelRequested: row.CancelRequested, RecoveryAttempt: row.RecoveryAttempt, FailureCode: row.FailureCode, Reason: row.Reason, Outputs: row.Outputs, CreatedAt: row.CreatedAt, CompletedAt: row.CompletedAt}
}
func automationEvent(row *ent.ReleaseSourceEvent) AutomationEvent {
	return AutomationEvent{ID: row.ID, SourceAppID: row.SourceAppID, DeliveryID: row.DeliveryID, Snapshot: row.Snapshot, VersionIDs: row.VersionIds, Mode: row.Mode, Disposition: row.Disposition, Reason: row.Reason, ReceivedAt: row.ReceivedAt, EnrichedAt: row.EnrichedAt, Enrichment: row.Enrichment}
}

func (c *Configuration) ListAutomationHistory(ctx context.Context, actor Actor, before string) ([]AutomationHistoryItem, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	if len(before) > 64 {
		return nil, ErrInvalidInput
	}
	query := c.client.ReleaseAutomationRun.Query().Where(releaseautomationrun.OrganizationID(actor.OrganizationID))
	if before != "" {
		query.Where(releaseautomationrun.IDLT(before))
	}
	runs, err := query.Order(ent.Desc(releaseautomationrun.FieldID)).Limit(50).All(ctx)
	if err != nil {
		return nil, err
	}
	result := []AutomationHistoryItem{}
	for _, run := range runs {
		event, err := c.client.ReleaseSourceEvent.Query().Where(releasesourceevent.ID(run.EventID), releasesourceevent.OrganizationID(actor.OrganizationID)).Only(ctx)
		if err != nil {
			return nil, err
		}
		result = append(result, AutomationHistoryItem{Event: automationEvent(event), Run: automationRun(run)})
	}
	return result, nil
}

func (c *Configuration) GetAutomationRun(ctx context.Context, actor Actor, id string) (*AutomationRunDetail, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	run, event, err := c.automationRunEvent(ctx, actor.OrganizationID, id)
	if err != nil {
		return nil, err
	}
	nodes, err := c.client.ReleaseAutomationNode.Query().Where(releaseautomationnode.OrganizationID(actor.OrganizationID), releaseautomationnode.RunID(id)).Order(ent.Asc(releaseautomationnode.FieldStartedAt), ent.Asc(releaseautomationnode.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	result := &AutomationRunDetail{AutomationHistoryItem: AutomationHistoryItem{Event: automationEvent(event), Run: automationRun(run)}, Nodes: []AutomationNodeExecution{}}
	for _, node := range nodes {
		result.Nodes = append(result.Nodes, AutomationNodeExecution{NodeID: node.NodeID, ActionKey: node.ActionKey, Status: node.Status, Attempts: node.Attempts, FailureCode: node.FailureCode, Decision: node.Decision, Outputs: node.Outputs, StartedAt: node.StartedAt, CompletedAt: node.CompletedAt})
	}
	return result, nil
}

func (c *Configuration) automationRunEvent(ctx context.Context, org, id string) (*ent.ReleaseAutomationRun, *ent.ReleaseSourceEvent, error) {
	run, err := c.client.ReleaseAutomationRun.Query().Where(releaseautomationrun.ID(id), releaseautomationrun.OrganizationID(org)).Only(ctx)
	if err != nil {
		return nil, nil, err
	}
	event, err := c.client.ReleaseSourceEvent.Query().Where(releasesourceevent.ID(run.EventID), releasesourceevent.OrganizationID(org)).Only(ctx)
	return run, event, err
}

// A delayed activity from an earlier recovery must not resume a newer attempt.
func (c *Configuration) automationAttempt(ctx context.Context, org, id string, attempt int) (*ent.ReleaseAutomationRun, *ent.ReleaseSourceEvent, error) {
	run, event, err := c.automationRunEvent(ctx, org, id)
	if err != nil {
		return nil, nil, err
	}
	if run.RecoveryAttempt != attempt || !slices.Contains([]string{"queued", "running"}, run.Status) {
		return nil, nil, ErrAutomationStopped
	}
	return run, event, nil
}

func (c *Configuration) DisableReleaseAutomation(ctx context.Context, actor Actor, id string, revision int) error {
	if err := c.authorizeAutomationAdmin(ctx, actor); err != nil {
		return err
	}
	definition, err := c.client.ReleaseAutomation.Query().Where(releaseautomation.ID(id), releaseautomation.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := lockAutomationSource(ctx, tx, actor.OrganizationID, definition.SourceAppID); err != nil {
		return err
	}
	n, err := tx.ReleaseAutomation.Update().Where(releaseautomation.ID(id), releaseautomation.OrganizationID(actor.OrganizationID), releaseautomation.Revision(revision)).SetEnabled(false).AddRevision(1).SetModifiedBy(actor.UserID).Save(ctx)
	if err != nil {
		return err
	}
	if n != 1 {
		return publishing.ErrConflict
	}
	versions, err := tx.ReleaseAutomationVersion.Query().Where(releaseautomationversion.OrganizationID(actor.OrganizationID), releaseautomationversion.DefinitionID(id)).IDs(ctx)
	if err != nil {
		return err
	}
	if err := cancelAutomationRuns(ctx, tx, actor.OrganizationID, definition.SourceAppID, versions); err != nil {
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.release_automation_disabled", "release_automation", id); err != nil {
		return err
	}
	return tx.Commit()
}

// SetReleaseAutomationMode is the only way to leave sticky automation mode.
// Returning to legacy intake is explicit and cancels previously admitted work.
func (c *Configuration) SetReleaseAutomationMode(ctx context.Context, actor Actor, sourceID string, enabled bool, collectUnmatched *bool) error {
	if err := c.authorizeAutomationAdmin(ctx, actor); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	source, err := lockAutomationSource(ctx, tx, actor.OrganizationID, sourceID)
	if err != nil {
		return err
	}
	if err := automationSourceAccess(ctx, tx.Client(), source); err != nil {
		return err
	}
	update := tx.SourceApp.UpdateOneID(sourceID).SetReleaseAutomation(enabled)
	if collectUnmatched != nil {
		update.SetAutomationCollectUnmatched(*collectUnmatched)
	}
	if err := update.Exec(ctx); err != nil {
		return err
	}
	if source.ReleaseAutomation != enabled {
		if err := cancelAutomationRuns(ctx, tx, actor.OrganizationID, sourceID, nil); err != nil {
			return err
		}
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.release_automation_mode_changed", "source_app", sourceID, map[string]any{"enabled": enabled}); err != nil {
		return err
	}
	return tx.Commit()
}

func cancelAutomationRuns(ctx context.Context, tx *ent.Tx, org, sourceID string, versions []string) error {
	runs, err := tx.ReleaseAutomationRun.Query().Where(releaseautomationrun.OrganizationID(org), releaseautomationrun.CancelRequested(false), releaseautomationrun.StatusIn("queued", "running", "failed", "needs_attention")).All(ctx)
	if err != nil {
		return err
	}
	for _, run := range runs {
		event, err := tx.ReleaseSourceEvent.Query().Where(releasesourceevent.ID(run.EventID), releasesourceevent.OrganizationID(org), releasesourceevent.SourceAppID(sourceID)).Only(ctx)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return err
		}
		matches := versions == nil
		if run.VersionID != nil {
			matches = matches || slices.Contains(versions, *run.VersionID)
		} else {
			for _, id := range event.VersionIds {
				matches = matches || slices.Contains(versions, id)
			}
		}
		if matches {
			if err := requestAutomationCancel(ctx, tx, run); err != nil {
				return err
			}
		}
	}
	return nil
}

// StopWatchingAutomationSource revokes only this workspace's source selection.
func (c *Configuration) StopWatchingAutomationSource(ctx context.Context, actor Actor, id string) error {
	if err := c.authorizeAutomationAdmin(ctx, actor); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	source, err := lockAutomationSource(ctx, tx, actor.OrganizationID, id)
	if err != nil {
		return err
	}
	if source.Provider != "github" || source.GithubInstallationID == nil {
		return ErrInvalidInput
	}
	if err := tx.SourceApp.UpdateOneID(id).SetStatus(sourceapp.StatusARCHIVED).Exec(ctx); err != nil {
		return err
	}
	if err := cancelAutomationRuns(ctx, tx, actor.OrganizationID, id, nil); err != nil {
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.source_app_unwatched", "source_app", id); err != nil {
		return err
	}
	return tx.Commit()
}

func requestAutomationCancel(ctx context.Context, tx *ent.Tx, run *ent.ReleaseAutomationRun) error {
	if run.CancelRequested {
		return nil
	}
	if err := tx.ReleaseAutomationRun.UpdateOneID(run.ID).SetCancelRequested(true).SetReason("Cancellation requested; completed outputs are kept and an action may already be in flight.").Exec(ctx); err != nil {
		return err
	}
	return automationOutbox(ctx, tx, run.OrganizationID, run.ID, EventReleaseAutomationCancel, run.RecoveryAttempt)
}

func (c *Configuration) CancelReleaseAutomationRun(ctx context.Context, actor Actor, id string) error {
	if err := c.authorizeAutomationAdmin(ctx, actor); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	run, err := tx.ReleaseAutomationRun.Query().Where(releaseautomationrun.ID(id), releaseautomationrun.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil {
		return err
	}
	if !slices.Contains([]string{"queued", "running", "failed", "needs_attention"}, run.Status) {
		return publishing.ErrConflict
	}
	if err := requestAutomationCancel(ctx, tx, run); err != nil {
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.release_automation_cancel_requested", "release_automation_run", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (c *Configuration) RetryReleaseAutomationRun(ctx context.Context, actor Actor, id string) error {
	if err := c.authorizeAutomationAdmin(ctx, actor); err != nil {
		return err
	}
	run, event, err := c.automationRunEvent(ctx, actor.OrganizationID, id)
	if err != nil {
		return err
	}
	if run.Status != "failed" || run.FailureCode != "activity_failed" || run.CancelRequested {
		return publishing.ErrConflict
	}
	if _, err := c.automationCheckpoint(ctx, run, event); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	n, err := tx.ReleaseAutomationRun.Update().Where(releaseautomationrun.ID(id), releaseautomationrun.OrganizationID(actor.OrganizationID), releaseautomationrun.Status("failed"), releaseautomationrun.CancelRequested(false), releaseautomationrun.RecoveryAttempt(run.RecoveryAttempt)).SetStatus("queued").ClearCompletedAt().SetFailureCode("").AddRecoveryAttempt(1).Save(ctx)
	if err != nil {
		return err
	}
	if n != 1 {
		return publishing.ErrConflict
	}
	if err := automationOutbox(ctx, tx, actor.OrganizationID, id, EventReleaseAutomationDispatch, run.RecoveryAttempt+1); err != nil {
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.release_automation_retry_requested", "release_automation_run", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (c *Configuration) automationCheckpoint(ctx context.Context, run *ent.ReleaseAutomationRun, event *ent.ReleaseSourceEvent) (*ent.SourceApp, error) {
	if run.CancelRequested {
		return nil, ErrAutomationStopped
	}
	if err := c.auth.AuthorizeWorkspace(ctx, run.OrganizationID); err != nil {
		if errors.Is(err, publishing.ErrForbidden) || errors.Is(err, publishing.ErrUnauthorized) || errors.Is(err, publishing.ErrNotFound) {
			return nil, ErrAutomationStopped
		}
		return nil, err
	}
	source, err := c.client.SourceApp.Query().Where(sourceapp.ID(event.SourceAppID), sourceapp.OrganizationID(run.OrganizationID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	if source.ReleaseAutomation != (event.Mode == "automation") {
		return nil, ErrAutomationStopped
	}
	if err := automationSourceAccess(ctx, c.client, source); err != nil {
		if errors.Is(err, publishing.ErrForbidden) || errors.Is(err, publishing.ErrInvalidState) {
			return nil, ErrAutomationStopped
		}
		return nil, err
	}
	if run.DefinitionID != nil {
		allowed, err := c.client.ReleaseAutomation.Query().Where(releaseautomation.ID(*run.DefinitionID), releaseautomation.OrganizationID(run.OrganizationID), releaseautomation.Enabled(true)).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, ErrAutomationStopped
		}
	}
	return source, nil
}

func (c *Configuration) dispatchReleaseAutomation(ctx context.Context, org, id string, cancel bool) error {
	run, event, err := c.automationRunEvent(ctx, org, id)
	if err != nil {
		return err
	}
	if c.automation == nil {
		return ErrStorageUnavailable
	}
	if cancel {
		if err := c.automation.Cancel(ctx, run.WorkflowID, run.RecoveryAttempt); err != nil {
			return err
		}
		// A not-yet-started workflow has no activity that could finish this row.
		if run.Status != "running" {
			return c.FinishReleaseAutomation(ctx, org, id, "cancelled", "cancelled", "Cancelled before further work; completed outputs are retained.", run.RecoveryAttempt)
		}
		return nil
	}
	if run.Status != "queued" && run.Status != "running" {
		return nil
	}
	if _, err := c.automationCheckpoint(ctx, run, event); err != nil {
		if errors.Is(err, ErrAutomationStopped) {
			return c.FinishReleaseAutomation(ctx, org, id, "cancelled", "access_revoked", "Automation is disabled or access was revoked.", run.RecoveryAttempt)
		}
		return err
	}
	temporalID, err := c.automation.Start(ctx, org, id, run.RecoveryAttempt)
	if err != nil {
		slog.WarnContext(ctx, "release_automation_dispatch", "organization_id", org, "run_id", id, "status", "start_failed", "recovery_attempt", run.RecoveryAttempt)
		return err
	}
	slog.InfoContext(ctx, "release_automation_dispatch", "organization_id", org, "run_id", id, "temporal_run_id", temporalID, "dispatch_lag_ms", time.Since(event.ReceivedAt).Milliseconds(), "recovery_attempt", run.RecoveryAttempt)
	return c.client.ReleaseAutomationRun.UpdateOneID(id).SetTemporalRunID(temporalID).Exec(ctx)
}

func (c *Configuration) FinishReleaseAutomation(ctx context.Context, org, id, status, code, reason string, attempt int) error {
	if !slices.Contains([]string{"succeeded", "skipped", "failed", "cancelled", "needs_attention"}, status) || len(code) > 80 || len(reason) > 1000 {
		return ErrInvalidInput
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	run, err := tx.ReleaseAutomationRun.Query().Where(releaseautomationrun.ID(id), releaseautomationrun.OrganizationID(org)).Only(ctx)
	if err != nil {
		return err
	}
	// Serialize finish/retry so a late finish cannot overwrite a recovery.
	from := []string{"queued", "running"}
	if status == "cancelled" {
		from = append(from, "failed", "needs_attention")
	}
	n, err := tx.ReleaseAutomationRun.Update().Where(releaseautomationrun.ID(id), releaseautomationrun.OrganizationID(org), releaseautomationrun.RecoveryAttempt(attempt), releaseautomationrun.StatusIn(from...)).SetStatus(status).Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	if run.CancelRequested && status != "succeeded" {
		status = "cancelled"
	}
	if run.VersionID != nil && strings.HasPrefix(run.Reason, "First matching definition") {
		reason = run.Reason + " " + reason
	}
	if err := tx.ReleaseAutomationRun.UpdateOneID(id).SetStatus(status).SetFailureCode(code).SetReason(reason).SetCompletedAt(time.Now()).Exec(ctx); err != nil {
		return err
	}
	if err := tx.ReleaseSourceEvent.UpdateOneID(run.EventID).SetDisposition(status).SetReason(reason).Exec(ctx); err != nil {
		return err
	}
	if err := appendConfigurationAudit(ctx, tx, Actor{OrganizationID: org, Kind: "service", Display: "release-automation", RequestID: id}, "product.release_automation_finished", "release_automation_run", id, map[string]any{"status": status, "failureCode": code}); err != nil {
		return err
	}
	return tx.Commit()
}
