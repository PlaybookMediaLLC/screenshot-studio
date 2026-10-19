package product

import (
	"errors"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

func TestCreativeSetDeliveryHandoff(t *testing.T) {
	w, foreign := newTestWorkspace(t), newTestWorkspace(t)
	w.repo.WithMonthlyMeter(&recordingMonthlyMeter{})
	t.Setenv("PLATFORM_CREATIVE_SETS", "enabled")
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	media := uuid.NewString()
	if err := w.db.Client.Asset.Create().SetID(media).SetOrganizationID(w.org).SetObjectKey("org/" + w.org + "/input/" + media + "/1/screen.png").SetMediaType("image/png").SetWidth(1600).SetHeight(900).SetBytes(100).SetStatus(asset.StatusUPLOADED).Exec(w.ctx); err != nil {
		t.Fatal(err)
	}
	setID, campaignID := cuid.New(), cuid.New()
	releaseID := cuid.New()
	w.exec(t, `INSERT INTO release(id,"organizationId",title,"benefitStatement","updatedAt") VALUES($1,$2,'Launch','Decide together',now())`, releaseID, w.org)
	w.exec(t, `INSERT INTO campaign (id,"organizationId",name,objective,"releaseId","updatedAt") VALUES ($1,$2,'Launch','Adoption',$3,now())`, campaignID, w.org, releaseID)
	doc := creativeSetFixture(media)
	if _, err := w.repo.CreateCreativeSet(w.ctx, w.owner, setID, "Feature", doc); err != nil {
		t.Fatal(err)
	}
	pinned, err := w.repo.CreateCreativeSetVersion(w.ctx, w.owner, setID, "Delivery revision 1", 1)
	if err != nil {
		t.Fatal(err)
	}
	again, err := w.repo.CreateCreativeSetVersion(w.ctx, w.owner, setID, "Delivery revision 1", 1)
	if err != nil || pinned.ID != again.ID {
		t.Fatalf("pin replay=%+v %v", again, err)
	}
	deliveryID := uuid.NewString()
	doc["deliveries"] = []any{map[string]any{"id": deliveryID, "asset": "asset:" + media, "revision": float64(1), "outputId": "wide", "documentHash": "immutable-document-hash"}}
	if _, err := w.repo.UpdateCreativeSetDocument(w.ctx, w.owner, setID, CreativeSetDocumentWrite{BaseRevision: 1, Document: doc}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.CreateCreativeSetVersion(w.ctx, w.owner, setID, "Stale export", 1); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("stale pin=%v", err)
	}
	input := CreativeSetHandoffInput{BaseRevision: 2, DeliveryID: deliveryID, CampaignID: campaignID, Channel: "linkedin", Copy: "Approvals in one place."}
	attached, err := w.repo.AttachCreativeSetDelivery(w.ctx, w.owner, setID, input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := w.repo.AttachCreativeSetDelivery(w.ctx, w.owner, setID, input)
	if err != nil || *attached != *replay {
		t.Fatalf("handoff replay=%+v %v", replay, err)
	}
	if count, err := w.db.Client.CampaignPost.Query().Where(campaignpost.CampaignID(campaignID)).Count(w.ctx); err != nil || count != 1 {
		t.Fatalf("post count=%d %v", count, err)
	}
	original, err := w.repo.GetDesign(w.ctx, w.owner, attached.DesignID)
	if err != nil || original.RenderedAssetID == nil || *original.RenderedAssetID != media {
		t.Fatalf("delivered design=%+v %v", original, err)
	}
	connection, err := w.repo.auth.CreateConnection(w.ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, RequestID: w.owner.RequestID, Type: "USER"}, publishing.CreateConnectionInput{ExternalAccountID: "story-" + setID, Platform: "linkedin", ProviderSettings: map[string]any{}, SecretReference: "SOCIAL_API_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().Add(2 * time.Hour)
	schedule := func(variant *string) (*ScheduleCampaignPostResult, error) {
		return w.repo.ScheduleCampaignPost(w.ctx, w.owner, campaignID, attached.PostID, ScheduleCampaignPostInput{ChannelConnectionID: connection.ID, CreativeVariantID: variant, ScheduledAt: &at})
	}
	if _, err := schedule(nil); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("unapproved story scheduled: %v", err)
	}
	for _, decision := range []string{"submit", "approve"} {
		if _, err := w.repo.TransitionCampaignPosts(w.ctx, w.owner, campaignID, CampaignPostDecision{Decision: decision, PostIDs: []string{attached.PostID}}); err != nil {
			t.Fatal(err)
		}
	}
	approved, err := w.repo.ApproveCampaignDesign(w.ctx, w.owner, campaignID, attached.DesignID)
	if err != nil {
		t.Fatal(err)
	}
	scheduled, err := schedule(&approved.Variant.ID)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := schedule(&approved.Variant.ID)
	if err != nil || repeated.ScheduledPost.ID != scheduled.ScheduledPost.ID {
		t.Fatalf("duplicate schedule=%+v %v", repeated, err)
	}
	runID := "story-run-" + setID
	w.exec(t, `UPDATE scheduled_post SET status='PROCESSING',"triggerRunId"=$2 WHERE id=$1`, scheduled.ScheduledPost.ID, runID)
	job, err := w.repo.auth.LoadPublishJob(w.ctx, scheduled.ScheduledPost.ID, runID)
	if err != nil || job.AssetObjectKey != "org/"+w.org+"/input/"+media+"/1/screen.png" {
		t.Fatalf("story publish input=%+v %v", job, err)
	}
	w.exec(t, `UPDATE scheduled_post SET status='SCHEDULED',"triggerRunId"=NULL WHERE id=$1`, scheduled.ScheduledPost.ID)
	doc["story"].(map[string]any)["headline"] = "Changed after delivery"
	if _, err := w.repo.UpdateCreativeSetDocument(w.ctx, w.owner, setID, CreativeSetDocumentWrite{BaseRevision: 2, Document: doc}); err != nil {
		t.Fatal(err)
	}
	unchanged, err := w.repo.GetDesign(w.ctx, w.owner, attached.DesignID)
	if err != nil || *unchanged.RenderedAssetID != *original.RenderedAssetID || unchanged.RenderKey == nil || *unchanged.RenderKey != *original.RenderKey {
		t.Fatal("a set edit rewrote its campaign delivery")
	}
	if _, err := w.repo.AttachCreativeSetDelivery(w.ctx, foreign.owner, setID, input); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("foreign handoff=%v", err)
	}
	altered := input
	altered.Copy = "Replacement must not overwrite an attached draft."
	if _, err := w.repo.AttachCreativeSetDelivery(w.ctx, w.owner, setID, altered); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("changed retry=%v", err)
	}
	w.exec(t, `UPDATE scheduled_post SET status='UNKNOWN_DELIVERY' WHERE id=$1`, scheduled.ScheduledPost.ID)
	if _, err := schedule(&approved.Variant.ID); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("unknown delivery duplicated: %v", err)
	}
	w.exec(t, `UPDATE scheduled_post SET status='SCHEDULED' WHERE id=$1`, scheduled.ScheduledPost.ID)
	if _, err := w.repo.auth.CancelScheduledPost(w.ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, RequestID: w.owner.RequestID, Type: "USER"}, scheduled.ScheduledPost.ID); err != nil {
		t.Fatal(err)
	}
	replacement, err := schedule(&approved.Variant.ID)
	if err != nil || replacement.ScheduledPost.ID == scheduled.ScheduledPost.ID {
		t.Fatalf("cancel/reschedule=%+v %v", replacement, err)
	}
	w.addMember(t, "viewer", "viewer")
	if _, err := w.repo.AttachCreativeSetDelivery(w.ctx, w.actor("viewer"), setID, input); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer handoff=%v", err)
	}
}
