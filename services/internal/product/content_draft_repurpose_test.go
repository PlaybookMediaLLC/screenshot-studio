package product

import (
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/draftdoc"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
	"github.com/lucsky/cuid"
	"strings"
	"testing"
	"time"
)

func TestRepurposeSeedsOnlyVisibleConfirmedContent(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	w.addMember(t, "writer", "creator")
	source, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{Title: "Published source", PlainText: "Private later edit"})
	if err != nil {
		t.Fatal(err)
	}
	connection := w.db.Client.ChannelConnection.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetPlatform("x").SetExternalAccountID("repurpose").SetSecretReference("fixture").SetCreatedByUserID(w.owner.UserID).SetSocialSetID(*source.SocialSetID).SaveX(w.ctx)
	// The canonical receipt confirms one reply, while a second never reached the provider.
	post := w.db.Client.ScheduledPost.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetChannelConnectionID(connection.ID).SetContentDraftID(source.ID).SetSocialSetID(*source.SocialSetID).SetStatus(scheduledpost.StatusPUBLISHED).SetScheduledFor(time.Now().Add(-time.Hour)).SetPublishedAt(time.Now()).SetCaption("Confirmed root").SetRemotePostID("remote-root").SetIdempotencyKey(cuid.New()).SetReplies([]thread.Reply{{Caption: "Confirmed reply"}, {Caption: "Never delivered"}}).SetThreadProgress(postoptions.ThreadProgress{Posted: 1, LastReplyID: "remote-reply"}).SaveX(w.ctx)
	input := ContentDraftInput{Kind: "repurpose", Target: &draftdoc.Target{SourceDraftID: source.ID}}
	copy, err := w.repo.CreateContentDraft(w.ctx, w.owner, input)
	if err != nil {
		t.Fatal(err)
	}
	if copy.PlainText != "Confirmed root\n\nConfirmed reply" || len(copy.Body) != 3 || copy.ReviewStatus != "none" || copy.ApprovedVersion != nil || copy.Target.SourcePostID != post.ID || copy.SourceDraftID == nil || *copy.SourceDraftID != source.ID {
		t.Fatalf("copy=%+v", copy)
	}
	if strings.Contains(copy.PlainText, "Private") || strings.Contains(copy.PlainText, "Never") {
		t.Fatal("unpublished text copied")
	}
	// Native PDF options hold the document separately from the post's images.
	pdf := cuid.New()
	w.exec(t, `INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'application/pdf',100,'UPLOADED',now(),now())`, pdf, w.org, "org/"+w.org+"/deck.pdf")
	w.exec(t, `UPDATE scheduled_post SET "publishOptions"=jsonb_build_object('documentAssetId',$2::text,'documentTitle','Confirmed deck') WHERE id=$1`, post.ID, pdf)
	withPDF, err := w.repo.CreateContentDraft(w.ctx, w.owner, input)
	if err != nil || len(withPDF.PlatformVersions.Versions) != 1 || withPDF.PlatformVersions.Versions[0].Options.Document.AssetID != pdf {
		t.Fatal("document dropped from repurpose", withPDF, err)
	}
	explicit := input
	explicit.PlainText = "My adaptation"
	adapted, err := w.repo.CreateContentDraft(w.ctx, w.owner, explicit)
	if err != nil || adapted.PlainText != "My adaptation" {
		t.Fatal(adapted, err)
	}
	unknown := input
	unknown.Target = &draftdoc.Target{SourceDraftID: source.ID, SourcePostID: cuid.New()}
	if _, err := w.repo.CreateContentDraft(w.ctx, w.owner, unknown); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("unknown source", err)
	}
	private, err := w.repo.CreateSocialSet(w.ctx, w.owner, SocialSetInput{Name: "Private source", Visibility: "PRIVATE"})
	if err != nil {
		t.Fatal(err)
	}
	w.db.Client.ContentDraft.UpdateOneID(source.ID).SetSocialSetID(private.ID).SetStatus(contentdraft.StatusDraft).SaveX(w.ctx)
	if _, err := w.repo.CreateContentDraft(w.ctx, w.actor("writer"), input); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("private source copied", err)
	}
	count, err := w.db.Client.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(copy.ID)).Count(w.ctx)
	if err != nil || count != 0 {
		t.Fatal("repurpose scheduled itself", count, err)
	}
}
