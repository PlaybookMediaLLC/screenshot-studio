package notifications

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"sync"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

func TestSocialSetChannelPreferencePrecedence(t *testing.T) {
	kind, setID := "post.published", cuid.New()
	d, _ := activity.Lookup(kind)
	pref, policy := defaultPreferences(), defaultPolicy()
	policy.Events[kind] = Channels{InApp: true, Email: true, Slack: true}
	pref.Events[kind] = Channels{}
	pref.SocialSetChannels[setID] = map[string]map[string]bool{kind: {"email": true, "slack": true}}
	if enabled(policy, pref, d, "in_app", setID) || !enabled(policy, pref, d, "email", setID) || !enabled(policy, pref, d, "slack_dm", setID) {
		t.Fatal("per-set channels did not override the event defaults independently")
	}
	if enabled(policy, pref, d, "email", setID, cuid.New()) {
		t.Fatal("destination selection bypassed the original source set's preference")
	}
	pref.SocialSets[setID] = map[string]bool{kind: false}
	if enabled(policy, pref, d, "email", setID) || enabled(policy, pref, d, "slack_dm", setID) {
		t.Fatal("a legacy opt-out was silently enabled")
	}
	delete(pref.SocialSets, setID)
	policy.Availability = &Channels{InApp: true}
	if enabled(policy, pref, d, "email", setID) || enabled(policy, pref, d, "slack_dm", setID) {
		t.Fatal("per-set preferences bypassed workspace availability")
	}
	for _, bad := range []SocialSetChannels{
		{"not-an-id": {kind: {"email": true}}},
		{setID: {"comment.replied": {"email": true}}},
		{setID: {kind: {"sms": true}}},
	} {
		if validSocialSetChannels(bad) {
			t.Fatal("invalid preference map accepted")
		}
	}
}

func TestSocialSetPreferencesOwnershipCompatibilityAndConflicts(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	shared, private, foreign := cuid.New(), cuid.New(), cuid.New()
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES($1,$2,'Same name',$1),($3,$4,'Same name',$3)`, shared, f.owner.OrganizationID, foreign, f.otherOrg)
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug",visibility,"ownerUserId") VALUES($1,$2,'Same name',$1,'PRIVATE',$3)`, private, f.owner.OrganizationID, f.creator.UserID)
	for _, id := range []string{private, foreign, cuid.New()} {
		input := defaultPreferences()
		input.SocialSetChannels[id] = map[string]map[string]bool{"post.published": {"email": true}}
		if _, err := f.s.SavePreferences(ctx, f.owner, input); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("invisible set preference accepted: %v", err)
		}
	}
	input := defaultPreferences()
	input.SocialSetChannels[shared] = map[string]map[string]bool{"post.published": {"email": false, "slack": true}}
	input.SocialSets[shared] = map[string]bool{"post.auto_plug_published": false}
	// Concurrent tabs cannot silently overwrite one another's channel choices.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := f.s.SavePreferences(ctx, f.owner, input); results <- err }()
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, publishing.ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("concurrent updates: success=%d conflict=%d", success, conflict)
	}
	saved, err := f.s.Settings(ctx, f.owner)
	if err != nil {
		t.Fatal(err)
	}
	legacyClient := saved.Preferences
	legacyClient.SocialSetChannels, legacyClient.SocialSets = nil, nil
	saved, err = f.s.SavePreferences(ctx, f.owner, legacyClient)
	if err != nil || !reflect.DeepEqual(saved.Preferences.SocialSetChannels, input.SocialSetChannels) || !reflect.DeepEqual(saved.Preferences.SocialSets, input.SocialSets) {
		t.Fatal("older client erased stored per-set choices", err)
	}
	other, err := f.s.Settings(ctx, f.creator)
	if err != nil || len(other.Preferences.SocialSetChannels) != 0 {
		t.Fatal("preferences leaked between members", err)
	}
	// A historical opt-out survives a deleted set but cannot be edited to enable it.
	execFixture(t, f, `UPDATE social_set SET "deletedAt"=now() WHERE id=$1`, shared)
	saved, err = f.s.SavePreferences(ctx, f.owner, saved.Preferences)
	if err != nil {
		t.Fatal("unrelated save lost historical choices", err)
	}
	changed := saved.Preferences
	changed.SocialSetChannels[shared]["post.published"]["email"] = true
	if _, err = f.s.SavePreferences(ctx, f.owner, changed); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("deleted set can be changed", err)
	}
	changed.SocialSetChannels, changed.SocialSets = SocialSetChannels{}, map[string]map[string]bool{}
	if _, err = f.s.SavePreferences(ctx, f.owner, changed); err != nil {
		t.Fatal("own historical preferences cannot be cleared", err)
	}
}

func TestSocialSetChannelsRouteIndependentlyWithDuplicateNames(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("RESEND_API_KEY", "fixture")
	setID, draftID, _ := queueDraftNotification(t, f, "")
	second := cuid.New()
	execFixture(t, f, `INSERT INTO social_set(id,"organizationId",name,"publicSlug") VALUES($1,$2,'Queued brand',$1)`, second, f.owner.OrganizationID)
	personalSlackServer(t, f, func(w http.ResponseWriter, r *http.Request) { t.Errorf("unexpected provider request: %s", r.URL.Path) })
	personalSlackFixture(t, f, f.creator, "U123")
	f.s.Send = func(context.Context, Delivery, Envelope) (Outcome, error) { return Outcome{Status: "SUCCEEDED"}, nil }
	pref := defaultPreferences()
	pref.Events["post.published"] = Channels{}
	pref.SocialSetChannels[setID] = map[string]map[string]bool{"post.published": {"inApp": true, "email": false, "slack": true}}
	pref.SocialSetChannels[second] = map[string]map[string]bool{"post.published": {"inApp": false, "email": true, "slack": false}}
	if _, err := f.s.SavePreferences(ctx, f.creator, pref); err != nil {
		t.Fatal(err)
	}
	emit := func(id string, emailMaster bool, want []string) {
		t.Helper()
		execFixture(t, f, `UPDATE content_draft SET "socialSetId"=$2 WHERE id=$1`, draftID, id)
		execFixture(t, f, `INSERT INTO user_preference("userId","emailNotifications") VALUES($1,$2) ON CONFLICT("userId") DO UPDATE SET "emailNotifications"=$2`, f.creator.UserID, emailMaster)
		tx, err := f.s.DB.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if err = emitSQL(ctx, tx, f.owner.OrganizationID, "post.published", "content_draft", draftID, f.owner.UserID, nil); err != nil {
			t.Fatal(err)
		}
		var event string
		if err = tx.QueryRow(`SELECT id FROM outbox_event WHERE "organizationId"=$1 AND type='activity.post.published' ORDER BY "createdAt" DESC,id DESC LIMIT 1`, f.owner.OrganizationID).Scan(&event); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		if err = f.s.Process(ctx); err != nil {
			t.Fatal(err)
		}
		rows, err := f.s.DB.Query(`SELECT channel FROM platform_notification_delivery WHERE event_id=$1 AND destination=$2 ORDER BY channel`, event, f.creator.UserID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		got := []string{}
		for rows.Next() {
			var channel string
			if err = rows.Scan(&channel); err != nil {
				t.Fatal(err)
			}
			got = append(got, channel)
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("set %s master=%t channels=%v want=%v", id, emailMaster, got, want)
		}
	}
	emit(setID, false, []string{"in_app", "slack_dm"})
	emit(second, true, []string{"email"})
	emit(second, false, []string{})
	persisted, err := f.s.Settings(ctx, f.creator)
	if err != nil || !persisted.Preferences.SocialSetChannels[second]["post.published"]["email"] {
		t.Fatal("email master rewrote child preference", err)
	}
}
