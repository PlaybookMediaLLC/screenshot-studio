package product

import (
	"context"
	"os"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
)

// Every Ent projection must read the migrated table: a renamed or missing
// column fails here instead of at the first customer request.
func TestEntProjectionsMatchMigratedTables(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	c := db.Client
	queries := map[string]func() error{
		"audit_drain":                      func() error { _, err := c.AuditDrain.Query().Limit(1).All(ctx); return err },
		"organization_enterprise_settings": func() error { _, err := c.OrganizationEnterpriseSettings.Query().Limit(1).All(ctx); return err },
		"session":                          func() error { _, err := c.Session.Query().Limit(1).All(ctx); return err },
		"support_access_grant":             func() error { _, err := c.SupportAccessGrant.Query().Limit(1).All(ctx); return err },
		"user":                             func() error { _, err := c.User.Query().Limit(1).All(ctx); return err },
		"workspace_entitlement":            func() error { _, err := c.WorkspaceEntitlement.Query().Limit(1).All(ctx); return err },
		"outbox_event":                     func() error { _, err := c.OutboxEvent.Query().Limit(1).All(ctx); return err },
		"apikey":                           func() error { _, err := c.Apikey.Query().Limit(1).All(ctx); return err },
		"audience_subscriber":              func() error { _, err := c.AudienceSubscriber.Query().Limit(1).All(ctx); return err },
		"audit_retention_policy":           func() error { _, err := c.AuditRetentionPolicy.Query().Limit(1).All(ctx); return err },
		"billing_entitlement_event":        func() error { _, err := c.BillingEntitlementEvent.Query().Limit(1).All(ctx); return err },
		"campaign_plan":                    func() error { _, err := c.CampaignPlan.Query().Limit(1).All(ctx); return err },
		"campaign_revision":                func() error { _, err := c.CampaignRevision.Query().Limit(1).All(ctx); return err },
		"communication_attempt":            func() error { _, err := c.CommunicationAttempt.Query().Limit(1).All(ctx); return err },
		"communication_recipient":          func() error { _, err := c.CommunicationRecipient.Query().Limit(1).All(ctx); return err },
		"customer_communication":           func() error { _, err := c.CustomerCommunication.Query().Limit(1).All(ctx); return err },
		"launch_run":                       func() error { _, err := c.LaunchRun.Query().Limit(1).All(ctx); return err },
		"release_document":                 func() error { _, err := c.ReleaseDocument.Query().Limit(1).All(ctx); return err },
		"release_spec":                     func() error { _, err := c.ReleaseSpec.Query().Limit(1).All(ctx); return err },
		"screenshot_cache":                 func() error { _, err := c.ScreenshotCache.Query().Limit(1).All(ctx); return err },
	}
	for table, query := range queries {
		if err := query(); err != nil {
			t.Errorf("%s: %v", table, err)
		}
	}
}
