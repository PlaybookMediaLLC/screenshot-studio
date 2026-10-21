package product

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/draftdoc"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
)

// standings is a fake account standing reader: Premium by external id.
type standings map[string]bool

func (s standings) AccountStanding(_ context.Context, _, destinationID, _, _ string) (AccountStanding, error) {
	return AccountStanding{Premium: s[destinationID]}, nil
}

// Mentions answers with the account and query it was asked with.
func (s standings) Mentions(_ context.Context, _, destinationID, platform, _, query string) ([]Mention, error) {
	return []Mention{{Kind: "person", Label: destinationID, ProviderID: platform + ":" + query}}, nil
}

// Planning, scheduling and publishing (RFC 042): the time is resolved in Go,
// queue slots are reserved under a lock, each platform's settings are checked
// against its own rules, an account is Premium only when its platform says
// so, and a failed or unknown destination is recovered alone.
func TestWritePublishing(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, owner := w.ctx, w.owner
	repo := w.repo.WithAccountStanding(standings{"x-premium-" + w.id: true}).WithMonthlyMeter(&recordingMonthlyMeter{})
	subscribe(t, ctx, repo, w.org, "pro")
	// The Premium account has a set of its own: one X account per set. The
	// workspace's default set is its oldest, so it comes first.
	if _, err := repo.ListSocialSets(ctx, owner); err != nil {
		t.Fatal(err)
	}
	premiumSet, err := repo.CreateSocialSet(ctx, owner, SocialSetInput{Name: "Premium"})
	if err != nil {
		t.Fatal(err)
	}
	addCredential := socialCredentialFixture(t, ctx, w.db.SQL, w.org)
	connect := func(platform, external string, setID *string) string {
		t.Helper()
		addCredential(external, platform)
		connection, err := repo.auth.CreateConnection(ctx, publishing.Actor{Organization: w.org, UserID: owner.UserID, RequestID: owner.RequestID, Type: "USER"},
			publishing.CreateConnectionInput{ExternalAccountID: external, Platform: platform, ProviderSettings: map[string]any{},
				SecretReference: "SOCIAL_API_KEY", SocialSetID: setID})
		if err != nil {
			t.Fatal(err)
		}
		return connection.ID
	}
	x, linkedin := connect("x", "x-standard-"+w.id, nil), connect("linkedin", "li-"+w.id, nil)
	premium, premiumLinkedIn := connect("x", "x-premium-"+w.id, &premiumSet.ID), connect("linkedin", "li-premium-"+w.id, &premiumSet.ID)
	draft := func(input ContentDraftInput) *ContentDraftRecord {
		t.Helper()
		created, err := repo.CreateContentDraft(ctx, owner, input)
		if err != nil {
			t.Fatal(err)
		}
		return created
	}
	target := func(caption, connection string) []ContentDraftScheduleTarget {
		return []ContentDraftScheduleTarget{{Caption: caption, ChannelConnectionID: connection}}
	}
	posts := func(draftID string) []ContentDraftPost {
		t.Helper()
		items, err := repo.ListContentDraftPosts(ctx, owner, draftID)
		if err != nil {
			t.Fatal(err)
		}
		return items
	}

	t.Run("publish now goes out now, once, and keeps a backup", func(t *testing.T) {
		d := draft(ContentDraftInput{})
		input := ScheduleContentDraftInput{PublishNow: true, Targets: target("Live now", x), Version: 1}
		result, err := repo.ScheduleContentDraft(ctx, owner, d.ID, input)
		if err != nil || len(result.Posts) != 1 || time.Since(result.Posts[0].ScheduledFor) > time.Minute {
			t.Fatalf("publish now=%+v err=%v", result, err)
		}
		replay, err := repo.ScheduleContentDraft(ctx, owner, d.ID, input)
		if err != nil || replay.Created || len(posts(d.ID)) != 1 {
			t.Fatalf("a second click published again: %+v err=%v", replay, err)
		}
		revisions, _ := repo.ListContentDraftRevisions(ctx, owner, d.ID)
		if len(revisions) != 1 || revisions[0].Reason != "publish" {
			t.Fatalf("revisions=%+v", revisions)
		}
		if _, err := repo.ScheduleContentDraft(ctx, owner, draft(ContentDraftInput{}).ID, ScheduleContentDraftInput{PublishNow: true, Queue: true,
			Targets: target("x", x), Version: 1}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("now and queued at once: %v", err)
		}
	})

	t.Run("a local time is resolved in its zone; skipped and repeated times are explained", func(t *testing.T) {
		d := draft(ContentDraftInput{})
		local := ScheduleContentDraftInput{LocalTime: "2030-07-01T12:00", TimeZone: "Europe/Paris", Targets: target("Paris noon", x), Version: 1}
		result, err := repo.ScheduleContentDraft(ctx, owner, d.ID, local)
		if err != nil || !result.Posts[0].ScheduledFor.Equal(time.Date(2030, 7, 1, 10, 0, 0, 0, time.UTC)) {
			t.Fatalf("local=%+v err=%v", result, err)
		}
		gap := draft(ContentDraftInput{})
		var skipped *LocalTimeError
		_, err = repo.ScheduleContentDraft(ctx, owner, gap.ID, ScheduleContentDraftInput{LocalTime: "2030-03-10T02:30",
			TimeZone: "America/New_York", Targets: target("gap", x), Version: 1})
		if !errors.As(err, &skipped) || skipped.Kind != "gap" {
			t.Fatalf("a skipped time: %v", err)
		}
		repeated := ScheduleContentDraftInput{LocalTime: "2030-11-03T01:30", TimeZone: "America/New_York", Targets: target("repeat", x), Version: 1}
		var twice *LocalTimeError
		if _, err := repo.ScheduleContentDraft(ctx, owner, gap.ID, repeated); !errors.As(err, &twice) || twice.Kind != "ambiguous" {
			t.Fatalf("a repeated time: %v", err)
		}
		repeated.Disambiguation = "later"
		later, err := repo.ScheduleContentDraft(ctx, owner, gap.ID, repeated)
		if err != nil || !later.Posts[0].ScheduledFor.Equal(time.Date(2030, 11, 3, 6, 30, 0, 0, time.UTC)) {
			t.Fatalf("the later of two: %+v err=%v", later, err)
		}
		past := draft(ContentDraftInput{})
		if _, err := repo.ScheduleContentDraft(ctx, owner, past.ID, ScheduleContentDraftInput{LocalTime: "2020-01-01T09:00",
			TimeZone: "UTC", Targets: target("past", x), Version: 1}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("a past time: %v", err)
		}
	})

	t.Run("simultaneous queue requests take different slots", func(t *testing.T) {
		if _, err := repo.UpdateContentDraftSettings(ctx, owner, ContentDraftSettingsUpdate{PostingSlots: &[]schema.QueueSlot{
			{Weekday: 0, Time: "09:00"}, {Weekday: 1, Time: "09:00"}, {Weekday: 2, Time: "09:00"}, {Weekday: 3, Time: "09:00"},
			{Weekday: 4, Time: "09:00"}, {Weekday: 5, Time: "09:00"}, {Weekday: 6, Time: "09:00"}}}); err != nil {
			t.Fatal(err)
		}
		drafts := []*ContentDraftRecord{draft(ContentDraftInput{}), draft(ContentDraftInput{}), draft(ContentDraftInput{}), draft(ContentDraftInput{})}
		var group sync.WaitGroup
		times := make([]time.Time, len(drafts))
		errs := make([]error, len(drafts))
		for index, d := range drafts {
			group.Add(1)
			go func() {
				defer group.Done()
				result, err := repo.ScheduleContentDraft(ctx, owner, d.ID, ScheduleContentDraftInput{Queue: true,
					Targets: target("queued", linkedin), Version: 1})
				errs[index] = err
				if err == nil {
					times[index] = result.Posts[0].ScheduledFor
				}
			}()
		}
		group.Wait()
		seen := map[int64]bool{}
		for index, at := range times {
			if errs[index] != nil {
				t.Fatalf("queue request %d: %v", index, errs[index])
			}
			if seen[at.Unix()] {
				t.Fatalf("two drafts took the slot %v", at)
			}
			seen[at.Unix()] = true
		}
	})

	t.Run("scheduling a planned draft clears its plan", func(t *testing.T) {
		d := draft(ContentDraftInput{})
		plan := time.Now().Add(72 * time.Hour)
		if _, err := repo.PlanContentDraft(ctx, owner, d.ID, ContentDraftPlanInput{PlannedFor: &plan, TimeZone: "UTC"}); err != nil {
			t.Fatal(err)
		}
		result, err := repo.ScheduleContentDraft(ctx, owner, d.ID, ScheduleContentDraftInput{ScheduledFor: plan, Targets: target("planned", x), Version: 1})
		if err != nil || result.Draft.PlannedFor != nil {
			t.Fatalf("scheduled=%+v err=%v", result, err)
		}
	})

	t.Run("each platform's settings are checked against its own rules and kept on the post", func(t *testing.T) {
		at := time.Now().Add(6 * time.Hour)
		schedule := func(kind string, targets []ContentDraftScheduleTarget) (*ScheduleContentDraftResult, error) {
			d := draft(ContentDraftInput{Kind: kind, Target: kindTarget(kind)})
			return repo.ScheduleContentDraft(ctx, owner, d.ID, ScheduleContentDraftInput{ScheduledFor: at, Targets: targets, Version: 1})
		}
		withOptions := func(connection string, options postoptions.PublishOptions, poll *postoptions.Poll) []ContentDraftScheduleTarget {
			return []ContentDraftScheduleTarget{{Caption: "Settings", ChannelConnectionID: connection, Options: &options, Poll: poll}}
		}
		ok, err := schedule("standard", append(withOptions(x, postoptions.PublishOptions{ReplySettings: "following", MadeWithAI: true}, nil),
			ContentDraftScheduleTarget{Caption: "LinkedIn", ChannelConnectionID: linkedin, Options: &postoptions.PublishOptions{Visibility: "CONNECTIONS", PollQuestion: "Ship it?"},
				Poll: &postoptions.Poll{DurationMinutes: 3 * 24 * 60, Options: []string{"Yes", "No"}}}))
		if err != nil {
			t.Fatal(err)
		}
		stored, err := w.db.Client.ScheduledPost.Query().Where(scheduledpost.IDIn(ok.Posts[0].ID, ok.Posts[1].ID)).All(ctx)
		if err != nil || len(stored) != 2 {
			t.Fatal(err)
		}
		for _, post := range stored {
			if post.ChannelConnectionID == x && (post.PublishOptions.ReplySettings != "following" || !post.PublishOptions.MadeWithAI) {
				t.Fatalf("X settings were not kept: %+v", post.PublishOptions)
			}
			if post.ChannelConnectionID == linkedin && post.PublishOptions.Visibility != "CONNECTIONS" {
				t.Fatalf("LinkedIn settings were not kept: %+v", post.PublishOptions)
			}
		}
		for name, targets := range map[string][]ContentDraftScheduleTarget{
			"visibility on X":            withOptions(x, postoptions.PublishOptions{Visibility: "PUBLIC"}, nil),
			"reply settings on LinkedIn": withOptions(linkedin, postoptions.PublishOptions{ReplySettings: "verified"}, nil),
			"an unknown reply setting":   withOptions(x, postoptions.PublishOptions{ReplySettings: "friends"}, nil),
			"a LinkedIn poll with no question": withOptions(linkedin, postoptions.PublishOptions{},
				&postoptions.Poll{DurationMinutes: 24 * 60, Options: []string{"a", "b"}}),
			"a LinkedIn poll of 2 hours": withOptions(linkedin, postoptions.PublishOptions{PollQuestion: "Q?"},
				&postoptions.Poll{DurationMinutes: 120, Options: []string{"a", "b"}}),
			"an X poll choice of 26 characters": withOptions(x, postoptions.PublishOptions{},
				&postoptions.Poll{DurationMinutes: 60, Options: []string{strings.Repeat("a", 26), "b"}}),
			"a document that is not an asset": withOptions(linkedin, postoptions.PublishOptions{DocumentAssetID: "cnotanasset0000000000"}, nil),
			"the first post quoting itself":   withOptions(x, postoptions.PublishOptions{QuoteFirstPost: true}, nil),
			"a community on LinkedIn":         withOptions(linkedin, postoptions.PublishOptions{CommunityID: "123"}, nil),
		} {
			if _, err := schedule("standard", targets); !errors.Is(err, ErrInvalidInput) {
				t.Errorf("%s accepted: %v", name, err)
			}
		}
		if _, err := schedule("standard", []ContentDraftScheduleTarget{{Caption: "Q", ChannelConnectionID: linkedin,
			Options: &postoptions.PublishOptions{PollQuestion: "Which?"}, Poll: &postoptions.Poll{DurationMinutes: 7 * 24 * 60, Options: []string{"a", "b"}}}}); err != nil {
			t.Fatalf("a valid LinkedIn poll: %v", err)
		}
		// A reply in a thread may quote the first post; the first may not.
		quoting := []ContentDraftScheduleTarget{{Caption: "Root", ChannelConnectionID: x,
			Replies: []thread.Reply{{Caption: "Finisher", Options: &postoptions.PublishOptions{QuoteFirstPost: true}}}}}
		if _, err := schedule("standard", quoting); err != nil {
			t.Fatalf("a finisher quoting the first post: %v", err)
		}
	})

	t.Run("kinds publish only as they can", func(t *testing.T) {
		at := time.Now().Add(6 * time.Hour)
		schedule := func(kind string, targets []ContentDraftScheduleTarget) error {
			input := ContentDraftInput{Kind: kind, Target: kindTarget(kind)}
			if targets[0].ChannelConnectionID == premium {
				input.SocialSetID = premiumSet.ID
			}
			d := draft(input)
			_, err := repo.ScheduleContentDraft(ctx, owner, d.ID, ScheduleContentDraftInput{ScheduledFor: at, Targets: targets, Version: 1})
			return err
		}
		if err := schedule("reply", target("No target id", x)); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("a reply without the post it answers: %v", err)
		}
		if err := schedule("reply", []ContentDraftScheduleTarget{{Caption: "Agreed", ChannelConnectionID: x, ReplyTo: "1234567890"}}); err != nil {
			t.Fatalf("a reply: %v", err)
		}
		if err := schedule("quote", target("No quote", x)); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("a quote without the quoted post: %v", err)
		}
		article := func(connection string) []ContentDraftScheduleTarget {
			return []ContentDraftScheduleTarget{{Caption: strings.Repeat("Long form. ", 100), ChannelConnectionID: connection,
				Options: &postoptions.PublishOptions{ArticleTitle: "Why we built it"}}}
		}
		if err := schedule("article", article(x)); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("an article from a standard account: %v", err)
		}
		if err := schedule("article", article(premium)); err != nil {
			t.Fatalf("an article from a Premium account: %v", err)
		}
		if err := schedule("article", append(article(premium), target("and LinkedIn", premiumLinkedIn)...)); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("an article beside another platform: %v", err)
		}
	})

	t.Run("Premium is the account's: 281 characters on X only from a Premium account", func(t *testing.T) {
		long := strings.Repeat("a", 281)
		standard := draft(ContentDraftInput{})
		if _, err := repo.ScheduleContentDraft(ctx, owner, standard.ID, ScheduleContentDraftInput{PublishNow: true, Targets: target(long, x), Version: 1}); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("a standard account took 281 characters: %v", err)
		}
		fromPremium := draft(ContentDraftInput{SocialSetID: premiumSet.ID})
		if _, err := repo.ScheduleContentDraft(ctx, owner, fromPremium.ID, ScheduleContentDraftInput{PublishNow: true, Targets: target(long, premium), Version: 1}); err != nil {
			t.Fatalf("a Premium account: %v", err)
		}
	})

	t.Run("a failed destination is retried alone, once; an unknown one is reconciled first", func(t *testing.T) {
		d := draft(ContentDraftInput{})
		result, err := repo.ScheduleContentDraft(ctx, owner, d.ID, ScheduleContentDraftInput{PublishNow: true,
			Targets: append(target("To X", x), target("To LinkedIn", linkedin)...), Version: 1})
		if err != nil {
			t.Fatal(err)
		}
		failed, unknown := result.Posts[0].ID, result.Posts[1].ID
		w.exec(t, `UPDATE scheduled_post SET status='FAILED' WHERE id=$1`, failed)
		w.exec(t, `UPDATE scheduled_post SET status='UNKNOWN_DELIVERY' WHERE id=$1`, unknown)
		retried, err := repo.RetryContentDraftPost(ctx, owner, failed)
		if err != nil || retried.Post.ChannelConnectionID != x || retried.Post.Status != "SCHEDULED" {
			t.Fatalf("retried=%+v err=%v", retried, err)
		}
		if _, err := repo.RetryContentDraftPost(ctx, owner, failed); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("a second click retried again: %v", err)
		}
		if _, err := repo.RetryContentDraftPost(ctx, owner, unknown); !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("an unknown outcome was retried blindly: %v", err)
		}
		if _, err := repo.ReconcileContentDraftPost(ctx, owner, unknown, ReconcileInput{Live: true, URL: "https://example.com/nope"}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("a URL from elsewhere: %v", err)
		}
		live, err := repo.ReconcileContentDraftPost(ctx, owner, unknown, ReconcileInput{Live: true,
			URL: "https://www.linkedin.com/feed/update/urn:li:share:7100000000000000000/"})
		if err != nil || live.Status != "PUBLISHED" || live.URL == nil {
			t.Fatalf("live=%+v err=%v", live, err)
		}
		other := draft(ContentDraftInput{})
		again, err := repo.ScheduleContentDraft(ctx, owner, other.ID, ScheduleContentDraftInput{PublishNow: true, Targets: target("Unknown", x), Version: 1})
		if err != nil {
			t.Fatal(err)
		}
		w.exec(t, `UPDATE scheduled_post SET status='UNKNOWN_DELIVERY' WHERE id=$1`, again.Posts[0].ID)
		notLive, err := repo.ReconcileContentDraftPost(ctx, owner, again.Posts[0].ID, ReconcileInput{Live: false})
		if err != nil || notLive.Status != "FAILED" {
			t.Fatalf("not live=%+v err=%v", notLive, err)
		}
		if _, err := repo.RetryContentDraftPost(ctx, owner, again.Posts[0].ID); err != nil {
			t.Fatalf("a post reconciled as not live cannot be retried: %v", err)
		}
		if n, err := w.db.Client.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(d.ID)).Count(ctx); err != nil || n != 3 {
			t.Fatalf("the draft has %d posts, want the two and one retry: %v", n, err)
		}
	})

	t.Run("an image's description is kept on it and limited to X's length", func(t *testing.T) {
		image, pdf := "img_"+w.id, "pdf_"+w.id
		w.exec(t, `INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',68,'UPLOADED',now(),now())`, image, w.org, "org/"+w.org+"/alt.png")
		w.exec(t, `INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'application/pdf',68,'UPLOADED',now(),now())`, pdf, w.org, "org/"+w.org+"/alt.pdf")
		saved, err := repo.SetAssetAltText(ctx, owner, image, "  A chart of weekly signups  ")
		if err != nil || saved.AltText == nil || *saved.AltText != "A chart of weekly signups" {
			t.Fatalf("saved=%+v err=%v", saved, err)
		}
		if _, err := repo.SetAssetAltText(ctx, owner, image, strings.Repeat("a", 1001)); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("over the limit: %v", err)
		}
		if _, err := repo.SetAssetAltText(ctx, owner, pdf, "A deck"); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("a PDF: %v", err)
		}
		if _, err := repo.SetAssetAltText(ctx, w.actor("viewer"), image, "Mine"); err == nil {
			t.Fatal("a viewer described an image")
		}
		cleared, err := repo.SetAssetAltText(ctx, owner, image, "")
		if err != nil || cleared.AltText != nil {
			t.Fatalf("cleared=%+v err=%v", cleared, err)
		}
	})

	t.Run("mentions are looked up with the set's own account", func(t *testing.T) {
		sets, err := repo.ListSocialSets(ctx, owner)
		if err != nil {
			t.Fatal(err)
		}
		found, err := repo.LookupMentions(ctx, owner, sets.Items[0].ID, "x", "@someone")
		if err != nil || len(found) != 1 || found[0].ProviderID != "x:someone" || !strings.HasPrefix(found[0].Label, "x-") {
			t.Fatalf("found=%+v err=%v", found, err)
		}
		if _, err := repo.LookupMentions(ctx, owner, sets.Items[0].ID, "linkedin", "Jane Doe"); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("a person's name on LinkedIn: %v", err)
		}
		if _, err := repo.LookupMentions(ctx, w.actor("viewer"), sets.Items[0].ID, "x", "someone"); err == nil {
			t.Fatal("a viewer looked up mentions")
		}
	})

	t.Run("follow-ups are checked, kept with receipts, and cancelled without stranding a repost", func(t *testing.T) {
		schedule := func(actions postoptions.AutoActions) (*ScheduleContentDraftResult, error) {
			return repo.ScheduleContentDraft(ctx, owner, draft(ContentDraftInput{}).ID, ScheduleContentDraftInput{
				PublishNow: true, Version: 1,
				Targets: []ContentDraftScheduleTarget{{AutoActions: &actions, Caption: "Follow-ups", ChannelConnectionID: x}},
			})
		}
		for name, bad := range map[string]postoptions.AutoActions{
			"six reposts":   {Retweets: make([]postoptions.RetweetRule, 6)},
			"no time":       {Retweets: []postoptions.RetweetRule{{}}},
			"bad zone":      {Retweets: []postoptions.RetweetRule{{At: "10:30", TimeZone: "Mars/Olympus"}}},
			"both forms":    {Retweets: []postoptions.RetweetRule{{AfterMinutes: 60, At: "10:30", TimeZone: "UTC"}}},
			"long removal":  {Retweets: []postoptions.RetweetRule{{AfterMinutes: 60}}, UnretweetAfterMinutes: 8 * 24 * 60},
			"plug on views": {PlugAtLikes: 10, PlugMetric: "views", PlugText: "Guide"},
		} {
			if _, err := schedule(bad); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("%s: %v", name, err)
			}
		}
		actions := postoptions.AutoActions{
			Retweets:              []postoptions.RetweetRule{{AfterMinutes: 360}, {Days: 1, At: "10:30", TimeZone: "Europe/Paris"}},
			UnretweetAfterMinutes: 720, PlugAtLikes: 50, PlugMetric: "reposts", PlugText: "Get the guide",
		}
		result, err := schedule(actions)
		if err != nil {
			t.Fatal(err)
		}
		postID := result.Posts[0].ID
		stored, err := w.db.Client.ScheduledPost.Get(ctx, postID)
		if err != nil || len(stored.AutoActions.Retweets) != 2 || stored.AutoActions.PlugMetric != "reposts" {
			t.Fatalf("stored=%+v err=%v", stored.AutoActions, err)
		}

		store := publishing.NewRepository(w.db.Client)
		now := time.Now()
		receipts := []publishing.AutomationReceipt{
			{DueAt: now, Key: "retweet:0", Kind: "retweet"}, {DueAt: now, Key: "unretweet:0", Kind: "unretweet"},
			{DueAt: now, Key: "retweet:1", Kind: "retweet"}, {DueAt: now, Key: "unretweet:1", Kind: "unretweet"},
			{DueAt: now, Key: "plug", Kind: "plug"}, {DueAt: now.Add(time.Hour), Key: "plug", Kind: "plug"},
		}
		statuses, err := store.PlanAutomations(ctx, w.org, postID, receipts)
		if err != nil || len(statuses) != 5 || statuses["plug"] != "pending" {
			t.Fatalf("planned=%v err=%v", statuses, err)
		}
		if ok, err := store.RecordAutomation(ctx, postID, "retweet:0", "done", "", ""); !ok || err != nil {
			t.Fatalf("record repost: %v %v", ok, err)
		}
		cancelled, err := repo.CancelContentDraftPostAutomations(ctx, owner, postID)
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]string{}
		for _, item := range cancelled.Automations {
			got[item.Key] = item.Status
		}
		want := map[string]string{"retweet:0": "done", "unretweet:0": "pending", "retweet:1": "cancelled",
			"unretweet:1": "pending", "plug": "cancelled"}
		for key, status := range want {
			if got[key] != status {
				t.Fatalf("after cancel %s=%s, want %s (%v)", key, got[key], status, got)
			}
		}
		// A replayed plan keeps the receipts; a cancelled step that never acted stays cancelled.
		if statuses, _ := store.PlanAutomations(ctx, w.org, postID, receipts); statuses["plug"] != "cancelled" {
			t.Fatalf("replanned=%v", statuses)
		}
		if ok, _ := store.RecordAutomation(ctx, postID, "plug", "expired", "", "threshold_not_reached"); ok {
			t.Fatal("a cancelled plug was settled again")
		}
		// A repost in flight when cancelled is recorded as up, so its removal runs.
		if ok, _ := store.RecordAutomation(ctx, postID, "retweet:1", "done", "", ""); !ok {
			t.Fatal("an in-flight repost was not recorded")
		}
		listed := posts(result.Draft.ID)
		if len(listed) != 1 || len(listed[0].Automations) != 5 || listed[0].Automations[0].DueAt.After(listed[0].Automations[4].DueAt) {
			t.Fatalf("listed=%+v", listed)
		}
		if _, err := repo.CancelContentDraftPostAutomations(ctx, w.actor("viewer"), postID); err == nil {
			t.Fatal("a member without publishing rights cancelled follow-ups")
		}
	})
}

// kindTarget is a valid target for a kind of draft in these tests.
func kindTarget(kind string) *draftdoc.Target {
	switch kind {
	case "reply", "quote":
		return &draftdoc.Target{URL: "https://x.com/someone/status/1234567890"}
	}
	return nil
}
