package product

import (
	"context"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Scheduling a content draft (RFC 037) creates one canonical scheduled post
// per channel, through the same scheduled_post queue and Temporal workflow as
// campaign posts. The web serializes the draft per channel; the backend
// re-checks each caption before anything is queued.

// draftPlatformChannels maps a connection's platform to the channel whose
// limit applies (campaignChannelLimits). Other platforms cannot take a draft.
var draftPlatformChannels = map[string]string{
	"x": "x", "linkedin": "linkedin", "instagram": "instagram", "instagram-standalone": "instagram",
}

// draftChannelImageLimits is how many images each channel takes in one post.
// A post carries its first images up to that many; the composer's preview
// says so (lib/content-drafts/serialize.ts holds the same numbers).
var draftChannelImageLimits = map[string]int{"instagram": 10, "linkedin": 9, "x": 4}

// ContentDraftScheduleTarget is one channel and the caption serialized for it.
type ContentDraftScheduleTarget struct {
	// AssetIDs are the post's images in order: the draft's, with its table and
	// math blocks rendered among them. Omitted, the post takes the draft's.
	AssetIDs            []string `json:"assetIds"`
	Caption             string   `json:"caption"`
	ChannelConnectionID string   `json:"channelConnectionId"`
	// Replies are a thread's later posts, posted as replies to the first.
	// Only a channel that publishes threads (X) takes them.
	Replies []thread.Reply `json:"replies"`
}

// draftThreadChannels publish a thread's later posts as replies.
var draftThreadChannels = map[string]bool{"x": true}

// contentDraftReplyLimit caps a thread: the first post and this many replies.
const contentDraftReplyLimit = 24

// ScheduleContentDraftInput schedules the draft at Version to every target.
type ScheduleContentDraftInput struct {
	ScheduledFor time.Time                    `json:"scheduledFor"`
	Targets      []ContentDraftScheduleTarget `json:"targets"`
	Version      int                          `json:"version"`
}

// ContentDraftPost is a scheduled post made from a draft, with its status.
type ContentDraftPost struct {
	Caption             string    `json:"caption"`
	ChannelConnectionID string    `json:"channelConnectionId"`
	CreatedAt           time.Time `json:"createdAt"`
	ID                  string    `json:"id"`
	Platform            string    `json:"platform"`
	ScheduledFor        time.Time `json:"scheduledFor"`
	Status              string    `json:"status"`
}

// ScheduleContentDraftResult is the draft after scheduling and its new posts.
// Created is false for a replay of a schedule already made at this version.
type ScheduleContentDraftResult struct {
	Created bool               `json:"created"`
	Draft   ContentDraftRecord `json:"draft"`
	Posts   []ContentDraftPost `json:"posts"`
	// Cancelled are live posts a reschedule replaced; their workflows must stop.
	Cancelled []string `json:"-"`
	// Scheduled are the posts whose workflows must run (started idempotently).
	Scheduled []*ent.ScheduledPost `json:"-"`
}

// contentDraftPostKey is the idempotency key of a draft's post on a channel
// at a version: a double submit replays the same posts instead of new ones.
func contentDraftPostKey(draftID, connectionID string, version int) string {
	return fmt.Sprintf("content-draft:%s:%s:v%d", draftID, connectionID, version)
}

func contentDraftPost(post *ent.ScheduledPost, platform string) ContentDraftPost {
	return ContentDraftPost{Caption: post.Caption, ChannelConnectionID: post.ChannelConnectionID,
		CreatedAt: post.CreatedAt, ID: post.ID, Platform: platform, ScheduledFor: post.ScheduledFor,
		Status: string(post.Status)}
}

// validateDraftTargets checks the shape of a schedule before any lookup.
func validateDraftTargets(input ScheduleContentDraftInput) error {
	if input.Version < 1 {
		return invalid("version is required.")
	}
	if len(input.Targets) == 0 || len(input.Targets) > contentDraftChannelLimit {
		return invalid(fmt.Sprintf("Pick 1 to %d channels.", contentDraftChannelLimit))
	}
	if !input.ScheduledFor.After(time.Now()) {
		return invalid("Pick a time in the future.")
	}
	seen := map[string]bool{}
	for _, target := range input.Targets {
		if !contentDraftRefPattern.MatchString(target.ChannelConnectionID) || seen[target.ChannelConnectionID] {
			return invalid("Each channel must be a distinct, valid connection.")
		}
		seen[target.ChannelConnectionID] = true
		if strings.TrimSpace(target.Caption) == "" {
			return invalid("Every channel needs a caption.")
		}
	}
	return nil
}

// draftTargetConnections loads and checks every target's connection: the
// workspace's, active, on a platform that takes drafts, and within that
// channel's caption limit. It also returns each target's images, up to the
// channel's limit and all the workspace's uploads. Instagram posts need one.
func draftTargetConnections(ctx context.Context, tx *ent.Tx, organizationID string, targets []ContentDraftScheduleTarget,
	draftImages []string) (map[string]*ent.ChannelConnection, map[string][]string, error) {
	connections := make(map[string]*ent.ChannelConnection, len(targets))
	images := make(map[string][]string, len(targets))
	for _, target := range targets {
		connection, err := tx.ChannelConnection.Query().Where(channelconnection.ID(target.ChannelConnectionID),
			channelconnection.OrganizationID(organizationID)).Only(ctx)
		if ent.IsNotFound(err) {
			return nil, nil, publishing.ErrNotFound
		}
		if err != nil {
			return nil, nil, err
		}
		if connection.Status != channelconnection.StatusACTIVE || connection.Provider != "postiz" {
			return nil, nil, publishing.ErrNotEligible
		}
		channel, ok := draftPlatformChannels[connection.Platform]
		if !ok {
			return nil, nil, conflict("A " + connection.Platform + " channel cannot publish a draft.")
		}
		ids := draftImages
		if target.AssetIDs != nil {
			ids = target.AssetIDs
		}
		ids = ids[:min(len(ids), draftChannelImageLimits[channel])]
		if target.AssetIDs != nil {
			if ids, err = contentDraftAssets(ctx, tx, organizationID, ids); err != nil {
				return nil, nil, err
			}
		}
		if channel == "instagram" && len(ids) == 0 {
			return nil, nil, conflict("Instagram needs an image. Add one to the draft first.")
		}
		if length, limit := campaignPostLength(target.Caption, ""), campaignChannelLimit(channel); length > limit {
			return nil, nil, conflict(fmt.Sprintf("The %s caption is %d characters; the limit is %d.", channel, length, limit))
		}
		if err := checkDraftReplies(ctx, tx, organizationID, channel, target.Replies); err != nil {
			return nil, nil, err
		}
		connections[target.ChannelConnectionID] = connection
		images[target.ChannelConnectionID] = ids
	}
	return connections, images, nil
}

// checkDraftReplies checks a thread's later posts: a thread channel, at most
// contentDraftReplyLimit, each within the limit with text or an image, and
// every image an upload of the workspace, up to the channel's image limit.
func checkDraftReplies(ctx context.Context, tx *ent.Tx, organizationID, channel string, replies []thread.Reply) error {
	if len(replies) == 0 {
		return nil
	}
	if !draftThreadChannels[channel] {
		return invalid("Only X posts a thread; send " + channel + " one post.")
	}
	if len(replies) > contentDraftReplyLimit {
		return invalid(fmt.Sprintf("A thread can have at most %d replies.", contentDraftReplyLimit))
	}
	for index := range replies {
		reply := &replies[index]
		reply.Caption = strings.TrimSpace(reply.Caption)
		if length, limit := campaignPostLength(reply.Caption, ""), campaignChannelLimit(channel); length > limit {
			return conflict(fmt.Sprintf("Post %d is %d characters; the %s limit is %d.", index+2, length, channel, limit))
		}
		ids, err := contentDraftAssets(ctx, tx, organizationID,
			reply.AssetIDs[:min(len(reply.AssetIDs), draftChannelImageLimits[channel])])
		if err != nil {
			return err
		}
		if reply.Caption == "" && len(ids) == 0 {
			return invalid(fmt.Sprintf("Post %d is empty.", index+2))
		}
		reply.AssetIDs = ids
	}
	return nil
}

// replayDraftSchedule returns the posts already made for these targets at this
// version: all of them for a replay, none for a new schedule. Some but not all
// means the targets changed without a save, which is refused.
func replayDraftSchedule(ctx context.Context, tx *ent.Tx, draft *ent.ContentDraft, input ScheduleContentDraftInput) ([]*ent.ScheduledPost, error) {
	keys := make([]string, 0, len(input.Targets))
	for _, target := range input.Targets {
		keys = append(keys, contentDraftPostKey(draft.ID, target.ChannelConnectionID, input.Version))
	}
	existing, err := tx.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(draft.ID),
		scheduledpost.IdempotencyKeyIn(keys...)).WithChannelConnection().All(ctx)
	if err != nil || len(existing) == 0 {
		return nil, err
	}
	if len(existing) != len(keys) {
		return nil, conflict("This draft was already scheduled to other channels at this version. Reload it and try again.")
	}
	return existing, nil
}

// cancelLiveDraftPosts cancels the draft's queued posts so a reschedule
// replaces them. A post already publishing, or that may be live, blocks it.
func cancelLiveDraftPosts(ctx context.Context, tx *ent.Tx, actor Actor, draftID string) ([]string, error) {
	live, err := tx.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(draftID), scheduledpost.StatusIn(
		scheduledpost.StatusDRAFT, scheduledpost.StatusSCHEDULED, scheduledpost.StatusPROCESSING,
		scheduledpost.StatusUNKNOWN_DELIVERY)).All(ctx)
	if err != nil {
		return nil, err
	}
	cancelled := make([]string, 0, len(live))
	for _, post := range live {
		if post.Status == scheduledpost.StatusPROCESSING || post.Status == scheduledpost.StatusUNKNOWN_DELIVERY {
			return nil, conflict("A post from this draft is publishing or may already be live. Check the channel before rescheduling.")
		}
		count, err := tx.ScheduledPost.Update().Where(scheduledpost.ID(post.ID), scheduledpost.StatusIn(
			scheduledpost.StatusDRAFT, scheduledpost.StatusSCHEDULED)).SetStatus(scheduledpost.StatusCANCELLED).Save(ctx)
		if err != nil {
			return nil, err
		}
		if count != 1 {
			return nil, publishing.ErrConflict
		}
		if err := appendConfigurationAudit(ctx, tx, actor, "post.cancelled", "scheduled_post", post.ID,
			map[string]any{"contentDraftId": draftID, "reason": "rescheduled"}); err != nil {
			return nil, err
		}
		cancelled = append(cancelled, post.ID)
	}
	return cancelled, nil
}

// ScheduleContentDraft queues the draft at input.Version to every target.
// Scheduling snapshots each caption, so later edits to the draft do not
// change queued posts; scheduling again cancels them and queues new ones.
func (c *Configuration) ScheduleContentDraft(ctx context.Context, actor Actor, draftID string,
	input ScheduleContentDraftInput) (*ScheduleContentDraftResult, error) {
	if err := c.authorizeDecision(ctx, actor, "owner", "admin", "publisher"); err != nil {
		return nil, err
	}
	if err := c.requireWorkspaceFeature(ctx, actor.OrganizationID, contentDraftFeature); err != nil {
		return nil, err
	}
	if err := validateDraftTargets(input); err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	draft, err := tx.ContentDraft.Query().Where(contentdraft.ID(draftID), contentdraft.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if replay, err := replayDraftSchedule(ctx, tx, draft, input); err != nil || replay != nil {
		if err != nil {
			return nil, err
		}
		result := &ScheduleContentDraftResult{Draft: contentDraftRecord(draft)}
		for _, post := range replay {
			result.Posts = append(result.Posts, contentDraftPost(post, post.Edges.ChannelConnection.Platform))
			if post.Status == scheduledpost.StatusSCHEDULED {
				result.Scheduled = append(result.Scheduled, post)
			}
		}
		return result, tx.Commit()
	}
	if draft.Status == contentdraft.StatusArchived {
		return nil, conflict("Restore this draft before scheduling it.")
	}
	if draft.Version != input.Version {
		return nil, &ContentDraftVersionConflictError{Current: draft.Version}
	}
	connections, images, err := draftTargetConnections(ctx, tx, actor.OrganizationID, input.Targets, draft.AssetIds)
	if err != nil {
		return nil, err
	}
	captions := make([]string, 0, len(input.Targets))
	for _, target := range input.Targets {
		captions = append(captions, target.Caption)
		for _, reply := range target.Replies {
			captions = append(captions, reply.Caption)
		}
	}
	if err := requireAllowedCopy(ctx, tx.BrandProfile, actor.OrganizationID, captions...); err != nil {
		return nil, err
	}
	cancelled, err := cancelLiveDraftPosts(ctx, tx, actor, draft.ID)
	if err != nil {
		return nil, err
	}
	refund, err := c.ChargeMonthlyQuota(ctx, actor.OrganizationID, QuotaPosts, len(input.Targets))
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			refund()
		}
	}()
	result := &ScheduleContentDraftResult{Cancelled: cancelled, Created: true}
	channelIDs := make([]string, 0, len(input.Targets))
	for _, target := range input.Targets {
		create := tx.ScheduledPost.Create()
		if ids := images[target.ChannelConnectionID]; len(ids) > 0 {
			create.SetAssetID(ids[0]).SetAssetIds(ids)
		}
		if len(target.Replies) > 0 {
			create.SetReplies(target.Replies)
		}
		post, err := create.SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetContentDraftID(draft.ID).SetChannelConnectionID(target.ChannelConnectionID).
			SetScheduledFor(input.ScheduledFor.UTC()).SetStatus(scheduledpost.StatusSCHEDULED).
			SetCaption(strings.TrimSpace(target.Caption)).
			SetIdempotencyKey(contentDraftPostKey(draft.ID, target.ChannelConnectionID, input.Version)).Save(ctx)
		if err != nil {
			if ent.IsConstraintError(err) {
				return nil, publishing.ErrConflict
			}
			return nil, err
		}
		if err := appendConfigurationAudit(ctx, tx, actor, "post.scheduled", "scheduled_post", post.ID,
			map[string]any{"contentDraftId": draft.ID}); err != nil {
			return nil, err
		}
		result.Posts = append(result.Posts, contentDraftPost(post, connections[target.ChannelConnectionID].Platform))
		result.Scheduled = append(result.Scheduled, post.Unwrap())
		channelIDs = append(channelIDs, target.ChannelConnectionID)
	}
	count, err := tx.ContentDraft.Update().Where(contentdraft.ID(draft.ID), contentdraft.Version(input.Version)).
		SetStatus(contentdraft.StatusScheduled).SetChannelConnectionIds(channelIDs).AddVersion(1).
		SetNillableUpdatedByUserID(projectActor(actor)).Save(ctx)
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, contentDraftMiss(ctx, tx, actor, draft.ID)
	}
	postIDs := make([]string, 0, len(result.Posts))
	for _, post := range result.Posts {
		postIDs = append(postIDs, post.ID)
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.content_draft_scheduled", "content_draft", draft.ID,
		map[string]any{"cancelledPostIds": cancelled, "scheduledPostIds": postIDs, "version": input.Version}); err != nil {
		return nil, err
	}
	updated, err := tx.ContentDraft.Get(ctx, draft.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	result.Draft = contentDraftRecord(updated)
	return result, nil
}

// ListContentDraftPosts lists every post scheduled from a draft, newest first.
func (c *Configuration) ListContentDraftPosts(ctx context.Context, actor Actor, draftID string) ([]ContentDraftPost, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	owned, err := c.client.ContentDraft.Query().Where(contentdraft.ID(draftID), contentdraft.OrganizationID(actor.OrganizationID)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !owned {
		return nil, publishing.ErrNotFound
	}
	posts, err := c.client.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(draftID),
		scheduledpost.OrganizationID(actor.OrganizationID)).WithChannelConnection().
		Order(ent.Desc(scheduledpost.FieldCreatedAt), ent.Desc(scheduledpost.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]ContentDraftPost, 0, len(posts))
	for _, post := range posts {
		items = append(items, contentDraftPost(post, post.Edges.ChannelConnection.Platform))
	}
	return items, nil
}
