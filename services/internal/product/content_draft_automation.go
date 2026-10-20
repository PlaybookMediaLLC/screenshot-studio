package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/postautomationrun"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/predicate"
)

// A live post's follow-ups (RFC 041) as the composer shows them: what is
// due when, what happened, and a way to stop the ones still pending.

// PostAutomation is one follow-up's receipt. FailureCode is a short code
// (an HTTP status, "threshold_not_reached"), never a provider message.
type PostAutomation struct {
	Attempts    int       `json:"attempts"`
	DueAt       time.Time `json:"dueAt"`
	FailureCode *string   `json:"failureCode"`
	Key         string    `json:"key"`
	Kind        string    `json:"kind"`
	RemoteID    *string   `json:"remoteId"`
	Status      string    `json:"status"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// postAutomations are the posts' follow-ups by post, soonest first.
func (c *Configuration) postAutomations(ctx context.Context, posts ...*ent.ScheduledPost) (map[string][]PostAutomation, error) {
	ids := make([]string, len(posts))
	for index, post := range posts {
		ids[index] = post.ID
	}
	rows, err := c.client.PostAutomationRun.Query().Where(postautomationrun.ScheduledPostIDIn(ids...)).
		Order(ent.Asc(postautomationrun.FieldDueAt), ent.Asc(postautomationrun.FieldKey)).All(ctx)
	if err != nil {
		return nil, err
	}
	byPost := map[string][]PostAutomation{}
	for _, row := range rows {
		byPost[row.ScheduledPostID] = append(byPost[row.ScheduledPostID], PostAutomation{
			Attempts: row.Attempts, DueAt: row.DueAt, FailureCode: row.FailureCode, Key: row.Key,
			Kind: string(row.Kind), RemoteID: row.RemoteID, Status: string(row.Status), UpdatedAt: row.UpdatedAt,
		})
	}
	return byPost, nil
}

// CancelContentDraftPostAutomations stops a live post's pending follow-ups.
// Removals of automatic reposts are kept: one whose repost never went up
// skips itself, and one whose repost did (even one in flight while this
// ran) still takes it down, so cancelling never leaves an automatic repost
// up for good. Steps after this read their cancelled receipt and do nothing.
func (c *Configuration) CancelContentDraftPostAutomations(ctx context.Context, actor Actor, postID string) (*ContentDraftPost, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	post, err := c.draftPostForRecovery(ctx, tx, actor, postID)
	if err != nil {
		return nil, err
	}
	pending := []predicate.PostAutomationRun{postautomationrun.ScheduledPostID(post.ID),
		postautomationrun.StatusEQ(postautomationrun.StatusPending), postautomationrun.KindNEQ(postautomationrun.KindUnretweet)}
	cancelled, err := tx.PostAutomationRun.Query().Where(pending...).Select(postautomationrun.FieldKey).Strings(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := tx.PostAutomationRun.Update().Where(pending...).SetStatus(postautomationrun.StatusCancelled).Save(ctx); err != nil {
		return nil, err
	}
	if len(cancelled) > 0 {
		if err := appendConfigurationAudit(ctx, tx, actor, "post.automations_cancelled", "scheduled_post", post.ID,
			map[string]any{"keys": cancelled}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	automations, err := c.postAutomations(ctx, post)
	if err != nil {
		return nil, err
	}
	result := contentDraftPost(post, post.Edges.ChannelConnection.Platform)
	result.Automations = automations[post.ID]
	if result.Automations == nil {
		result.Automations = []PostAutomation{}
	}
	return &result, nil
}
