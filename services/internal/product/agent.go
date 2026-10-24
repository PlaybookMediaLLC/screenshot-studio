package product

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/launchrun"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/launchrunstep"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspacesettings"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Agent runs (docs/rfcs/016-ai-sdk-marketing-tools.md) extend launch_run: a
// run of an agent kind may start without a campaign, honors the workspace's
// AI kill switch, and records a step-by-step trace.

// agentRunKinds may start without a campaign and end CANCELLED or
// BUDGET_EXHAUSTED. "conversation" is one turn of an RFC 017 conversation.
var agentRunKinds = []string{"agent", "conversation"}

var (
	errAIAgentDisabled = forbidden("AI is turned off for this workspace.")
	launchToolName     = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)
	launchErrorCode    = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)
	// Keys whose values never reach a trace, whatever a tool declared.
	launchSecretKey = regexp.MustCompile(`(?i)^(authorization|cookie|set-cookie|password|secret|client_?secret|api_?key|x-api-key|access_?token|refresh_?token|token|signed_?url|signature)$`)
)

const launchStepSummaryMax = 16 << 10

// AIAgentEnabled reports the workspace's AI kill switch. A workspace without
// a settings row has the default: on.
func (c *Configuration) AIAgentEnabled(ctx context.Context, organizationID string) (bool, error) {
	if err := c.requireWorkspaceFeature(ctx, organizationID, "workspace:paid"); err != nil {
		var gate *FeatureNotEntitledError
		if errors.As(err, &gate) {
			return false, nil
		}
		return false, err
	}
	settings, err := c.client.WorkspaceSettings.Query().Where(workspacesettings.ID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return settings.AiAgentEnabled, nil
}

// RequireAIAgent answers 403 when the workspace turned AI off.
func (c *Configuration) RequireAIAgent(ctx context.Context, actor Actor) error {
	enabled, err := c.AIAgentEnabled(ctx, actor.OrganizationID)
	if err != nil {
		return err
	}
	if !enabled {
		return errAIAgentDisabled
	}
	return nil
}

// StartAgentRunInput starts an agent or conversation run, optionally about an
// existing campaign.
type StartAgentRunInput struct {
	CampaignID *string `json:"campaignId"`
	Kind       string  `json:"kind"`
}

// StartAgentRun records an agent run. Any member may start a conversation
// run; an agent run needs a role that can create releases. Both need the
// workspace's AI switch on. With a campaign, one run of the kind per campaign
// at a time; without one, no slot is held.
func (c *Configuration) StartAgentRun(ctx context.Context, actor Actor, input StartAgentRunInput) (*LaunchRunRecord, error) {
	var err error
	if input.Kind == "conversation" {
		err = c.AuthorizeRead(ctx, actor)
	} else {
		err = c.authorizeRoles(ctx, actor, launchEditRoles...)
	}
	if err != nil {
		return nil, err
	}
	if !slices.Contains(agentRunKinds, input.Kind) {
		return nil, ErrInvalidInput
	}
	if err := c.RequireAIAgent(ctx, actor); err != nil {
		return nil, err
	}
	return c.startLaunchRun(ctx, actor, input.CampaignID, input.Kind)
}

// authorizeLaunchRun lets an owner, admin, or creator act on any run of the
// workspace, and any other member on a conversation run they started. It
// reports whether the caller acts only as that run's starter.
func (c *Configuration) authorizeLaunchRun(ctx context.Context, actor Actor, runID string) (bool, error) {
	err := c.authorizeRoles(ctx, actor, launchEditRoles...)
	if !errors.Is(err, publishing.ErrForbidden) || !actor.IsSession() {
		return false, err
	}
	if readErr := c.AuthorizeRead(ctx, actor); readErr != nil {
		return false, readErr
	}
	own, queryErr := c.client.LaunchRun.Query().Where(launchrun.ID(runID), launchrun.OrganizationID(actor.OrganizationID),
		launchrun.Kind("conversation"), launchrun.CreatedByUserID(actor.UserID)).Exist(ctx)
	if queryErr != nil {
		return false, queryErr
	}
	if !own {
		return false, err
	}
	return true, nil
}

// LaunchRunStepInput is one step a worker appends. Index is the worker's
// step number, so a resumed worker re-sending a step gets a conflict instead
// of a duplicate.
type LaunchRunStepInput struct {
	DurationMs    int             `json:"durationMs"`
	Effect        *string         `json:"effect"`
	ErrorCode     *string         `json:"errorCode"`
	Index         int             `json:"index"`
	InputSummary  json.RawMessage `json:"inputSummary"`
	Kind          string          `json:"kind"`
	OutputSummary json.RawMessage `json:"outputSummary"`
	Status        string          `json:"status"`
	TokensIn      int             `json:"tokensIn"`
	TokensOut     int             `json:"tokensOut"`
	ToolName      *string         `json:"toolName"`
}

// LaunchRunStepRecord is one persisted step of a run's trace.
type LaunchRunStepRecord struct {
	CreatedAt     time.Time       `json:"createdAt"`
	DurationMs    int             `json:"durationMs"`
	Effect        *string         `json:"effect"`
	ErrorCode     *string         `json:"errorCode"`
	ID            string          `json:"id"`
	Index         int             `json:"index"`
	InputSummary  json.RawMessage `json:"inputSummary"`
	Kind          string          `json:"kind"`
	OutputSummary json.RawMessage `json:"outputSummary"`
	RunID         string          `json:"runId"`
	Status        string          `json:"status"`
	TokensIn      int             `json:"tokensIn"`
	TokensOut     int             `json:"tokensOut"`
	ToolName      *string         `json:"toolName"`
}

func launchRunStepRecord(row *ent.LaunchRunStep) LaunchRunStepRecord {
	var effect *string
	if row.Effect != nil {
		value := string(*row.Effect)
		effect = &value
	}
	return LaunchRunStepRecord{CreatedAt: row.CreatedAt, DurationMs: row.DurationMs, Effect: effect, ErrorCode: row.ErrorCode,
		ID: row.ID, Index: row.Index, InputSummary: nullJSON(row.InputSummary), Kind: string(row.Kind),
		OutputSummary: nullJSON(row.OutputSummary), RunID: row.RunID, Status: string(row.Status),
		TokensIn: row.TokensIn, TokensOut: row.TokensOut, ToolName: row.ToolName}
}

func nullJSON(value json.RawMessage) json.RawMessage {
	if len(value) == 0 {
		return json.RawMessage("null")
	}
	return value
}

// AppendLaunchRunStep records one step of a run of this workspace. The
// caller needs the same rights as finishing or heartbeating the run.
func (c *Configuration) AppendLaunchRunStep(ctx context.Context, actor Actor, runID string, input LaunchRunStepInput) (*LaunchRunStepRecord, error) {
	if _, err := c.authorizeLaunchRun(ctx, actor, runID); err != nil {
		return nil, err
	}
	kind, status := launchrunstep.Kind(input.Kind), launchrunstep.Status(input.Status)
	if launchrunstep.KindValidator(kind) != nil || launchrunstep.StatusValidator(status) != nil ||
		input.Index < 0 || input.Index > 10_000 || input.DurationMs < 0 || input.TokensIn < 0 || input.TokensOut < 0 ||
		(kind == launchrunstep.KindTool) != (input.ToolName != nil) ||
		(input.ToolName != nil && !launchToolName.MatchString(*input.ToolName)) ||
		(input.Effect != nil && (kind != launchrunstep.KindTool || launchrunstep.EffectValidator(launchrunstep.Effect(*input.Effect)) != nil)) ||
		(input.ErrorCode != nil && !launchErrorCode.MatchString(*input.ErrorCode)) {
		return nil, ErrInvalidInput
	}
	inputSummary, ok := redactLaunchSummary(input.InputSummary)
	if !ok {
		return nil, ErrInvalidInput
	}
	outputSummary, ok := redactLaunchSummary(input.OutputSummary)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := c.launchRunExists(ctx, actor, runID); err != nil {
		return nil, err
	}
	create := c.client.LaunchRunStep.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetRunID(runID).
		SetIndex(input.Index).SetKind(kind).SetNillableToolName(input.ToolName).SetStatus(status).
		SetNillableErrorCode(input.ErrorCode).SetTokensIn(input.TokensIn).SetTokensOut(input.TokensOut).
		SetDurationMs(input.DurationMs).SetCreatedAt(time.Now().UTC())
	if input.Effect != nil {
		create.SetEffect(launchrunstep.Effect(*input.Effect))
	}
	if inputSummary != nil {
		create.SetInputSummary(inputSummary)
	}
	if outputSummary != nil {
		create.SetOutputSummary(outputSummary)
	}
	row, err := create.Save(ctx)
	if ent.IsConstraintError(err) {
		return nil, conflict("This step was already recorded.")
	}
	if err != nil {
		return nil, err
	}
	result := launchRunStepRecord(row)
	return &result, nil
}

// ListLaunchRunSteps returns a run's trace in step order, up to 500 steps.
func (c *Configuration) ListLaunchRunSteps(ctx context.Context, actor Actor, runID string) ([]LaunchRunStepRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	if err := c.launchRunExists(ctx, actor, runID); err != nil {
		return nil, err
	}
	rows, err := c.client.LaunchRunStep.Query().Where(launchrunstep.OrganizationID(actor.OrganizationID), launchrunstep.RunID(runID)).
		Order(ent.Asc(launchrunstep.FieldIndex)).Limit(500).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]LaunchRunStepRecord, 0, len(rows))
	for _, row := range rows {
		items = append(items, launchRunStepRecord(row))
	}
	return items, nil
}

// redactLaunchSummary checks a step summary is JSON within the size cap and
// replaces the value of every credential-like key. Absent or null is nil.
func redactLaunchSummary(raw json.RawMessage) (json.RawMessage, bool) {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "null" {
		return nil, true
	}
	if len(raw) > launchStepSummaryMax {
		return nil, false
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, false
	}
	redacted, err := json.Marshal(redactLaunchValue(value))
	return redacted, err == nil
}

func redactLaunchValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			if launchSecretKey.MatchString(key) {
				typed[key] = "[redacted]"
			} else {
				typed[key] = redactLaunchValue(item)
			}
		}
	case []any:
		for i, item := range typed {
			typed[i] = redactLaunchValue(item)
		}
	}
	return value
}
