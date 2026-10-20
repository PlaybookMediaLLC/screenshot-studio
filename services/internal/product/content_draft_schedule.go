package product

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
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
	"threads": "threads", "bluesky": "bluesky", "mastodon": "mastodon",
}

// EnableE2EDraftPlatform lets the local provider fixture's "e2e" connections
// take drafts as X does, for end-to-end tests. Production never calls it;
// the direct publisher refuses the platform outside e2e builds regardless.
func EnableE2EDraftPlatform() {
	draftPlatformChannels["e2e"] = "x"
}

// draftChannelImageLimits is how many images each channel takes in one post.
// A post carries its first images up to that many; the composer's preview
// says so (lib/content-drafts/serialize.ts holds the same numbers).
var draftChannelImageLimits = map[string]int{
	"bluesky": 4, "instagram": 10, "linkedin": 9, "mastodon": 4, "threads": 10, "x": 4,
}

// draftChannelLimits is each channel's caption limit; the composer holds the
// same numbers (DRAFT_CHANNEL_LIMITS in lib/content-drafts/serialize.ts).
var draftChannelLimits = map[string]int{
	"bluesky": 300, "instagram": 2200, "linkedin": 3000, "mastodon": 500, "threads": 500, "x": 280,
}

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
	// AutoActions follow the post once live (X only).
	AutoActions *postoptions.AutoActions `json:"autoActions"`
	// Poll asks a question with the post (X, LinkedIn).
	Poll *postoptions.Poll `json:"poll"`
	// Options are the first post's settings beyond its text (RFC 042).
	Options *postoptions.PublishOptions `json:"options"`
	// ReplyTo is the live X post a reply draft answers.
	ReplyTo string `json:"replyTo"`
}

// draftThreadChannels publish a thread's later posts as replies.
var draftThreadChannels = map[string]bool{"x": true, "threads": true, "bluesky": true, "mastodon": true}

// contentDraftReplyLimit caps a thread: the first post and this many replies.
const contentDraftReplyLimit = 24

// ScheduleContentDraftInput schedules the draft at Version to every target.
// The time is, in order: now (PublishNow), the set's next free queue slot
// (Queue), a local time in a zone (LocalTime and TimeZone, resolved here),
// or ScheduledFor. NaturalTiming shifts it by a stable few minutes.
type ScheduleContentDraftInput struct {
	ScheduledFor time.Time                    `json:"scheduledFor"`
	Targets      []ContentDraftScheduleTarget `json:"targets"`
	Version      int                          `json:"version"`
	// Write (RFC 042).
	Disambiguation string `json:"disambiguation"`
	LocalTime      string `json:"localTime"`
	NaturalTiming  bool   `json:"naturalTiming"`
	PublishNow     bool   `json:"publishNow"`
	Queue          bool   `json:"queue"`
	TimeZone       string `json:"timeZone"`
}

// AccountStanding is an account's standing on its platform, as the platform
// reports it: X Premium raises the caption limit and allows articles. It is
// the account's, never the workspace plan's.
type AccountStanding struct {
	Premium bool `json:"premium"`
}

// AccountStandingReader reads an account's standing from its platform
// connection (the direct social publisher).
type AccountStandingReader interface {
	AccountStanding(ctx context.Context, organizationID, destinationID, platform, secretReference string) (AccountStanding, error)
}

// WithAccountStanding sets the account standing reader. Without one, every
// account is standard: 280 characters on X and no articles.
func (c *Configuration) WithAccountStanding(reader AccountStandingReader) *Configuration {
	c.accounts = reader
	return c
}

// accountStanding reads a connection's standing; unknown is standard.
func (c *Configuration) accountStanding(ctx context.Context, connection *ent.ChannelConnection) AccountStanding {
	if c.accounts == nil {
		return AccountStanding{}
	}
	standing, err := c.accounts.AccountStanding(ctx, connection.OrganizationID, connection.ExternalAccountID,
		connection.Platform, connection.SecretReference)
	if err != nil {
		return AccountStanding{}
	}
	return standing
}

// scheduleTime resolves when a schedule goes out. Queue reservations take
// the workspace's queue lock for the rest of the transaction.
func (c *Configuration) scheduleTime(ctx context.Context, tx *ent.Tx, draft *ent.ContentDraft, input ScheduleContentDraftInput) (time.Time, error) {
	var at time.Time
	switch {
	case input.PublishNow:
		return time.Now().UTC(), nil
	case input.Queue:
		if err := lockDraftQueue(ctx, tx, draft.OrganizationID); err != nil {
			return time.Time{}, err
		}
		ids := make([]string, 0, len(input.Targets))
		for _, target := range input.Targets {
			ids = append(ids, target.ChannelConnectionID)
		}
		slot, err := c.nextFreeSlot(ctx, tx, draft.OrganizationID, ids)
		if err != nil {
			return time.Time{}, err
		}
		at = slot
	case input.LocalTime != "":
		resolved, err := resolveLocalTime(input.LocalTime, input.TimeZone, input.Disambiguation)
		if err != nil {
			return time.Time{}, err
		}
		at = resolved
	default:
		at = input.ScheduledFor.UTC()
	}
	if input.NaturalTiming {
		at = at.Add(naturalOffset(fmt.Sprintf("%s:v%d", draft.ID, input.Version)))
	}
	if !at.After(time.Now()) {
		return time.Time{}, invalid("Pick a time in the future.")
	}
	return at, nil
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
	// Once live: the post on its platform, and its engagement as last read.
	Metrics   postoptions.Metrics `json:"metrics"`
	MetricsAt *time.Time          `json:"metricsAt"`
	URL       *string             `json:"url"`
	// A thread: how many replies it has and how many went out.
	Replies        int                        `json:"replies"`
	ThreadProgress postoptions.ThreadProgress `json:"threadProgress"`
	// Its follow-ups once live (RFC 042), each with its receipt.
	Automations []PostAutomation `json:"automations"`
}

// livePostURL is a live post's address on its platform, where one can be
// built from its id.
func livePostURL(platform string, remoteID *string) *string {
	if remoteID == nil || *remoteID == "" {
		return nil
	}
	var url string
	switch platform {
	case "x":
		url = "https://x.com/i/status/" + *remoteID
	case "linkedin":
		url = "https://www.linkedin.com/feed/update/" + *remoteID
	case "threads", "bluesky", "mastodon":
		// These providers report a post's address as its id.
		if strings.HasPrefix(*remoteID, "https://") {
			url = *remoteID
		}
	}
	if url == "" {
		return nil
	}
	return &url
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
		Status: string(post.Status), Metrics: post.Metrics, MetricsAt: post.MetricsAt,
		URL: livePostURL(platform, post.RemotePostID), Replies: len(post.Replies), ThreadProgress: post.ThreadProgress,
		Automations: []PostAutomation{}}
}

// validateDraftTargets checks the shape of a schedule before any lookup.
func validateDraftTargets(input ScheduleContentDraftInput) error {
	if input.Version < 1 {
		return invalid("version is required.")
	}
	if len(input.Targets) == 0 || len(input.Targets) > contentDraftChannelLimit {
		return invalid(fmt.Sprintf("Pick 1 to %d channels.", contentDraftChannelLimit))
	}
	if input.PublishNow && input.Queue {
		return invalid("Publish now, or add to the queue: not both.")
	}
	if input.Disambiguation != "" && input.Disambiguation != "earlier" && input.Disambiguation != "later" {
		return invalid("A repeated local time is the earlier or the later one.")
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
func (c *Configuration) draftTargetConnections(ctx context.Context, tx *ent.Tx, draft *ent.ContentDraft, targets []ContentDraftScheduleTarget,
	draftImages []string) (map[string]*ent.ChannelConnection, map[string][]string, error) {
	organizationID := draft.OrganizationID
	connections := make(map[string]*ent.ChannelConnection, len(targets))
	images := make(map[string][]string, len(targets))
	if err := checkDraftKindTargets(string(draft.Kind), targets); err != nil {
		return nil, nil, err
	}
	for _, target := range targets {
		connection, err := tx.ChannelConnection.Query().Where(channelconnection.ID(target.ChannelConnectionID),
			channelconnection.OrganizationID(organizationID)).Only(ctx)
		if ent.IsNotFound(err) {
			return nil, nil, publishing.ErrNotFound
		}
		if err != nil {
			return nil, nil, err
		}
		if connection.Status != channelconnection.StatusACTIVE || connection.Provider != "social" {
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
		standing := c.accountStanding(ctx, connection)
		limit := draftChannelLimits[channel]
		if channel == "x" && standing.Premium {
			limit = xPremiumLimit
		}
		if draft.Kind == contentdraft.KindArticle {
			if !standing.Premium {
				return nil, nil, conflict("X publishes articles only from X Premium accounts, and this account is not Premium on X.")
			}
			limit = 100_000
		}
		if length := draftPostLength(channel, target.Caption); length > limit {
			return nil, nil, conflict(fmt.Sprintf("The %s caption is %d characters; the limit is %d.", channel, length, limit))
		}
		if err := checkDraftReplies(ctx, tx, organizationID, channel, limit, target.Replies); err != nil {
			return nil, nil, err
		}
		media := len(ids)
		if target.Options != nil && target.Options.DocumentAssetID != "" {
			if err := checkDraftDocument(ctx, tx, organizationID, target.Options.DocumentAssetID); err != nil {
				return nil, nil, err
			}
			if len(ids) > 0 {
				return nil, nil, invalid("A LinkedIn document goes alone: remove the images or the document.")
			}
			media++
		}
		if err := checkPostOptions(channel, target.Options, true); err != nil {
			return nil, nil, err
		}
		if err := checkPoll(channel, target.Poll, target.Options, media); err != nil {
			return nil, nil, err
		}
		if err := checkDraftExtras(channel, target); err != nil {
			return nil, nil, err
		}
		connections[target.ChannelConnectionID] = connection
		images[target.ChannelConnectionID] = ids
	}
	return connections, images, nil
}

// checkDraftExtras checks a target's follow-ups: X only, and sensible.
func checkDraftExtras(channel string, target ContentDraftScheduleTarget) error {
	if target.AutoActions != nil && !target.AutoActions.Empty() {
		actions := *target.AutoActions
		if channel != "x" {
			return invalid("Auto reposts, replies and quotes are for X posts.")
		}
		if actions.RepostAtLikes < 0 || actions.PlugAtLikes < 0 || actions.QuoteAfterHours < 0 ||
			actions.RepostAtLikes > 1_000_000 || actions.PlugAtLikes > 1_000_000 || actions.QuoteAfterHours > 24*30 {
			return invalid("Set like counts and hours as small positive numbers.")
		}
		if actions.PlugAtLikes > 0 && (strings.TrimSpace(actions.PlugText) == "" || xLength(actions.PlugText) > 280) {
			return invalid("The auto reply needs text that fits in one X post.")
		}
		if actions.QuoteAfterHours > 0 && (strings.TrimSpace(actions.QuoteText) == "" || xLength(actions.QuoteText)+1+xLinkLength > 280) {
			return invalid("The quote needs text that fits in one X post with the link.")
		}
		if actions.PlugMetric != "" && actions.PlugMetric != "likes" && actions.PlugMetric != "reposts" {
			return invalid("An auto plug waits for likes or reposts.")
		}
		if err := checkRetweetRules(actions); err != nil {
			return err
		}
	}
	return nil
}

// checkRetweetRules checks automatic reposts (RFC 042): at most five, each
// a duration after publishing (up to 30 days) or a wall-clock time up to 30
// days later in a real time zone, and a removal delay of up to a week.
func checkRetweetRules(actions postoptions.AutoActions) error {
	if len(actions.Retweets) > 5 {
		return invalid("Add up to five automatic reposts.")
	}
	if actions.UnretweetAfterMinutes < 0 || actions.UnretweetAfterMinutes > 7*24*60 {
		return invalid("Remove automatic reposts within a week, or keep them.")
	}
	for _, rule := range actions.Retweets {
		if rule.At == "" && (rule.AfterMinutes < 1 || rule.AfterMinutes > 30*24*60 || rule.Days != 0 || rule.TimeZone != "") {
			return invalid("Repost between one minute and 30 days after publishing.")
		}
		if rule.At != "" && (rule.AfterMinutes != 0 || rule.Days < 0 || rule.Days > 30) {
			return invalid("Repost at a time of day up to 30 days after publishing.")
		}
		if _, err := rule.When(time.Now()); err != nil {
			return invalid("Each repost needs a time like 10:30 and a time zone like Europe/Paris.")
		}
	}
	return nil
}

// checkDraftKindTargets checks a kind's targets: an article goes to one X
// account and nowhere else; a reply answers an X post; a quote names the
// post it quotes. Each says what it needs.
func checkDraftKindTargets(kind string, targets []ContentDraftScheduleTarget) error {
	for _, target := range targets {
		options := target.Options
		if options == nil {
			options = &postoptions.PublishOptions{}
		}
		switch kind {
		case "article":
			if len(targets) != 1 {
				return invalid("An article goes to one X account and cannot go to other platforms with it.")
			}
			if strings.TrimSpace(options.ArticleTitle) == "" {
				return invalid("Give the article a title.")
			}
			if len(target.Replies) > 0 || target.Poll != nil && len(target.Poll.Options) > 0 {
				return invalid("An article has no thread and no poll.")
			}
		case "reply":
			if !numericID.MatchString(target.ReplyTo) {
				return invalid("A reply names the X post it answers.")
			}
		case "quote":
			if options.QuoteRemoteID == "" {
				return invalid("A quote names the post it quotes.")
			}
		default:
			if target.ReplyTo != "" || options.ArticleTitle != "" {
				return invalid("Only a reply answers a post, and only an article has a title.")
			}
		}
	}
	return nil
}

// checkDraftDocument checks a LinkedIn document is an uploaded PDF of the workspace.
func checkDraftDocument(ctx context.Context, tx *ent.Tx, organizationID, assetID string) error {
	found, err := tx.Asset.Query().Where(asset.ID(assetID), asset.OrganizationID(organizationID),
		asset.StatusEQ(asset.StatusUPLOADED), asset.MediaType("application/pdf")).Exist(ctx)
	if err != nil {
		return err
	}
	if !found {
		return invalid("The document must be an uploaded PDF of this workspace.")
	}
	return nil
}

// checkDraftReplies checks a thread's later posts: a thread channel, at most
// contentDraftReplyLimit, each within the limit with text or an image, and
// every image an upload of the workspace, up to the channel's image limit.
func checkDraftReplies(ctx context.Context, tx *ent.Tx, organizationID, channel string, limit int, replies []thread.Reply) error {
	if len(replies) == 0 {
		return nil
	}
	if !draftThreadChannels[channel] {
		return invalid("Only X, Threads, Bluesky and Mastodon post a thread; send " + channel + " one post.")
	}
	if len(replies) > contentDraftReplyLimit {
		return invalid(fmt.Sprintf("A thread can have at most %d replies.", contentDraftReplyLimit))
	}
	for index := range replies {
		reply := &replies[index]
		reply.Caption = strings.TrimSpace(reply.Caption)
		if length := draftPostLength(channel, reply.Caption); length > limit {
			return conflict(fmt.Sprintf("Post %d is %d characters; the %s limit is %d.", index+2, length, channel, limit))
		}
		if err := checkPostOptions(channel, reply.Options, false); err != nil {
			return err
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
		if err := recordProductActivity(ctx, tx, actor, "post.cancelled", "post.cancelled", "scheduled_post", post.ID,
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
	if _, err := c.loadDraft(ctx, actor, draftID); err != nil {
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
	if err := c.requireDraftApproval(ctx, draft); err != nil {
		return nil, err
	}
	scheduledFor, err := c.scheduleTime(ctx, tx, draft, input)
	if err != nil {
		return nil, err
	}
	reason := "schedule"
	if input.PublishNow {
		reason = "publish"
	}
	if err := recordContentDraftRevision(ctx, tx, actor, draft, true, reason); err != nil {
		return nil, err
	}
	connections, images, err := c.draftTargetConnections(ctx, tx, draft, input.Targets, draft.AssetIds)
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
		if target.AutoActions != nil && !target.AutoActions.Empty() {
			create.SetAutoActions(*target.AutoActions)
		}
		if target.Poll != nil && len(target.Poll.Options) > 0 {
			create.SetPoll(*target.Poll)
		}
		if target.Options != nil && !target.Options.Empty() {
			create.SetPublishOptions(*target.Options)
		}
		if target.ReplyTo != "" {
			create.SetReplyTo(target.ReplyTo)
		}
		post, err := create.SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetContentDraftID(draft.ID).SetChannelConnectionID(target.ChannelConnectionID).
			SetScheduledFor(scheduledFor).SetStatus(scheduledpost.StatusSCHEDULED).
			SetCaption(strings.TrimSpace(target.Caption)).
			SetIdempotencyKey(contentDraftPostKey(draft.ID, target.ChannelConnectionID, input.Version)).Save(ctx)
		if err != nil {
			if ent.IsConstraintError(err) {
				return nil, publishing.ErrConflict
			}
			return nil, err
		}
		if err := recordProductActivity(ctx, tx, actor, "post.scheduled", "post.scheduled", "scheduled_post", post.ID,
			map[string]any{"contentDraftId": draft.ID}); err != nil {
			return nil, err
		}
		result.Posts = append(result.Posts, contentDraftPost(post, connections[target.ChannelConnectionID].Platform))
		result.Scheduled = append(result.Scheduled, post.Unwrap())
		channelIDs = append(channelIDs, target.ChannelConnectionID)
	}
	// A scheduled draft is no longer only planned.
	count, err := tx.ContentDraft.Update().Where(contentdraft.ID(draft.ID), contentdraft.Version(input.Version)).
		SetStatus(contentdraft.StatusScheduled).SetChannelConnectionIds(channelIDs).AddVersion(1).
		ClearPlannedFor().ClearPlanTimeZone().
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
		map[string]any{"cancelledPostIds": cancelled, "scheduledPostIds": postIDs, "version": input.Version,
			"scheduledFor": scheduledFor.Format(time.RFC3339), "reason": reason, "timeZone": input.TimeZone}); err != nil {
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
	if _, err := c.loadDraft(ctx, actor, draftID); err != nil {
		return nil, err
	}
	posts, err := c.client.ScheduledPost.Query().Where(scheduledpost.ContentDraftID(draftID),
		scheduledpost.OrganizationID(actor.OrganizationID)).WithChannelConnection().
		Order(ent.Desc(scheduledpost.FieldCreatedAt), ent.Desc(scheduledpost.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	automations, err := c.postAutomations(ctx, posts...)
	if err != nil {
		return nil, err
	}
	items := make([]ContentDraftPost, 0, len(posts))
	for _, post := range posts {
		item := contentDraftPost(post, post.Edges.ChannelConnection.Platform)
		if found := automations[post.ID]; found != nil {
			item.Automations = found
		}
		items = append(items, item)
	}
	return items, nil
}
