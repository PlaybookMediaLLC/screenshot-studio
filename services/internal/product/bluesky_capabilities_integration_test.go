package product

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
	"github.com/google/uuid"
)

func TestBlueskyScheduleChecksOriginalContentAndProof(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithMonthlyMeter(&recordingMonthlyMeter{})
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	external := "blue-" + w.id
	socialCredentialFixture(t, w.ctx, w.db.SQL, w.org)(external, "bluesky")
	connection, err := w.repo.auth.CreateConnection(w.ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, RequestID: w.owner.RequestID, Type: "USER"}, publishing.CreateConnectionInput{ExternalAccountID: external, Platform: "bluesky", ProviderSettings: map[string]any{}, SecretReference: "SOCIAL_API_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	did := "did:plc:abcdefghijklmnopqrstuvwx"
	setProof := func(permission *bool, blob int64) {
		t.Helper()
		caps := socialidentity.BlueskyLexiconLimits()
		caps.VideoCanUpload = permission
		if blob > 0 {
			caps.BlobUploadLimit = &blob
		}
		encoded, err := json.Marshal(socialidentity.Capabilities{Version: 1, Bluesky: &caps})
		if err != nil {
			t.Fatal(err)
		}
		w.exec(t, `UPDATE "Integration" SET "internalId"=$2,"verifiedAccountKey"=$3,"verifiedAccountKind"='profile',"verifiedScopes"='["com.atproto.appPass"]',"verifiedCapabilities"=$4,"identityVerifiedAt"=now() WHERE id=$1`, external, did, "bluesky:"+did, string(encoded))
	}
	addAsset := func(mime string, size int, org string) string {
		t.Helper()
		id := uuid.NewString()
		if err := w.db.Client.Asset.Create().SetID(id).SetOrganizationID(org).SetObjectKey("org/" + org + "/input/" + id).SetMediaType(mime).SetBytes(size).SetStatus(asset.StatusUPLOADED).Exec(w.ctx); err != nil {
			t.Fatal(err)
		}
		return id
	}
	image := addAsset("image/png", 100, w.org)
	oversize := addAsset("image/png", 2000001, w.org)
	video := addAsset("video/mp4", 100, w.org)
	wrongVideo := addAsset("video/webm", 100, w.org)
	images := []string{image}
	for range 4 {
		images = append(images, addAsset("image/png", 100, w.org))
	}
	yes, no := true, false
	for _, name := range []string{"unverified", "text overflow", "byte overflow", "five images", "reply five images", "reply byte overflow", "oversized image", "PDS limit", "mixed media", "video unknown", "video denied", "unsupported video", "wrong identity", "foreign binding", "valid emoji", "valid image", "valid video"} {
		t.Run(name, func(t *testing.T) {
			setProof(&yes, 0)
			target := ContentDraftScheduleTarget{ChannelConnectionID: connection.ID, Caption: "A valid post"}
			valid := strings.HasPrefix(name, "valid")
			switch name {
			case "unverified":
				w.exec(t, `UPDATE "Integration" SET "verifiedAccountKey"=NULL,"verifiedAccountKind"=NULL,"verifiedScopes"=NULL,"verifiedCapabilities"=NULL,"identityVerifiedAt"=NULL WHERE id=$1`, external)
			case "text overflow":
				target.Caption = strings.Repeat("a", 301)
			case "byte overflow":
				target.Caption = strings.Repeat("👩‍💻", 300)
			case "five images":
				target.AssetIDs = images
			case "reply five images":
				target.Replies = []thread.Reply{{Caption: "reply", AssetIDs: images}}
			case "reply byte overflow":
				target.Replies = []thread.Reply{{Caption: strings.Repeat("👩‍💻", 300)}}
			case "oversized image":
				target.AssetIDs = []string{oversize}
			case "PDS limit":
				setProof(&yes, 50)
				target.AssetIDs = []string{image}
			case "mixed media":
				target.AssetIDs = []string{image, video}
			case "video unknown":
				setProof(nil, 0)
				target.AssetIDs = []string{video}
			case "video denied":
				setProof(&no, 0)
				target.AssetIDs = []string{video}
			case "unsupported video":
				target.AssetIDs = []string{wrongVideo}
			case "wrong identity":
				w.exec(t, `UPDATE "Integration" SET "internalId"='did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' WHERE id=$1`, external)
			case "foreign binding":
				w.exec(t, `UPDATE channel_connection SET "externalAccountId"=$2 WHERE id=$1`, connection.ID, "not-this-tenant")
				defer w.exec(t, `UPDATE channel_connection SET "externalAccountId"=$2 WHERE id=$1`, connection.ID, external)
			case "valid emoji":
				target.Caption = strings.Repeat("👍🏽", 300)
				target.Replies = []thread.Reply{{Caption: strings.Repeat("e\u0301", 300)}}
			case "valid image":
				target.AssetIDs = []string{image}
			case "valid video":
				target.AssetIDs = []string{video}
			}
			draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{Title: name, PlainText: "Preserved"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = w.repo.ScheduleContentDraft(w.ctx, w.owner, draft.ID, ScheduleContentDraftInput{Version: draft.Version, ScheduledFor: time.Now().Add(time.Hour), Targets: []ContentDraftScheduleTarget{target}})
			if (err == nil) != valid {
				t.Fatalf("valid=%v err=%v", valid, err)
			}
			count, queryErr := w.db.Client.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(draft.ID)).Count(w.ctx)
			if queryErr != nil || !valid && count != 0 || valid && count != 1 {
				t.Fatalf("scheduled records=%d: %v", count, queryErr)
			}
			if !valid {
				row, err := w.db.Client.ContentDraft.Get(w.ctx, draft.ID)
				if err != nil || row.Version != draft.Version || row.PlainText != "Preserved" {
					t.Fatalf("rejection changed draft: %v", err)
				}
			}
		})
	}
}
