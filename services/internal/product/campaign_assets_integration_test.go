package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentangle"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/design"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

// The campaign studio's writes on the product database: asset links upsert
// by (campaign, asset), copy appends after existing angles, designs are
// replaced in place, and every operation stays inside its workspace.
func TestCampaignStudio(t *testing.T) {
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
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	id := cuid.New()
	org, other := "org_"+id, "other_"+id
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	actors := map[string]Actor{}
	for _, organization := range []string{org, other} {
		userID := "user_" + organization
		exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Owner',$2,true,now(),now())`, userID, organization+"@example.test")
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
		exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
			"session_"+organization, userID, organization)
		exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, "member_"+organization, organization, userID)
		actors[organization] = Actor{OrganizationID: organization, UserID: userID, SessionID: "session_" + organization, RequestID: "request_" + id}
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1 OR id=$2`, "user_"+org, "user_"+other)
	})
	campaignID, designID := "campaign_"+id, "design_"+id
	captureID, foreignAssetID := uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO campaign (id,"organizationId",name,objective,"updatedAt") VALUES ($1,$2,'Campaign','Adoption',now())`, campaignID, org)
	exec(`INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',1,'UPLOADED',now(),now())`,
		captureID, org, "org/"+org+"/"+captureID+".png")
	exec(`INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',1,'UPLOADED',now(),now())`,
		foreignAssetID, other, "org/"+other+"/"+foreignAssetID+".png")
	exec(`INSERT INTO design (id,"organizationId","campaignId",name,document,"variantLabel","updatedAt") VALUES ($1,$2,$3,'Hero','{"version":1,"image":{}}','A',now())`, designID, org, campaignID)
	exec(`INSERT INTO content_angle (id,"organizationId","campaignId",title,hook,position,"updatedAt") VALUES ($1,$2,$3,'Existing','Hook',0,now())`, "angle_"+id, org, campaignID)
	repo := NewConfiguration(db.Client)
	owner, foreign := actors[org], actors[other]
	expect := func(err, kind error, what string) {
		t.Helper()
		if !errors.Is(err, kind) {
			t.Fatalf("%s: got %v, want %v", what, err, kind)
		}
	}
	text := func(value string) *string { return &value }
	version := 2

	// Asset links: created once, then a relink replaces caption and provenance.
	_, err = repo.GetCampaignAsset(ctx, owner, campaignID, captureID)
	expect(err, publishing.ErrNotFound, "unlinked asset")
	link, err := repo.LinkCampaignAsset(ctx, owner, campaignID, captureID, LinkCampaignAssetInput{Caption: text("https://example.test"),
		Kind: "capture-mobile", PlanAssetKey: text("A1"), PlanVersion: &version, VariantLabel: text("A")})
	if err != nil || link.Kind != "capture-mobile" || link.AssetStatus != "UPLOADED" || link.Asset.ObjectKey != "org/"+org+"/"+captureID+".png" {
		t.Fatalf("link=%+v err=%v", link, err)
	}
	relinked, err := repo.LinkCampaignAsset(ctx, owner, campaignID, captureID, LinkCampaignAssetInput{Caption: text("Hero render"), Kind: "design-render"})
	if err != nil || relinked.ID != link.ID || relinked.Kind != "capture-mobile" || *relinked.Caption != "Hero render" ||
		relinked.PlanAssetKey != nil || relinked.PlanVersion != nil || relinked.VariantLabel != nil {
		t.Fatalf("relinked=%+v err=%v", relinked, err)
	}
	if found, err := repo.GetCampaignAsset(ctx, owner, campaignID, captureID); err != nil || found.ID != link.ID {
		t.Fatalf("found=%+v err=%v", found, err)
	}
	_, err = repo.GetCampaignAsset(ctx, foreign, campaignID, captureID)
	expect(err, publishing.ErrNotFound, "foreign link read")
	_, err = repo.LinkCampaignAsset(ctx, foreign, campaignID, captureID, LinkCampaignAssetInput{Kind: "capture-mobile"})
	expect(err, publishing.ErrNotFound, "foreign campaign link")
	_, err = repo.LinkCampaignAsset(ctx, owner, campaignID, foreignAssetID, LinkCampaignAssetInput{Kind: "capture-mobile"})
	expect(err, publishing.ErrNotFound, "foreign asset link")
	_, err = repo.LinkCampaignAsset(ctx, owner, campaignID, captureID, LinkCampaignAssetInput{Kind: " "})
	expect(err, ErrInvalidInput, "blank kind")

	// Copy: angles append after existing ones, posts are drafts, the save is audited.
	first, second := 0, 1
	copyInput := SaveCampaignCopyInput{
		Angles: []CampaignAngleInput{{Hook: "Fast", Title: "Speed"}, {Hook: "Safe", Title: "Trust"}},
		Posts: []CampaignPostInput{{AngleIndex: &first, CallToAction: text("Try it"), Channel: "x", Copy: "Ship faster"},
			{AngleIndex: &second, Channel: "linkedin", Copy: "Ship safely"}},
	}
	if err := repo.SaveCampaignCopy(ctx, owner, campaignID, copyInput); err != nil {
		t.Fatal(err)
	}
	angles, err := db.Client.ContentAngle.Query().Where(contentangle.CampaignID(campaignID)).Order(contentangle.ByPosition()).All(ctx)
	if err != nil || len(angles) != 3 || angles[1].Title != "Speed" || angles[1].Position != 1 || angles[2].Position != 2 {
		t.Fatalf("angles=%+v err=%v", angles, err)
	}
	posts, err := db.Client.CampaignPost.Query().Where(campaignpost.CampaignID(campaignID)).All(ctx)
	if err != nil || len(posts) != 2 {
		t.Fatalf("posts=%+v err=%v", posts, err)
	}
	for _, post := range posts {
		want := map[string]string{"x": angles[1].ID, "linkedin": angles[2].ID}[post.Channel]
		if post.Status != campaignpost.StatusDRAFT || post.AngleID == nil || *post.AngleID != want || post.OrganizationID != org {
			t.Fatalf("post=%+v", post)
		}
	}
	audit, err := db.Client.AuditLog.Query().Where(auditlog.OrganizationID(org), auditlog.Action("product.campaign_copy_generated")).Only(ctx)
	if err != nil || audit.Metadata["angleCount"] != float64(2) || audit.Metadata["postCount"] != float64(2) || audit.EntityID == nil || *audit.EntityID != campaignID {
		t.Fatalf("copy audit=%+v err=%v", audit, err)
	}
	expect(repo.SaveCampaignCopy(ctx, foreign, campaignID, copyInput), publishing.ErrNotFound, "foreign copy save")
	bad := 5
	expect(repo.SaveCampaignCopy(ctx, owner, campaignID, SaveCampaignCopyInput{Angles: copyInput.Angles,
		Posts: []CampaignPostInput{{AngleIndex: &bad, Channel: "x", Copy: "Orphan"}}}), ErrInvalidInput, "unknown angle")

	// Designs: replaced in place, name and label only when given.
	document := map[string]any{"version": 1, "image": map[string]any{"src": "asset:" + captureID}}
	if err := repo.ReplaceDesign(ctx, owner, designID, ReplaceDesignInput{Document: document, VariantLabel: text("B")}); err != nil {
		t.Fatal(err)
	}
	row, err := db.Client.Design.Query().Where(design.ID(designID)).Only(ctx)
	if err != nil || row.Name != "Hero" || row.VariantLabel == nil || *row.VariantLabel != "B" || row.Document["image"].(map[string]any)["src"] != "asset:"+captureID {
		t.Fatalf("design=%+v err=%v", row, err)
	}
	expect(repo.ReplaceDesign(ctx, foreign, designID, ReplaceDesignInput{Document: map[string]any{"version": 1, "image": map[string]any{}}}),
		publishing.ErrNotFound, "foreign design replace")
	foreignDocument := map[string]any{"version": 1, "image": map[string]any{"src": "asset:" + foreignAssetID}}
	expect(repo.ReplaceDesign(ctx, owner, designID, ReplaceDesignInput{Document: foreignDocument}), publishing.ErrNotFound, "foreign image")
	expect(repo.ReplaceDesign(ctx, owner, designID, ReplaceDesignInput{Document: document, Name: text("  ")}), ErrInvalidInput, "blank name")
}
