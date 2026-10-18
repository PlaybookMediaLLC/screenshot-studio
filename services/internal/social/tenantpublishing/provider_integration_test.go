package tenantpublishing

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialdatabase "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database"
	"github.com/lucsky/cuid"
)

func TestDirectPublisherUsesSharedPublicSchemaWithoutLegacyPost(t *testing.T) {
	databaseURL := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	productDB, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = productDB.Close() })
	socialDB, err := socialdatabase.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialDB.Close() })
	var name string
	if err := productDB.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	id := cuid.New()
	productOrg, socialOrg, destination := "product_"+id, "social_"+id, "destination_"+id
	fixtures := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,'Product test',$2,now())`, []any{productOrg, id}},
		{`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ($1,'Social test',now())`, []any{socialOrg}},
		{`INSERT INTO postiz_tenant_binding ("organizationId","goOrganizationId","secretReference","createdAt") VALUES ($1,$2,'POSTIZ_API_KEY_TEST',now())`, []any{productOrg, socialOrg}},
		{`INSERT INTO "Integration" (id,"internalId","organizationId",name,"providerIdentifier",type,token) VALUES ($1,'remote-user',$2,'LinkedIn test','linkedin','social','private-token')`, []any{destination, socialOrg}},
	}
	for _, fixture := range fixtures {
		if _, err := productDB.SQL.ExecContext(ctx, fixture.query, fixture.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = productDB.SQL.ExecContext(ctx, `DELETE FROM "Integration" WHERE id=$1`, destination)
		_, _ = productDB.SQL.ExecContext(ctx, `DELETE FROM postiz_tenant_binding WHERE "organizationId"=$1`, productOrg)
		_, _ = productDB.SQL.ExecContext(ctx, `DELETE FROM "Organization" WHERE id=$1`, socialOrg)
		_, _ = productDB.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, productOrg)
	})
	p, signer, fakeProvider, input := directFixture()
	p.bindings = publishing.NewRepository(productDB.Client)
	p.integrations = EntIntegrationLookup{Client: socialDB.Client}
	input.OrganizationID, input.DestinationID = productOrg, destination
	input.SecretReference = "POSTIZ_API_KEY_TEST"
	input.AssetObjectKey = "org/" + productOrg + "/image.png"
	remoteID, err := p.Publish(ctx, input)
	if err != nil || remoteID != "remote-post-1" || signer.calls != 1 || fakeProvider.calls != 1 {
		t.Fatalf("receipt=%q signer=%d provider=%d err=%v", remoteID, signer.calls, fakeProvider.calls, err)
	}
	var legacyPosts int
	if err := productDB.SQL.QueryRowContext(ctx, `SELECT count(*) FROM "Post" WHERE "organizationId"=$1`, socialOrg).Scan(&legacyPosts); err != nil || legacyPosts != 0 {
		t.Fatalf("legacy social posts=%d err=%v", legacyPosts, err)
	}
}
