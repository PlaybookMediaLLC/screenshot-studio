package product

import (
	"errors"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestFreeSchedulingLimitsAndUpgrade(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo := w.ctx, w.repo.WithMonthlyMeter(&recordingMonthlyMeter{})
	add := socialCredentialFixture(t, ctx, w.db.SQL, w.org)
	add("free-x-"+w.id, "x")
	conn, err := repo.auth.CreateConnection(ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, Type: "USER"}, publishing.CreateConnectionInput{ExternalAccountID: "free-x-" + w.id, Platform: "x", SecretReference: "SOCIAL_API_KEY", ProviderSettings: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.RequireChannel(ctx, w.org, "second"); err == nil {
		t.Fatal("free second channel admitted")
	}
	if err := repo.RequireSeat(ctx, w.org, true); err == nil {
		t.Fatal("free second seat admitted")
	}
	if repo.workspaceAIEnabled(ctx, w.org) {
		t.Fatal("free AI enabled")
	}
	if _, err := repo.ConsumeWorkspaceQuota(ctx, w.owner, QuotaAICredits, 1); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("free AI credits: %v", err)
	}
	create := func() *ContentDraftRecord {
		t.Helper()
		d, e := repo.CreateContentDraft(ctx, w.owner, ContentDraftInput{Title: "Free scheduled post"})
		if e != nil {
			t.Fatal(e)
		}
		return d
	}
	input := func(d *ContentDraftRecord) ScheduleContentDraftInput {
		return ScheduleContentDraftInput{Version: d.Version, ScheduledFor: time.Now().Add(24 * time.Hour), Targets: []ContentDraftScheduleTarget{{ChannelConnectionID: conn.ID, Caption: "A scheduled free post"}}}
	}
	blocked := create()
	for _, variant := range []string{"queue", "natural", "automation"} {
		in := input(blocked)
		switch variant {
		case "queue":
			in.Queue = true
		case "natural":
			b := true
			in.NaturalPostingTime = &b
		case "automation":
			in.Targets[0].AutoActions = &postoptions.AutoActions{RepostAtLikes: 2}
		}
		var gate *FeatureNotEntitledError
		if _, err := repo.ScheduleContentDraft(ctx, w.owner, blocked.ID, in); !errors.As(err, &gate) || gate.Feature != advancedSchedulingFeature {
			t.Fatalf("%s gate: %v", variant, err)
		}
	}
	var paidGate *FeatureNotEntitledError
	if _, err := repo.CreateScheduledPost(ctx, w.owner, publishing.CreateScheduledPostInput{Caption: "Legacy bypass", ContentDraftID: blocked.ID, ChannelConnectionID: conn.ID, IdempotencyKey: "free-legacy", ScheduledFor: time.Now().Add(time.Hour)}); !errors.As(err, &paidGate) || paidGate.Feature != "workspace:paid" {
		t.Fatalf("free legacy scheduler: %v", err)
	}
	if _, err := repo.SwapContentDraftPosts(ctx, w.owner, "one", "two"); !errors.As(err, &paidGate) || paidGate.Feature != advancedSchedulingFeature {
		t.Fatalf("free queue swap: %v", err)
	}
	if _, err := repo.NextQueueSlot(ctx, w.owner, ""); err == nil {
		t.Fatal("free next slot")
	}
	if _, err := repo.BestPostingTimes(ctx, w.owner, ""); err == nil {
		t.Fatal("free suggested times")
	}
	slots := []schema.QueueSlot{{Weekday: 1, Time: "09:00"}}
	if _, err := repo.UpdateContentDraftSettings(ctx, w.owner, ContentDraftSettingsUpdate{PostingSlots: &slots}); err == nil {
		t.Fatal("free queue configuration")
	}
	for i := 0; i < 10; i++ {
		d := create()
		in := input(d)
		result, err := repo.ScheduleContentDraft(ctx, w.owner, d.ID, in)
		if err != nil || !result.Created {
			t.Fatalf("free post %d: %+v %v", i, result, err)
		}
		replay, err := repo.ScheduleContentDraft(ctx, w.owner, d.ID, in)
		if err != nil || replay.Created || replay.Posts[0].ID != result.Posts[0].ID {
			t.Fatalf("replay: %+v %v", replay, err)
		}
	}
	extra := create()
	if _, err := repo.ScheduleContentDraft(ctx, w.owner, extra.ID, input(extra)); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("eleventh post: %v", err)
	}
	posts, err := repo.ListContentDraftPosts(ctx, w.owner, extra.ID)
	if err != nil || len(posts) != 0 {
		t.Fatalf("refused job persisted: %v %v", posts, err)
	}
	subscribe(t, ctx, repo, w.org, "pro")
	in := input(extra)
	in.Queue = true
	if _, err := repo.ScheduleContentDraft(ctx, w.owner, extra.ID, in); err != nil {
		t.Fatalf("upgrade did not unlock queue and allowance: %v", err)
	}
	// Returning to Free does not reset monthly usage.
	if _, err := repo.SyncWorkspaceEntitlement(ctx, EntitlementSyncInput{EventID: "free-downgrade-" + w.id, EventType: "test.downgrade", ExpectedVersion: 1, OrganizationID: w.org, Plan: "free", Provider: "test", Status: "active"}); err != nil {
		t.Fatal(err)
	}
	another := create()
	if _, err := repo.ScheduleContentDraft(ctx, w.owner, another.ID, input(another)); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("downgrade reset usage: %v", err)
	}
}
