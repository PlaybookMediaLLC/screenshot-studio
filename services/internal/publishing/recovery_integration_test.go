package publishing

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/lucsky/cuid"
)

// The every-minute dispatcher and the startup recovery both start workflows
// for exactly the posts this query returns.
func TestRecoverablePostsAreDueScheduledPostsInsideTheWindow(t *testing.T) {
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
	var databaseName string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&databaseName); err != nil || !strings.Contains(databaseName, "test") {
		t.Fatalf("refusing database %q: %v", databaseName, err)
	}
	id := cuid.New()
	org, user := "org_"+id, "user_"+id
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Recovery',$2,true,now(),now())`, user, id+"@example.test")
	t.Cleanup(func() { _, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1`, user) })
	exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,'Recovery',$2,now())`, org, id)
	t.Cleanup(func() { _, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, org) })
	exec(`INSERT INTO brand_kit (id,"organizationId",name,version,definition,status,"createdAt","updatedAt") VALUES ($1,$2,'Brand',1,'{}'::jsonb,'ACTIVE',now(),now())`, "brand_"+id, org)
	exec(`INSERT INTO creative_template (id,"organizationId",name,version,definition,status,"createdAt","updatedAt") VALUES ($1,$2,'Template',1,'{}'::jsonb,'ACTIVE',now(),now())`, "template_"+id, org)
	exec(`INSERT INTO release (id,"organizationId",title,"benefitStatement",status,"createdByUserId","createdAt","updatedAt") VALUES ($1,$2,'Release','Recover posts.','DRAFT',$3,now(),now())`, "release_"+id, org, user)
	exec(`INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',68,'UPLOADED',now(),now())`, "asset_"+id, org, "org/"+org+"/asset.png")
	exec(`INSERT INTO creative_variant (id,"organizationId","releaseId","sourceAssetId","brandKitId","brandKitVersion","templateId","templateVersion",revision,"aspectRatio",status,"createdByUserId","createdAt","updatedAt")
		VALUES ($1,$2,$3,$4,$5,1,$6,1,1,'1:1','APPROVED',$7,now(),now())`, "variant_"+id, org, "release_"+id, "asset_"+id, "brand_"+id, "template_"+id, user)
	exec(`INSERT INTO channel_connection (id,"organizationId",provider,"externalAccountId","secretReference",status,"createdByUserId","createdAt","updatedAt",platform,"providerSettings")
		VALUES ($1,$2,'postiz','destination','POSTIZ_API_KEY','ACTIVE',$3,now(),now(),'x','{}'::jsonb)`, "connection_"+id, org, user)
	now := time.Now().UTC().Truncate(time.Millisecond)
	post := func(name, status string, scheduledFor time.Time) {
		exec(`INSERT INTO scheduled_post (id,"organizationId","variantId","channelConnectionId","scheduledFor",status,caption,"idempotencyKey","createdAt","updatedAt")
			VALUES ($1,$2,$3,$4,$5,$6,'Recovery',$1,now(),now())`, name+"_"+id, org, "variant_"+id, "connection_"+id, scheduledFor, status)
	}
	post("due_late", "SCHEDULED", now.Add(-time.Minute))
	post("due_early", "SCHEDULED", now.Add(-time.Hour))
	post("future", "SCHEDULED", now.Add(time.Hour))
	post("cancelled", "CANCELLED", now.Add(-time.Minute))
	post("stale", "SCHEDULED", now.Add(-72*time.Hour))

	posts, err := NewRepository(db.Client).ListRecoverablePosts(ctx, now.Add(-48*time.Hour), now, 1000)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, item := range posts {
		if item.OrganizationID == org {
			got = append(got, strings.TrimSuffix(item.ID, "_"+id))
		}
	}
	if strings.Join(got, ",") != "due_early,due_late" {
		t.Fatalf("recoverable posts = %v, want the two due scheduled posts oldest first", got)
	}
}
