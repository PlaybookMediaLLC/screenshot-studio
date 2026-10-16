package product

import (
	"context"
	"testing"
)

// subscribe gives a test workspace an active plan. There is no free plan, so a
// workspace without one can do nothing.
func subscribe(t *testing.T, ctx context.Context, repo *Configuration, org, plan string) {
	t.Helper()
	if _, err := repo.SyncWorkspaceEntitlement(ctx, EntitlementSyncInput{EventID: "test-subscribe-" + org,
		EventType: "test.subscribed", OrganizationID: org, Plan: plan, Provider: "test", Status: "active"}); err != nil {
		t.Fatalf("subscribe %s to %s: %v", org, plan, err)
	}
}
