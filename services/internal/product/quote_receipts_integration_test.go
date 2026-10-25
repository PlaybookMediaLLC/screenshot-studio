package product

import (
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
	"reflect"
	"testing"
	"time"
)

func TestNativeQuoteReceiptsPersistAndCannotRetryPublishedRoot(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{PlainText: "A native quote"})
	if err != nil {
		t.Fatal(err)
	}
	connection := w.db.Client.ChannelConnection.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetPlatform("mastodon").SetExternalAccountID("quote").SetSecretReference("fixture").SetCreatedByUserID(w.owner.UserID).SetSocialSetID(*draft.SocialSetID).SaveX(w.ctx)
	post := w.db.Client.ScheduledPost.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetChannelConnectionID(connection.ID).SetContentDraftID(draft.ID).SetSocialSetID(*draft.SocialSetID).SetStatus(scheduledpost.StatusPUBLISHED).SetScheduledFor(time.Now().Add(-time.Hour)).SetPublishedAt(time.Now()).SetCaption("A native quote").SetRemotePostID("remote-root").SetIdempotencyKey(cuid.New()).SaveX(w.ctx)
	receipts := []postoptions.QuoteReceipt{{PostID: "root", State: "pending"}, {PostID: "reply-1", State: "rejected"}, {PostID: "reply-2", State: "unconfirmed"}}
	if err := publishing.NewRepository(w.db.Client).RecordThread(w.ctx, post.ID, postoptions.ThreadProgress{Posted: 2, Total: 2, LastReplyID: "reply-2", Quotes: receipts}); err != nil {
		t.Fatal(err)
	}
	rows, err := w.repo.ListContentDraftPosts(w.ctx, w.owner, draft.ID)
	if err != nil || len(rows) != 1 || !reflect.DeepEqual(rows[0].ThreadProgress.Quotes, receipts) || rows[0].Status != "PUBLISHED" {
		t.Fatal("quote receipts lost", rows, err)
	}
	if _, err := w.repo.RetryContentDraftPost(w.ctx, w.owner, post.ID); !errors.Is(err, publishing.ErrConflict) {
		t.Fatal("quote approval retried a published post", err)
	}
}
