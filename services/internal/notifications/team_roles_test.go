package notifications

import (
	"context"
	"slices"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
)

// Review requests follow approval authority; publication updates include the
// additive writer/publisher role. The actor does not receive their own event.
func TestCollaborationNotificationRoles(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	for _, role := range []string{"admin", "creator", "approver", "publisher", "writer_publisher", "viewer"} {
		t.Run(role, func(t *testing.T) {
			execFixture(t, f, `UPDATE member SET role=$1 WHERE "organizationId"=$2 AND "userId"=$3`, role, f.creator.OrganizationID, f.creator.UserID)
			for _, tc := range []struct {
				kind string
				want bool
			}{
				{"draft.review_requested", role == "admin" || role == "approver"},
				{"post.scheduled", role == "publisher" || role == "writer_publisher"},
			} {
				definition, ok := activity.Lookup(tc.kind)
				if !ok {
					t.Fatal("unknown event", tc.kind)
				}
				recipients, err := f.s.recipients(ctx, occurrence{org: f.creator.OrganizationID, payload: map[string]any{"actorUserId": f.owner.UserID}}, definition)
				if err != nil {
					t.Fatal(err)
				}
				if slices.Contains(recipients, f.creator.UserID) != tc.want || slices.Contains(recipients, f.owner.UserID) {
					t.Fatalf("%s recipients=%v wanted member=%v", tc.kind, recipients, tc.want)
				}
			}
			if _, err := f.s.ListFeed(ctx, f.creator, "inbox", ""); err != nil {
				t.Fatalf("member cannot read own inbox: %v", err)
			}
		})
	}
}
