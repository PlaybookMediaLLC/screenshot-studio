package product

import (
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

func TestBootstrapEntitlementRespectsStatusDatesAndOverrides(t *testing.T) {
	t.Setenv("PLATFORM_CAMPAIGN_WORKFLOW", "")
	now := time.Date(2026, time.October, 14, 12, 0, 0, 0, time.UTC)
	plan, status, features := evaluateBootstrapEntitlement(nil, now)
	// A workspace without a subscription gets nothing.
	if plan != "free" || status != "active" || features["asset:read"] || features["workspace:use"] {
		t.Fatalf("unsubscribed workspace has features: %s %s %+v", plan, status, features)
	}
	grace := now.Add(time.Hour)
	entitlement := &ent.WorkspaceEntitlement{Plan: "pro", Status: "past_due", GraceUntil: &grace,
		FeatureOverrides: map[string]any{"asset:update": false, "campaign:workflow": true}}
	plan, _, features = evaluateBootstrapEntitlement(entitlement, now)
	if plan != "pro" || features["asset:update"] || !features["asset:read"] || !features["workspace:use"] || !features["campaign:workflow"] {
		t.Fatalf("unexpected grace entitlement: %+v", features)
	}
	entitlement.ValidUntil = &now
	_, _, features = evaluateBootstrapEntitlement(entitlement, now)
	if features["asset:read"] || features["campaign:workflow"] {
		t.Fatalf("expired entitlement remained active: %+v", features)
	}
	t.Setenv("PLATFORM_CAMPAIGN_WORKFLOW", "enabled")
	_, _, features = evaluateBootstrapEntitlement(entitlement, now)
	if !features["campaign:workflow"] || features["asset:read"] {
		t.Fatalf("rollout flag changed unrelated features: %+v", features)
	}
}

func TestPaidPlansIncludeCampaignWorkflow(t *testing.T) {
	t.Setenv("PLATFORM_CAMPAIGN_WORKFLOW", "")
	now := time.Date(2026, time.October, 14, 12, 0, 0, 0, time.UTC)
	for _, plan := range []string{"pro", "business", "enterprise"} {
		_, _, features := evaluateBootstrapEntitlement(&ent.WorkspaceEntitlement{Plan: plan, Status: "active"}, now)
		if !features["campaign:workflow"] {
			t.Fatalf("%s plan lacks campaign:workflow", plan)
		}
	}
	if _, _, features := evaluateBootstrapEntitlement(&ent.WorkspaceEntitlement{Plan: "free", Status: "active"}, now); features["campaign:workflow"] {
		t.Fatal("free workspace has campaign:workflow")
	}
	if _, _, features := evaluateBootstrapEntitlement(&ent.WorkspaceEntitlement{Plan: "pro", Status: "canceled"}, now); features["campaign:workflow"] {
		t.Fatal("inactive workspace has campaign:workflow")
	}
	revoked := &ent.WorkspaceEntitlement{Plan: "business", Status: "active", FeatureOverrides: map[string]any{"campaign:workflow": false}}
	if _, _, features := evaluateBootstrapEntitlement(revoked, now); features["campaign:workflow"] {
		t.Fatal("override did not revoke campaign:workflow")
	}
	if minimumFeaturePlan["campaign:workflow"] != "pro" {
		t.Fatalf("campaign:workflow minimum plan = %s", minimumFeaturePlan["campaign:workflow"])
	}
}
