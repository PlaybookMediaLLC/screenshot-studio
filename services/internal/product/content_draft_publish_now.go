package product

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
)

// PublishQueuedContentDraftPost consumes one queued commitment and starts an
// immediate commitment with its exact snapshot. The old id is a concurrency
// token; a retry returns its successor even if the response was lost.
func (c *Configuration) PublishQueuedContentDraftPost(ctx context.Context, actor Actor, id string) (*MovedDraftPost, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	post, err := c.draftPostForRecovery(ctx, tx, actor, id)
	if err != nil {
		return nil, err
	}
	// Serialize replay and worker claims on the original row.
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM scheduled_post WHERE id=$1 FOR UPDATE`, post.ID); err != nil {
		return nil, err
	}
	post, err = tx.ScheduledPost.Query().Where(scheduledpost.ID(id)).WithChannelConnection().Only(ctx)
	if err != nil {
		return nil, err
	}
	existing, err := tx.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID), scheduledpost.IdempotencyKey("publish-now:"+id)).Only(ctx)
	if err == nil {
		return &MovedDraftPost{Cancelled: id, Post: contentDraftPost(existing, post.Edges.ChannelConnection.Platform), Scheduled: existing}, tx.Commit()
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	if post.Status != scheduledpost.StatusSCHEDULED {
		return nil, conflict("Only a queued post can publish now. Refresh to see its current state.")
	}
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM content_draft WHERE id=$1 FOR UPDATE`, *post.ContentDraftID); err != nil {
		return nil, err
	}
	draft, err := visibleContentDraft(ctx, tx.Client(), actor, *post.ContentDraftID)
	if err != nil {
		return nil, err
	}
	if draft.Status == contentdraft.StatusArchived {
		return nil, conflict("Restore this draft before publishing it.")
	}
	// Scheduling increments the draft version without changing the content.
	// Review must still approve the version in this immutable commitment's key.
	prefix := fmt.Sprintf("content-draft:%s:%s:v", draft.ID, post.ChannelConnectionID)
	version, err := strconv.Atoi(strings.Split(strings.TrimPrefix(post.IdempotencyKey, prefix), ":")[0])
	if err != nil || !strings.HasPrefix(post.IdempotencyKey, prefix) {
		return nil, conflict("Review and reschedule this legacy post before publishing now.")
	}
	approval := *draft
	approval.Version = version
	if err := c.requireDraftApproval(ctx, &approval); err != nil {
		return nil, err
	}
	target := ContentDraftScheduleTarget{Caption: post.Caption, ChannelConnectionID: post.ChannelConnectionID, AssetIDs: post.AssetIds, Replies: post.Replies, Options: &post.PublishOptions}
	if target.AssetIDs == nil {
		target.AssetIDs = []string{}
	}
	if len(target.AssetIDs) == 0 && post.AssetID != nil {
		target.AssetIDs = []string{*post.AssetID}
	}
	if post.ReplyTo != nil {
		target.ReplyTo = *post.ReplyTo
	}
	if len(post.Poll.Options) > 0 {
		target.Poll = &post.Poll
	}
	if !post.AutoActions.Empty() {
		target.AutoActions = &post.AutoActions
	}
	if _, _, err := c.draftTargetConnections(ctx, tx, draft, []ContentDraftScheduleTarget{target}, target.AssetIDs); err != nil {
		return nil, err
	}
	captions := []string{post.Caption}
	for _, reply := range post.Replies {
		captions = append(captions, reply.Caption)
	}
	if err := requireAllowedCopy(ctx, tx.BrandProfile, actor.OrganizationID, captions...); err != nil {
		return nil, err
	}
	result, err := replaceQueuedDraftPostAt(ctx, tx, actor, post, time.Now().UTC(), true)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
