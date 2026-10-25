package product

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"time"
)

// SwapContentDraftPosts atomically exchanges two future queue positions. Old
// workflow receipts are cancelled; replacement timers retain the full payload.
func (c *Configuration) SwapContentDraftPosts(ctx context.Context, actor Actor, first, second string) ([]*MovedDraftPost, error) {
	if err := c.authorizeScheduling(ctx, actor); err != nil {
		return nil, err
	}
	if err := c.requireWorkspaceFeature(ctx, actor.OrganizationID, contentDraftFeature); err != nil {
		return nil, err
	}
	if first == second {
		return nil, invalid("Choose two different posts.")
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Every swap locks in the same order, including opposite-direction drags.
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM scheduled_post WHERE id IN ($1,$2) AND "organizationId"=$3 ORDER BY id FOR UPDATE`, first, second, actor.OrganizationID); err != nil {
		return nil, err
	}
	posts, err := tx.ScheduledPost.Query().Where(scheduledpost.IDIn(first, second), scheduledpost.OrganizationID(actor.OrganizationID), scheduledpost.ContentDraftIDNotNil()).Order(ent.Asc(scheduledpost.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	if len(posts) != 2 {
		return nil, publishing.ErrNotFound
	}
	for _, post := range posts {
		if err := requireVisibleDraftPost(ctx, tx.Client(), actor, post); err != nil {
			return nil, err
		}
		if post.Status != scheduledpost.StatusSCHEDULED || !post.ScheduledFor.After(time.Now().Add(time.Minute)) {
			return nil, conflict("Only future queued posts can exchange times. Refresh the calendar.")
		}
	}
	if posts[0].SocialSetID == nil || posts[1].SocialSetID == nil || *posts[0].SocialSetID != *posts[1].SocialSetID {
		return nil, invalid("Swap posts within the same social set.")
	}
	a, err := c.moveDraftPostInTransaction(ctx, tx, actor, posts[0].ID, posts[1].ScheduledFor)
	if err != nil {
		return nil, err
	}
	b, err := c.moveDraftPostInTransaction(ctx, tx, actor, posts[1].ID, posts[0].ScheduledFor)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return []*MovedDraftPost{a, b}, nil
}
