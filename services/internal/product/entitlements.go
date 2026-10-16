package product

import (
	"context"
	"fmt"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

type EntitlementSummary struct {
	Features map[string]bool `json:"features"`
	Plan     string          `json:"plan"`
	Status   string          `json:"status"`
}

type FeatureDecision struct {
	Allowed      bool   `json:"allowed"`
	CurrentPlan  string `json:"currentPlan"`
	RequiredPlan string `json:"requiredPlan"`
}

var minimumFeaturePlan = map[string]string{
	"asset:create": "pro", "asset:read": "pro", "asset:update": "pro", "asset:delete": "pro",
	"release:create": "pro", "source-app:create": "pro", "workspace:use": "pro", "enterprise:audit-drain": "enterprise",
	"enterprise:sso": "enterprise", "enterprise:scim": "enterprise", "campaign:workflow": "enterprise",
}

// FeatureNotEntitledError reports a plan gate with the decision the web shows.
type FeatureNotEntitledError struct {
	Feature, CurrentPlan, RequiredPlan string
}

func (e *FeatureNotEntitledError) Error() string {
	return fmt.Sprintf("The %s capability is not available on the current workspace plan.", e.Feature)
}

func requireFeature(features map[string]bool, plan, feature string) error {
	if features[feature] {
		return nil
	}
	return &FeatureNotEntitledError{Feature: feature, CurrentPlan: plan, RequiredPlan: minimumFeaturePlan[feature]}
}

func (c *Configuration) GetEntitlementSummary(ctx context.Context, actor Actor) (*EntitlementSummary, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.client.WorkspaceEntitlement.Get(ctx, actor.OrganizationID)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	plan, status, features := evaluateBootstrapEntitlement(row, time.Now().UTC())
	return &EntitlementSummary{Features: features, Plan: plan, Status: status}, nil
}

func (c *Configuration) GetFeatureDecision(ctx context.Context, actor Actor, feature string) (*FeatureDecision, error) {
	requiredPlan, ok := minimumFeaturePlan[feature]
	if !ok {
		return nil, ErrInvalidInput
	}
	summary, err := c.GetEntitlementSummary(ctx, actor)
	if err != nil {
		return nil, err
	}
	return &FeatureDecision{Allowed: summary.Features[feature], CurrentPlan: summary.Plan, RequiredPlan: requiredPlan}, nil
}
