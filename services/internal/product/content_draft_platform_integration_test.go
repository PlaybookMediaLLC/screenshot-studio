package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
	"github.com/lucsky/cuid"
)

// Content drafts, round two: the queue fills free slots, a post moves
// without a new charge, approval gates scheduling, share links read and take
// comments, revisions are kept, and a stopped thread resumes.
func TestContentDraftPlatform(t *testing.T) {
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
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	id := cuid.New()
	org := "org_" + id
	userID := "user_" + org
	meter := &recordingMonthlyMeter{}
	repo := NewConfiguration(db.Client).WithMonthlyMeter(meter)
	exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Owner',$2,true,now(),now())`, userID, org+"@example.test")
	exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, org)
	exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
		"session_"+org, userID, org)
	exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, "member_"+org, org, userID)
	subscribe(t, ctx, repo, org, "pro")
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM scheduled_post WHERE "organizationId" = $1`, org)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM content_draft WHERE "organizationId" = $1`, org)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id = $1`, org)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id = $1`, userID)
	})
	owner := Actor{OrganizationID: org, UserID: userID, SessionID: "session_" + org, RequestID: "request_" + id}
	connection, err := repo.auth.CreateConnection(ctx, publishing.Actor{Organization: org, UserID: userID, RequestID: owner.RequestID, Type: "USER"},
		publishing.CreateConnectionInput{ExternalAccountID: "x-" + id, Platform: "x", ProviderSettings: map[string]any{}, SecretReference: "SOCIAL_API_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	newDraft := func(text string) *ContentDraftRecord {
		t.Helper()
		draft, err := repo.CreateContentDraft(ctx, owner, ContentDraftInput{PlainText: text, Title: text})
		if err != nil {
			t.Fatal(err)
		}
		return draft
	}
	at := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Minute)
	schedule := func(draft *ContentDraftRecord, when time.Time) (*ScheduleContentDraftResult, error) {
		return repo.ScheduleContentDraft(ctx, owner, draft.ID, ScheduleContentDraftInput{ScheduledFor: when, Version: draft.Version,
			Targets: []ContentDraftScheduleTarget{{Caption: draft.Title, ChannelConnectionID: connection.ID}}})
	}

	t.Run("the queue fills the next free slot", func(t *testing.T) {
		settings, err := repo.GetContentDraftSettings(ctx, owner)
		if err != nil || len(settings.PostingSlots) != 5 || settings.RequireApproval {
			t.Fatalf("defaults=%+v err=%v", settings, err)
		}
		// Every day at 07:30 UTC (the workspace has no time zone set).
		slots := []schema.QueueSlot{}
		for day := 0; day < 7; day++ {
			slots = append(slots, schema.QueueSlot{Weekday: day, Time: "07:30"})
		}
		if _, err := repo.UpdateContentDraftSettings(ctx, owner, ContentDraftSettingsUpdate{PostingSlots: &slots}); err != nil {
			t.Fatal(err)
		}
		bad := []schema.QueueSlot{{Weekday: 9, Time: "25:00"}}
		if _, err := repo.UpdateContentDraftSettings(ctx, owner, ContentDraftSettingsUpdate{PostingSlots: &bad}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("bad slot err=%v", err)
		}
		first, err := repo.NextQueueSlot(ctx, owner, "")
		if err != nil || first.Hour() != 7 || first.Minute() != 30 || !first.After(time.Now()) {
			t.Fatalf("first=%v err=%v", first, err)
		}
		if _, err := schedule(newDraft("Queued one"), first); err != nil {
			t.Fatal(err)
		}
		second, err := repo.NextQueueSlot(ctx, owner, "")
		if err != nil || !second.Equal(first.Add(24*time.Hour)) {
			t.Fatalf("second=%v first=%v err=%v", second, first, err)
		}
	})

	t.Run("a queued post moves without another charge", func(t *testing.T) {
		result, err := schedule(newDraft("Move me"), at)
		if err != nil {
			t.Fatal(err)
		}
		total := func() (sum int64) {
			for _, used := range meter.used {
				sum += used
			}
			return sum
		}
		charged := total()
		later := at.Add(3 * time.Hour)
		moved, err := repo.MoveContentDraftPost(ctx, owner, result.Posts[0].ID, later)
		if err != nil || moved.Cancelled != result.Posts[0].ID || !moved.Post.ScheduledFor.Equal(later) || total() != charged {
			t.Fatalf("moved=%+v err=%v charges=%d/%d", moved, err, total(), charged)
		}
		if _, err := repo.MoveContentDraftPost(ctx, owner, result.Posts[0].ID, later); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("moving a cancelled post err=%v", err)
		}
		calendar, err := repo.ListContentDraftPostsBetween(ctx, owner, at, at.Add(24*time.Hour), "")
		if err != nil || len(calendar) != 1 || calendar[0].DraftTitle != "Move me" {
			t.Fatalf("calendar=%+v err=%v", calendar, err)
		}
	})

	t.Run("approval gates scheduling at the approved version", func(t *testing.T) {
		required := true
		if _, err := repo.UpdateContentDraftSettings(ctx, owner, ContentDraftSettingsUpdate{RequireApproval: &required}); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			off := false
			_, _ = repo.UpdateContentDraftSettings(ctx, owner, ContentDraftSettingsUpdate{RequireApproval: &off})
		})
		draft := newDraft("Needs review")
		if _, err := schedule(draft, at); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("unreviewed schedule err=%v", err)
		}
		if _, err := repo.ReviewContentDraft(ctx, owner, draft.ID, ContentDraftReviewInput{Action: "request"}); err != nil {
			t.Fatal(err)
		}
		approved, err := repo.ReviewContentDraft(ctx, owner, draft.ID, ContentDraftReviewInput{Action: "approve", Note: "Ship it"})
		if err != nil || approved.ReviewStatus != "approved" || approved.ApprovedVersion == nil || *approved.ApprovedVersion != draft.Version {
			t.Fatalf("approved=%+v err=%v", approved, err)
		}
		title := "Edited after approval"
		edited, err := repo.UpdateContentDraft(ctx, owner, draft.ID, ContentDraftUpdate{BaseVersion: draft.Version, Title: &title})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := schedule(edited, at); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("schedule after an edit err=%v", err)
		}
		if _, err := repo.ReviewContentDraft(ctx, owner, draft.ID, ContentDraftReviewInput{Action: "approve"}); err != nil {
			t.Fatal(err)
		}
		if _, err := schedule(edited, at.Add(time.Hour)); err != nil {
			t.Fatalf("approved schedule err=%v", err)
		}
	})

	t.Run("a share link reads the draft and takes guest comments", func(t *testing.T) {
		draft := newDraft("Shared")
		shared, err := repo.ShareContentDraft(ctx, owner, draft.ID, true)
		if err != nil || shared.ShareToken == nil {
			t.Fatalf("shared=%+v err=%v", shared, err)
		}
		view, err := repo.AddGuestComment(ctx, *shared.ShareToken, GuestCommentInput{Name: "Ana", Text: "Love it"})
		if err != nil || view.Title != "Shared" || len(view.GuestComments) != 1 || view.GuestComments[0]["name"] != "Ana" {
			t.Fatalf("view=%+v err=%v", view, err)
		}
		if _, err := repo.AddGuestComment(ctx, *shared.ShareToken, GuestCommentInput{Name: "", Text: "x"}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("nameless comment err=%v", err)
		}
		if _, err := repo.ShareContentDraft(ctx, owner, draft.ID, false); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.GetSharedContentDraft(ctx, *shared.ShareToken); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("revoked link err=%v", err)
		}
	})

	t.Run("revisions keep the draft as it was", func(t *testing.T) {
		draft := newDraft("First words")
		title := "Second words"
		if _, err := repo.UpdateContentDraft(ctx, owner, draft.ID, ContentDraftUpdate{BaseVersion: draft.Version, Title: &title}); err != nil {
			t.Fatal(err)
		}
		revisions, err := repo.ListContentDraftRevisions(ctx, owner, draft.ID)
		if err != nil || len(revisions) != 1 || revisions[0].Title != "Second words" {
			t.Fatalf("revisions=%+v err=%v", revisions, err)
		}
		one, err := repo.GetContentDraftRevision(ctx, owner, draft.ID, revisions[0].ID)
		if err != nil || one.Body == nil {
			t.Fatalf("revision=%+v err=%v", one, err)
		}
	})

	t.Run("a stopped thread resumes from its last live reply", func(t *testing.T) {
		draft := newDraft("Thread")
		result, err := repo.ScheduleContentDraft(ctx, owner, draft.ID, ScheduleContentDraftInput{ScheduledFor: at, Version: draft.Version,
			Targets: []ContentDraftScheduleTarget{{Caption: "One", ChannelConnectionID: connection.ID,
				Replies: []thread.Reply{{Caption: "Two"}, {Caption: "Three"}, {Caption: "Four"}}}}})
		if err != nil {
			t.Fatal(err)
		}
		postID := result.Posts[0].ID
		if _, err := repo.ResumeContentDraftThread(ctx, owner, postID); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("resume before live err=%v", err)
		}
		if _, err := db.Client.ScheduledPost.UpdateOneID(postID).SetStatus(scheduledpost.StatusPUBLISHED).SetRemotePostID("remote-1").
			SetThreadProgress(postoptions.ThreadProgress{LastReplyID: "remote-2", Posted: 1, Total: 3}).Save(ctx); err != nil {
			t.Fatal(err)
		}
		resumed, err := repo.ResumeContentDraftThread(ctx, owner, postID)
		if err != nil || resumed.Scheduled.Caption != "Three" || resumed.Scheduled.ReplyTo == nil ||
			*resumed.Scheduled.ReplyTo != "remote-2" || len(resumed.Scheduled.Replies) != 1 {
			t.Fatalf("resumed=%+v err=%v", resumed, err)
		}
		posts, err := repo.ListContentDraftPosts(ctx, owner, draft.ID)
		if err != nil || len(posts) != 2 || !strings.HasPrefix(*posts[1].URL, "https://x.com/i/status/remote-1") {
			t.Fatalf("posts=%+v err=%v", posts, err)
		}
		best, err := repo.BestPostingTimes(ctx, owner, "")
		if err != nil || len(best) != 3 || !best[0].At.After(time.Now()) {
			t.Fatalf("best=%+v err=%v", best, err)
		}
	})
}
