package product

import (
	"errors"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
)

func TestCampaignReviewLimitsAndArchive(t *testing.T) {
	w, other := newTestWorkspace(t), newTestWorkspace(t)
	created, err := w.repo.CreateCampaign(w.ctx, w.owner, CreateCampaignInput{Name: "QA", Objective: "Launch", Posts: []CampaignPostInput{
		{Channel: "x", Copy: strings.Repeat("x", 281)}, {Channel: "x", Copy: "Valid"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = w.repo.TransitionCampaignPosts(w.ctx, w.owner, created.ID, CampaignPostDecision{Decision: "submit"})
	if !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("bulk submit accepted long copy: %v", err)
	}
	count, err := w.db.Client.CampaignPost.Query().Where(campaignpost.CampaignID(created.ID), campaignpost.StatusEQ(campaignpost.StatusDRAFT)).Count(w.ctx)
	if err != nil || count != 2 {
		t.Fatalf("bulk review was not atomic: %d %v", count, err)
	}
	_, err = w.repo.TransitionCampaignPosts(w.ctx, other.owner, created.ID, CampaignPostDecision{Decision: "submit"})
	if !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("tenant escape: %v", err)
	}
	// Legacy over-limit posts already in review cannot be approved either.
	w.exec(t, `UPDATE campaign_post SET status='READY_FOR_REVIEW' WHERE "campaignId"=$1`, created.ID)
	_, err = w.repo.TransitionCampaignPosts(w.ctx, w.owner, created.ID, CampaignPostDecision{Decision: "approve"})
	if !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("bulk approval accepted long copy: %v", err)
	}
	note := "   "
	_, err = w.repo.TransitionCampaignPosts(w.ctx, w.owner, created.ID, CampaignPostDecision{Decision: "request_changes", Note: &note})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty review note accepted: %v", err)
	}
	if _, err := w.repo.TransitionCampaign(w.ctx, w.owner, created.ID, "ARCHIVED"); err != nil {
		t.Fatal(err)
	}
	_, err = w.repo.TransitionCampaignPosts(w.ctx, w.owner, created.ID, CampaignPostDecision{Decision: "reject"})
	if !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("archived review accepted: %v", err)
	}
	expected, edited := created.Posts[0].Copy, "Edited"
	_, err = w.repo.UpdateCampaignPost(w.ctx, w.owner, created.ID, created.Posts[0].ID, UpdateCampaignPostInput{ExpectedCopy: &expected, Copy: &edited})
	if !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("archived edit accepted: %v", err)
	}
	_, err = w.repo.ScheduleCampaignPost(w.ctx, w.owner, created.ID, created.Posts[0].ID, ScheduleCampaignPostInput{ChannelConnectionID: "missing"})
	if !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("archived schedule accepted: %v", err)
	}
	if _, err := w.repo.TransitionCampaign(w.ctx, w.owner, created.ID, "DRAFT"); err != nil {
		t.Fatal(err)
	}
	before, _ := w.repo.GetCampaign(w.ctx, w.owner, created.ID)
	_, err = w.repo.UpdateCampaignPost(w.ctx, w.owner, created.ID, created.Posts[0].ID, UpdateCampaignPostInput{ExpectedCopy: &expected, Copy: &edited})
	if err != nil {
		t.Fatal(err)
	}
	after, _ := w.repo.GetCampaign(w.ctx, w.owner, created.ID)
	if !after.UpdatedAt.After(before.UpdatedAt) {
		t.Fatal("post edit did not update campaign timestamp")
	}
}

func TestCampaignProductShotApproval(t *testing.T) {
	w, other := newTestWorkspace(t), newTestWorkspace(t)
	releaseID := uuid.NewString()
	w.exec(t, `INSERT INTO release (id,"organizationId",title,"benefitStatement","updatedAt") VALUES ($1,$2,'Release','Useful',now())`, releaseID, w.org)
	created, err := w.repo.CreateCampaign(w.ctx, w.owner, CreateCampaignInput{Name: "QA", Objective: "Launch", ReleaseID: &releaseID})
	if err != nil {
		t.Fatal(err)
	}
	shot := uuid.NewString()
	w.exec(t, `INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,width,height,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',1,'UPLOADED',1200,630,now(),now())`, shot, w.org, "org/"+w.org+"/"+shot)
	key := "A1"
	_, err = w.repo.LinkCampaignAsset(w.ctx, w.owner, created.ID, shot, LinkCampaignAssetInput{Kind: "product-shot", PlanAssetKey: &key})
	if err != nil {
		t.Fatal(err)
	}
	_, err = w.repo.ApproveCampaignAsset(w.ctx, other.owner, created.ID, shot)
	if !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("cross tenant approval: %v", err)
	}
	w.addMember(t, "viewer", "viewer")
	_, err = w.repo.ApproveCampaignAsset(w.ctx, w.actor("viewer"), created.ID, shot)
	if !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer approval: %v", err)
	}
	first, err := w.repo.ApproveCampaignAsset(w.ctx, w.owner, created.ID, shot)
	if err != nil {
		t.Fatal(err)
	}
	again, err := w.repo.ApproveCampaignAsset(w.ctx, w.owner, created.ID, shot)
	if err != nil || again.Variant.ID != first.Variant.ID {
		t.Fatalf("approval retry: %+v %v", again, err)
	}
	designs, err := w.repo.ListCampaignDesigns(w.ctx, w.owner, created.ID)
	if err != nil || len(designs) != 1 || designs[0].ApprovedVariant == nil || designs[0].ApprovedVariant.SourceAssetID != shot {
		t.Fatalf("shot lineage: %+v %v", designs, err)
	}
	if _, err := w.repo.TransitionCampaign(w.ctx, w.owner, created.ID, "ARCHIVED"); err != nil {
		t.Fatal(err)
	}
	_, err = w.repo.ApproveCampaignAsset(w.ctx, w.owner, created.ID, shot)
	if !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("archived approval: %v", err)
	}
}
