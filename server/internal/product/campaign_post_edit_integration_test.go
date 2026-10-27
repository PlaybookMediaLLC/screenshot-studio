package product

import (
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/brand"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// A hand edit follows the revision rules: stale copy conflicts, approved
// copy returns to draft, published copy is refused, and the brand applies.
func TestUpdateCampaignPost(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo, owner := w.ctx, w.repo, w.owner
	text := func(value string) *string { return &value }
	if _, err := repo.UpsertBrandProfile(ctx, owner, UpsertBrandProfileInput{Audience: "Developers", ProductDescription: "Studio", Tone: "Clear",
		ProhibitedTerms: []brand.ProhibitedTerm{{Term: "Acme"}}}); err != nil {
		t.Fatal(err)
	}
	cta := "Try it"
	created, err := repo.CreateCampaign(ctx, owner, CreateCampaignInput{Name: "Launch", Objective: "Adoption",
		Posts: []CampaignPostInput{{Channel: "x", Copy: "First", CallToAction: &cta}, {Channel: "linkedin", Copy: "Shipped"}}})
	if err != nil {
		t.Fatal(err)
	}
	postID, publishedID := created.Posts[0].ID, created.Posts[1].ID
	edited, err := repo.UpdateCampaignPost(ctx, owner, created.ID, postID, UpdateCampaignPostInput{ExpectedCopy: text("First"), Copy: text("Second")})
	if err != nil || edited.Copy != "Second" || edited.CallToAction == nil || *edited.CallToAction != "Try it" || edited.Status != "DRAFT" {
		t.Fatalf("edited=%+v err=%v", edited, err)
	}
	if _, err := repo.UpdateCampaignPost(ctx, owner, created.ID, postID, UpdateCampaignPostInput{ExpectedCopy: text("First"), Copy: text("Third")}); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("stale edit: %v", err)
	}
	var prohibited *ProhibitedTermsError
	if _, err := repo.UpdateCampaignPost(ctx, owner, created.ID, postID, UpdateCampaignPostInput{ExpectedCopy: text("Second"), Title: text("Beats acme")}); !errors.As(err, &prohibited) {
		t.Fatalf("prohibited title: %v", err)
	}
	// Approved copy goes back to draft and loses its approval; clearing the call to action works.
	if _, err := repo.TransitionCampaignPosts(ctx, owner, created.ID, CampaignPostDecision{Decision: "submit", PostIDs: []string{postID}}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.TransitionCampaignPosts(ctx, owner, created.ID, CampaignPostDecision{Decision: "approve", PostIDs: []string{postID}}); err != nil {
		t.Fatal(err)
	}
	edited, err = repo.UpdateCampaignPost(ctx, owner, created.ID, postID, UpdateCampaignPostInput{ExpectedCopy: text("Second"), CallToAction: text("")})
	if err != nil || edited.Status != "DRAFT" || edited.ApprovedAt != nil || edited.ApprovedByUserID != nil || edited.CallToAction != nil {
		t.Fatalf("approved edit=%+v err=%v", edited, err)
	}
	w.exec(t, `UPDATE campaign_post SET status='PUBLISHED' WHERE id=$1`, publishedID)
	if _, err := repo.UpdateCampaignPost(ctx, owner, created.ID, publishedID, UpdateCampaignPostInput{ExpectedCopy: text("Shipped"), Copy: text("New")}); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("published edit: %v", err)
	}
	if row := w.db.Client.CampaignPost.GetX(ctx, publishedID); row.Status != campaignpost.StatusPUBLISHED || row.Copy != "Shipped" {
		t.Fatalf("published post changed: %+v", row)
	}
	w.addMember(t, "viewer", "viewer")
	if _, err := repo.UpdateCampaignPost(ctx, w.actor("viewer"), created.ID, postID, UpdateCampaignPostInput{ExpectedCopy: text("Second"), Copy: text("Mine")}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer edit: %v", err)
	}
	if _, err := repo.UpdateCampaignPost(ctx, owner, "other", postID, UpdateCampaignPostInput{ExpectedCopy: text("Second"), Copy: text("Mine")}); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("post through another campaign: %v", err)
	}
	if _, err := repo.UpdateCampaignPost(ctx, owner, created.ID, postID, UpdateCampaignPostInput{ExpectedCopy: text("Second")}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty edit: %v", err)
	}
	w.exec(t, `INSERT INTO apikey (id,"referenceId",key,enabled,"createdAt","updatedAt") VALUES ($1,$2,'hashed',true,now(),now())`, "key_"+w.id, w.org)
	if byKey, err := repo.UpdateCampaignPost(ctx, Actor{OrganizationID: w.org, Kind: "api_key", KeyID: "key_" + w.id}, created.ID, postID,
		UpdateCampaignPostInput{ExpectedCopy: text("Second"), Copy: text("From CI")}); err != nil || byKey.Copy != "From CI" {
		t.Fatalf("API key edit=%+v err=%v", byKey, err)
	}
}
