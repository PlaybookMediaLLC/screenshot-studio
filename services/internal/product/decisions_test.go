package product

import (
	"context"
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Approving, scheduling, and announcing are decisions a person makes. The
// backend refuses every other principal before it touches the database.
func TestDecisionsRefuseNonSessionActors(t *testing.T) {
	ctx := context.Background()
	repo := &Configuration{}
	entrypoints := map[string]func(Actor) error{
		"DecideCreativeVariant": func(a Actor) error {
			_, err := repo.DecideCreativeVariant(ctx, a, "variant", CreativeApprovalInput{Status: "APPROVED"})
			return err
		},
		"ApproveLaunchSpec": func(a Actor) error { _, err := repo.ApproveLaunchSpec(ctx, a, "spec"); return err },
		"ApproveLaunchPlan": func(a Actor) error { _, err := repo.ApproveLaunchPlan(ctx, a, "plan"); return err },
		"ScheduleCampaignPost": func(a Actor) error {
			_, err := repo.ScheduleCampaignPost(ctx, a, "campaign", "post", ScheduleCampaignPostInput{ChannelConnectionID: "c"})
			return err
		},
		"ScheduleAnnouncement": func(a Actor) error {
			_, err := repo.ScheduleAnnouncement(ctx, a, ScheduleAnnouncementInput{IdempotencyKey: "k", ReleaseDocumentID: "d"})
			return err
		},
		"CancelAnnouncement": func(a Actor) error { _, err := repo.CancelAnnouncement(ctx, a, "announcement"); return err },
		"TransitionCampaign": func(a Actor) error {
			_, err := repo.TransitionCampaign(ctx, a, "campaign", "APPROVED")
			return err
		},
		"ApproveCampaignDesign": func(a Actor) error {
			_, err := repo.ApproveCampaignDesign(ctx, a, "campaign", "design")
			return err
		},
	}
	for _, decision := range []string{"approve", "reject", "request_changes"} {
		entrypoints["TransitionCampaignPosts/"+decision] = func(a Actor) error {
			_, err := repo.TransitionCampaignPosts(ctx, a, "campaign", CampaignPostDecision{Decision: decision})
			return err
		}
	}
	for _, kind := range []string{"api_key", "support", "webhook", "service"} {
		actor := Actor{OrganizationID: "org", Kind: kind, KeyID: "key", GrantID: "grant", UserID: "user"}
		for name, call := range entrypoints {
			if err := call(actor); !errors.Is(err, publishing.ErrForbidden) {
				t.Errorf("%s as %s: err=%v, want ErrForbidden", name, kind, err)
			}
		}
	}
}
