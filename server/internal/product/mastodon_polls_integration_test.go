package product

import (
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
	"testing"
	"time"
)

func TestMastodonPollSchedulingChecksVerifiedServerLimits(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithMonthlyMeter(&recordingMonthlyMeter{})
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	external := "mastodon-" + w.id
	socialCredentialFixture(t, w.ctx, w.db.SQL, w.org)(external, "mastodon-custom")
	caps := socialidentity.Capabilities{Version: 1, MaxCharacters: 500, MaxMediaAttachments: 4, CharactersReservedPerURL: 23, MediaMIMETypes: []string{"image/png"}, ImageSizeLimit: 1000000, VideoSizeLimit: 1000000, ImageMatrixLimit: 1000000, VideoMatrixLimit: 1000000, VideoFrameRateLimit: 60, Polls: &socialidentity.PollLimits{MaxOptions: 6, MaxOptionCharacters: 80, MinDurationSeconds: 300, MaxDurationSeconds: 604800}}
	encoded, _ := json.Marshal(caps)
	w.exec(t, `UPDATE "Integration" SET "internalId"='mastodon:fixture.social:123',"verifiedAccountKey"='mastodon:fixture.social:123',"verifiedAccountKind"='profile',"verifiedScopes"='["read","write"]',"verifiedCapabilities"=$2,"identityVerifiedAt"=now() WHERE id=$1`, external, string(encoded))
	connection, err := w.repo.auth.CreateConnection(w.ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, RequestID: w.owner.RequestID, Type: "USER"}, publishing.CreateConnectionInput{ExternalAccountID: external, Platform: "mastodon-custom", ProviderSettings: map[string]any{}, SecretReference: "SOCIAL_API_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"valid", "duration", "unknown"} {
		t.Run(scenario, func(t *testing.T) {
			w.exec(t, `UPDATE "Integration" SET "verifiedCapabilities"=$2 WHERE id=$1`, external, string(encoded))
			poll := &postoptions.Poll{Options: []string{"A", "B", "C", "D", "E"}, DurationMinutes: 10, Multiple: true}
			if scenario == "duration" {
				poll.DurationMinutes = 1
			}
			if scenario == "unknown" {
				without := caps
				without.Polls = nil
				data, _ := json.Marshal(without)
				w.exec(t, `UPDATE "Integration" SET "verifiedCapabilities"=$2 WHERE id=$1`, external, string(data))
			}
			draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{PlainText: "Choose"})
			if err != nil {
				t.Fatal(err)
			}
			at := time.Now().Add(time.Hour)
			result, err := w.repo.ScheduleContentDraft(w.ctx, w.owner, draft.ID, ScheduleContentDraftInput{Version: draft.Version, ScheduledFor: at, Targets: []ContentDraftScheduleTarget{{ChannelConnectionID: connection.ID, Caption: "Choose", Poll: poll}}})
			if scenario != "valid" {
				if err == nil {
					t.Fatal("invalid poll scheduled")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Posts) != 1 {
				t.Fatalf("posts: %+v", result)
			}
			stored, err := w.db.Client.ScheduledPost.Get(w.ctx, result.Posts[0].ID)
			if err != nil {
				t.Fatal(err)
			}
			if !stored.Poll.Multiple || len(stored.Poll.Options) != 5 {
				t.Fatalf("poll lost: %+v", result)
			}
		})
	}
}
