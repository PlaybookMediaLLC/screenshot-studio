package product

import (
	"context"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// PostScheduleScope is the API-key scope that schedules and cancels posts
// (RFC 038). It schedules only what a person already approved.
const PostScheduleScope = "post:schedule"

// authorizeScheduling admits a publisher's session, or an API key the backend
// itself finds was issued with post:schedule. Approving stays with a person:
// the scheduling paths accept only approved posts and variants.
func (c *Configuration) authorizeScheduling(ctx context.Context, actor Actor) error {
	switch {
	case actor.IsSession():
		return c.authorizeRoles(ctx, actor, "owner", "admin", "publisher")
	case actor.Kind == "api_key":
		return c.auth.AuthorizeAPIKeyScope(ctx, actor.OrganizationID, actor.KeyID, PostScheduleScope)
	}
	return publishing.ErrForbidden
}

// CreateScheduledPost schedules an approved variant, or for a session a
// content draft, to a channel connection and charges the monthly posts
// allowance. A replay of the same idempotency
// key returns the first post and is not charged again.
func (c *Configuration) CreateScheduledPost(ctx context.Context, actor Actor,
	input publishing.CreateScheduledPostInput) (publishing.CreateScheduledPostResult, error) {
	input.Caption = strings.TrimSpace(input.Caption)
	if input.Caption == "" || input.IdempotencyKey == "" || !input.ScheduledFor.After(time.Now()) {
		return publishing.CreateScheduledPostResult{}, ErrInvalidInput
	}
	if err := c.authorizeScheduling(ctx, actor); err != nil {
		return publishing.CreateScheduledPostResult{}, err
	}
	// A content draft has no approval step, so only a person schedules one
	// (RFC 037). A key schedules approved campaign variants only.
	if input.ContentDraftID != "" && !actor.IsSession() {
		return publishing.CreateScheduledPostResult{}, publishing.ErrForbidden
	}
	refund, err := c.ChargeMonthlyQuota(ctx, actor.OrganizationID, QuotaPosts, 1)
	if err != nil {
		return publishing.CreateScheduledPostResult{}, err
	}
	result, err := c.auth.CreateScheduledPost(ctx, actor.auditActor(), input)
	if err != nil || !result.Created {
		refund()
	}
	return result, err
}
