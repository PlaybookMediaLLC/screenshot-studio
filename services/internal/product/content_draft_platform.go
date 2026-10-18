package product

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraftrevision"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraftsettings"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/thread"
	"github.com/lucsky/cuid"
)

// Content drafts, round two (RFC 037): the posting queue and its settings,
// best times, moving one post, review, guest share links, revisions,
// resuming a thread that stopped, and engagement on live posts.

// defaultQueueSlots are a new workspace's posting times: weekdays at 9:00.
var defaultQueueSlots = []schema.QueueSlot{
	{Weekday: 1, Time: "09:00"}, {Weekday: 2, Time: "09:00"}, {Weekday: 3, Time: "09:00"},
	{Weekday: 4, Time: "09:00"}, {Weekday: 5, Time: "09:00"},
}

// ContentDraftSettings is a workspace's drafts preferences.
type ContentDraftSettings struct {
	PostingSlots    []schema.QueueSlot `json:"postingSlots"`
	RequireApproval bool               `json:"requireApproval"`
	TimeZone        string             `json:"timeZone"`
}

// ContentDraftSettingsUpdate changes the settings it sets.
type ContentDraftSettingsUpdate struct {
	PostingSlots    *[]schema.QueueSlot `json:"postingSlots"`
	RequireApproval *bool               `json:"requireApproval"`
}

func (c *Configuration) workspaceZone(ctx context.Context, organizationID string) (*time.Location, string) {
	name := "UTC"
	if settings, err := c.client.WorkspaceSettings.Get(ctx, organizationID); err == nil && settings.TimeZone != "" {
		name = settings.TimeZone
	}
	zone, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC, "UTC"
	}
	return zone, name
}

func (c *Configuration) draftSettings(ctx context.Context, organizationID string) (ContentDraftSettings, error) {
	_, zoneName := c.workspaceZone(ctx, organizationID)
	row, err := c.client.ContentDraftSettings.Get(ctx, organizationID)
	if ent.IsNotFound(err) {
		return ContentDraftSettings{PostingSlots: defaultQueueSlots, TimeZone: zoneName}, nil
	}
	if err != nil {
		return ContentDraftSettings{}, err
	}
	return ContentDraftSettings{PostingSlots: row.PostingSlots, RequireApproval: row.RequireApproval, TimeZone: zoneName}, nil
}

// GetContentDraftSettings returns the workspace's drafts settings, with the
// defaults when none were saved.
func (c *Configuration) GetContentDraftSettings(ctx context.Context, actor Actor) (*ContentDraftSettings, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	settings, err := c.draftSettings(ctx, actor.OrganizationID)
	return &settings, err
}

// UpdateContentDraftSettings saves the settings an owner, admin or publisher sets.
func (c *Configuration) UpdateContentDraftSettings(ctx context.Context, actor Actor, input ContentDraftSettingsUpdate) (*ContentDraftSettings, error) {
	if err := c.authorizeScheduling(ctx, actor); err != nil {
		return nil, err
	}
	if err := c.requireWorkspaceFeature(ctx, actor.OrganizationID, contentDraftFeature); err != nil {
		return nil, err
	}
	current, err := c.draftSettings(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	if input.PostingSlots != nil {
		slots, err := queueSlots(*input.PostingSlots)
		if err != nil {
			return nil, err
		}
		current.PostingSlots = slots
	}
	if input.RequireApproval != nil {
		current.RequireApproval = *input.RequireApproval
	}
	updated, err := c.client.ContentDraftSettings.Update().Where(contentdraftsettings.ID(actor.OrganizationID)).
		SetPostingSlots(current.PostingSlots).SetRequireApproval(current.RequireApproval).Save(ctx)
	if err == nil && updated == 0 {
		err = c.client.ContentDraftSettings.Create().SetID(actor.OrganizationID).SetPostingSlots(current.PostingSlots).
			SetRequireApproval(current.RequireApproval).Exec(ctx)
	}
	if err != nil {
		return nil, err
	}
	return &current, nil
}

// queueSlots checks and sorts weekly slots: at most 50, each a weekday and HH:MM.
func queueSlots(slots []schema.QueueSlot) ([]schema.QueueSlot, error) {
	if len(slots) > 50 {
		return nil, invalid("Keep the queue to 50 weekly slots or fewer.")
	}
	seen := map[string]bool{}
	out := make([]schema.QueueSlot, 0, len(slots))
	for _, slot := range slots {
		if _, err := time.Parse("15:04", slot.Time); err != nil || slot.Weekday < 0 || slot.Weekday > 6 {
			return nil, invalid("Each slot is a weekday (0 to 6) and a time as HH:MM.")
		}
		key := fmt.Sprintf("%d %s", slot.Weekday, slot.Time)
		if !seen[key] {
			seen[key] = true
			out = append(out, slot)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Weekday < out[j].Weekday || out[i].Weekday == out[j].Weekday && out[i].Time < out[j].Time
	})
	return out, nil
}

// slotTimes lists the slots' occurrences after `from`, in order, up to `limit`.
func slotTimes(slots []schema.QueueSlot, zone *time.Location, from time.Time, limit int) []time.Time {
	var times []time.Time
	local := from.In(zone)
	for day := 0; day < 7*12 && len(times) < limit; day++ {
		date := time.Date(local.Year(), local.Month(), local.Day()+day, 0, 0, 0, 0, zone)
		for _, slot := range slots {
			if int(date.Weekday()) != slot.Weekday {
				continue
			}
			clock, _ := time.Parse("15:04", slot.Time)
			at := time.Date(date.Year(), date.Month(), date.Day(), clock.Hour(), clock.Minute(), 0, 0, zone)
			if at.After(from) {
				times = append(times, at.UTC())
			}
		}
	}
	sort.Slice(times, func(i, j int) bool { return times[i].Before(times[j]) })
	if len(times) > limit {
		times = times[:limit]
	}
	return times
}

// NextQueueSlot is the workspace's next posting slot that no draft post
// already takes.
func (c *Configuration) NextQueueSlot(ctx context.Context, actor Actor) (time.Time, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return time.Time{}, err
	}
	settings, err := c.draftSettings(ctx, actor.OrganizationID)
	if err != nil {
		return time.Time{}, err
	}
	if len(settings.PostingSlots) == 0 {
		return time.Time{}, conflict("Add a posting slot to the queue first.")
	}
	zone, _ := c.workspaceZone(ctx, actor.OrganizationID)
	now := time.Now()
	candidates := slotTimes(settings.PostingSlots, zone, now.Add(time.Minute), 200)
	if len(candidates) == 0 {
		return time.Time{}, conflict("The queue has no open slot in the next twelve weeks.")
	}
	taken, err := c.client.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.ContentDraftIDNotNil(),
		scheduledpost.StatusIn(scheduledpost.StatusSCHEDULED, scheduledpost.StatusPROCESSING),
		scheduledpost.ScheduledForGTE(candidates[0]), scheduledpost.ScheduledForLTE(candidates[len(candidates)-1])).
		All(ctx)
	if err != nil {
		return time.Time{}, err
	}
	busy := map[int64]bool{}
	for _, post := range taken {
		busy[post.ScheduledFor.Truncate(time.Minute).Unix()] = true
	}
	for _, at := range candidates {
		if !busy[at.Unix()] {
			return at, nil
		}
	}
	return time.Time{}, conflict("Every queue slot in the next twelve weeks is taken.")
}

// BestTime is a suggested posting time and why.
type BestTime struct {
	At     time.Time `json:"at"`
	Reason string    `json:"reason"`
}

// postScore weighs a live post's engagement: conversations count most.
func postScore(metrics postoptions.Metrics) float64 {
	score := 0.0
	for name, value := range metrics {
		switch name {
		case "replies", "comments", "quotes":
			score += 3 * value
		case "reposts", "shares", "retweets":
			score += 2 * value
		case "likes", "reactions", "bookmarks":
			score += value
		}
	}
	return score
}

// BestPostingTimes suggests the next times to post: the weekday hours the
// workspace's live posts did best at, from their engagement; with too
// little history, the hours social posts do well at generally.
func (c *Configuration) BestPostingTimes(ctx context.Context, actor Actor) ([]BestTime, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	zone, _ := c.workspaceZone(ctx, actor.OrganizationID)
	posts, err := c.client.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.StatusEQ(scheduledpost.StatusPUBLISHED), scheduledpost.MetricsAtNotNil(),
		scheduledpost.ScheduledForGTE(time.Now().AddDate(0, 0, -120))).All(ctx)
	if err != nil {
		return nil, err
	}
	type bucket struct {
		count int
		total float64
	}
	buckets := map[[2]int]*bucket{}
	for _, post := range posts {
		local := post.ScheduledFor.In(zone)
		key := [2]int{int(local.Weekday()), local.Hour()}
		if buckets[key] == nil {
			buckets[key] = &bucket{}
		}
		buckets[key].count++
		buckets[key].total += postScore(post.Metrics)
	}
	type ranked struct {
		key     [2]int
		average float64
	}
	var hours []ranked
	for key, value := range buckets {
		hours = append(hours, ranked{key: key, average: value.total / float64(value.count)})
	}
	sort.Slice(hours, func(i, j int) bool { return hours[i].average > hours[j].average })
	reason := "Your posts at this hour get the most engagement."
	if len(posts) < 5 || len(hours) == 0 {
		// Too little history: mid-week mornings and lunchtime, broadly good.
		hours = []ranked{{key: [2]int{2, 9}}, {key: [2]int{3, 12}}, {key: [2]int{4, 9}}}
		reason = "A good time on most channels; suggestions learn from your posts as they go live."
	}
	var slots []schema.QueueSlot
	for _, hour := range hours[:min(3, len(hours))] {
		slots = append(slots, schema.QueueSlot{Weekday: hour.key[0], Time: fmt.Sprintf("%02d:00", hour.key[1])})
	}
	suggestions := []BestTime{}
	for _, at := range slotTimes(slots, zone, time.Now().Add(30*time.Minute), 3) {
		suggestions = append(suggestions, BestTime{At: at, Reason: reason})
	}
	return suggestions, nil
}

// MovedDraftPost is a post moved to a new time: the old one is cancelled and
// a copy takes its place, since a scheduled workflow's timer is fixed.
type MovedDraftPost struct {
	Cancelled string             `json:"-"`
	Post      ContentDraftPost   `json:"post"`
	Scheduled *ent.ScheduledPost `json:"-"`
}

// MoveContentDraftPost moves one queued draft post to `at`, without charging
// another post: the calendar's drag and drop.
func (c *Configuration) MoveContentDraftPost(ctx context.Context, actor Actor, postID string, at time.Time) (*MovedDraftPost, error) {
	if err := c.authorizeScheduling(ctx, actor); err != nil {
		return nil, err
	}
	if !at.After(time.Now().Add(time.Minute)) {
		return nil, invalid("Pick a time in the future.")
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	post, err := tx.ScheduledPost.Query().Where(scheduledpost.ID(postID), scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.ContentDraftIDNotNil()).WithChannelConnection().Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if post.Status != scheduledpost.StatusSCHEDULED {
		return nil, conflict("Only a queued post can move; this one is " + strings.ToLower(string(post.Status)) + ".")
	}
	if _, err := tx.ScheduledPost.UpdateOneID(post.ID).SetStatus(scheduledpost.StatusCANCELLED).Save(ctx); err != nil {
		return nil, err
	}
	create := tx.ScheduledPost.Create().SetID(cuid.New()).SetOrganizationID(post.OrganizationID).
		SetNillableContentDraftID(post.ContentDraftID).SetNillableAssetID(post.AssetID).
		SetChannelConnectionID(post.ChannelConnectionID).SetScheduledFor(at.UTC()).
		SetStatus(scheduledpost.StatusSCHEDULED).SetCaption(post.Caption).
		SetIdempotencyKey(fmt.Sprintf("%s:moved:%d", post.IdempotencyKey, at.Unix()))
	if len(post.AssetIds) > 0 {
		create.SetAssetIds(post.AssetIds)
	}
	if len(post.Replies) > 0 {
		create.SetReplies(post.Replies)
	}
	if !post.AutoActions.Empty() {
		create.SetAutoActions(post.AutoActions)
	}
	if len(post.Poll.Options) > 0 {
		create.SetPoll(post.Poll)
	}
	moved, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "post.moved", "scheduled_post", moved.ID,
		map[string]any{"from": post.ID, "scheduledFor": at.UTC()}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &MovedDraftPost{Cancelled: post.ID, Post: contentDraftPost(moved, post.Edges.ChannelConnection.Platform), Scheduled: moved}, nil
}

// CalendarPost is a draft post on the calendar, with its draft's title.
type CalendarPost struct {
	ContentDraftPost
	DraftID    string `json:"draftId"`
	DraftTitle string `json:"draftTitle"`
}

// ListContentDraftPostsBetween lists the workspace's draft posts due in
// [from, to): queued, publishing and live, for the calendar and the queue.
func (c *Configuration) ListContentDraftPostsBetween(ctx context.Context, actor Actor, from, to time.Time) ([]CalendarPost, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	if !to.After(from) || to.Sub(from) > 100*24*time.Hour {
		return nil, invalid("Ask for at most 100 days at a time.")
	}
	posts, err := c.client.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.ContentDraftIDNotNil(), scheduledpost.ScheduledForGTE(from), scheduledpost.ScheduledForLT(to),
		scheduledpost.StatusIn(scheduledpost.StatusSCHEDULED, scheduledpost.StatusPROCESSING,
			scheduledpost.StatusPUBLISHED, scheduledpost.StatusFAILED, scheduledpost.StatusUNKNOWN_DELIVERY)).
		WithChannelConnection().Order(ent.Asc(scheduledpost.FieldScheduledFor)).Limit(500).All(ctx)
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for _, post := range posts {
		ids[*post.ContentDraftID] = true
	}
	keys := make([]string, 0, len(ids))
	for id := range ids {
		keys = append(keys, id)
	}
	drafts, err := c.client.ContentDraft.Query().Where(contentdraft.IDIn(keys...),
		contentdraft.OrganizationID(actor.OrganizationID)).All(ctx)
	if err != nil {
		return nil, err
	}
	titles := map[string]string{}
	for _, draft := range drafts {
		titles[draft.ID] = draft.Title
	}
	items := make([]CalendarPost, 0, len(posts))
	for _, post := range posts {
		items = append(items, CalendarPost{ContentDraftPost: contentDraftPost(post, post.Edges.ChannelConnection.Platform),
			DraftID: *post.ContentDraftID, DraftTitle: titles[*post.ContentDraftID]})
	}
	return items, nil
}

// ContentDraftReviewInput is a review step: request (a writer asks), approve
// or changes (a reviewer answers), with an optional note.
type ContentDraftReviewInput struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

// ReviewContentDraft records a review step. Writers request review; owners,
// admins and publishers approve or ask for changes. Approval holds for the
// version it was given at.
func (c *Configuration) ReviewContentDraft(ctx context.Context, actor Actor, id string, input ContentDraftReviewInput) (*ContentDraftRecord, error) {
	write := input.Action == "request"
	var err error
	if write {
		err = c.authorizeContentDrafts(ctx, actor, true)
	} else {
		err = c.authorizeScheduling(ctx, actor)
	}
	if err != nil {
		return nil, err
	}
	note := strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(note) > 2000 {
		return nil, invalid("Keep the review note under 2,000 characters.")
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	draft, err := tx.ContentDraft.Query().Where(contentdraft.ID(id), contentdraft.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// A review step does not change the content, so it keeps the version.
	update := tx.ContentDraft.UpdateOneID(id).SetNillableReviewedByUserID(projectActor(actor))
	if note == "" {
		update.ClearReviewNote()
	} else {
		update.SetReviewNote(note)
	}
	switch input.Action {
	case "request":
		update.SetReviewStatus(contentdraft.ReviewStatusPending).ClearApprovedVersion()
	case "approve":
		update.SetReviewStatus(contentdraft.ReviewStatusApproved).SetApprovedVersion(draft.Version)
	case "changes":
		update.SetReviewStatus(contentdraft.ReviewStatusChangesRequested).ClearApprovedVersion()
	default:
		return nil, invalid("A review action is request, approve or changes.")
	}
	row, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.content_draft_review", "content_draft", id,
		map[string]any{"action": input.Action, "version": draft.Version}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := contentDraftRecord(row)
	return &result, nil
}

// requireDraftApproval refuses to schedule a draft the workspace wants
// reviewed until it is approved at its current version.
func (c *Configuration) requireDraftApproval(ctx context.Context, draft *ent.ContentDraft) error {
	settings, err := c.draftSettings(ctx, draft.OrganizationID)
	if err != nil || !settings.RequireApproval {
		return err
	}
	if draft.ReviewStatus == contentdraft.ReviewStatusApproved && draft.ApprovedVersion != nil &&
		*draft.ApprovedVersion == draft.Version {
		return nil
	}
	return conflict("This workspace approves drafts before they are scheduled. Ask for review, then schedule once it is approved.")
}

// ShareContentDraft turns the draft's read-and-comment link on (a fresh
// token) or off.
func (c *Configuration) ShareContentDraft(ctx context.Context, actor Actor, id string, on bool) (*ContentDraftRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return nil, err
	}
	update := c.client.ContentDraft.Update().Where(contentdraft.ID(id), contentdraft.OrganizationID(actor.OrganizationID))
	if on {
		token := make([]byte, 24)
		if _, err := rand.Read(token); err != nil {
			return nil, err
		}
		update.SetShareToken(base64.RawURLEncoding.EncodeToString(token))
	} else {
		update.ClearShareToken()
	}
	count, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, publishing.ErrNotFound
	}
	row, err := c.client.ContentDraft.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	result := contentDraftRecord(row)
	return &result, nil
}

// SharedContentDraft is what a share link shows a guest: the draft's title,
// body and the comments guests left; nothing about the workspace.
type SharedContentDraft struct {
	Body          []any               `json:"body"`
	GuestComments []map[string]string `json:"guestComments"`
	PlainText     string              `json:"plainText"`
	Title         string              `json:"title"`
	UpdatedAt     time.Time           `json:"updatedAt"`
}

func sharedDraftByToken(ctx context.Context, client *ent.Client, token string) (*ent.ContentDraft, error) {
	if len(token) < 20 || len(token) > 64 {
		return nil, publishing.ErrNotFound
	}
	draft, err := client.ContentDraft.Query().Where(contentdraft.ShareToken(token)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	return draft, err
}

// GetSharedContentDraft reads a draft through its share link. The token is
// the only credential; a link that was turned off finds nothing.
func (c *Configuration) GetSharedContentDraft(ctx context.Context, token string) (*SharedContentDraft, error) {
	draft, err := sharedDraftByToken(ctx, c.client, token)
	if err != nil {
		return nil, err
	}
	return &SharedContentDraft{Body: nonNilBody(draft.Body), GuestComments: nonNilComments(draft.GuestComments),
		PlainText: draft.PlainText, Title: draft.Title, UpdatedAt: draft.UpdatedAt}, nil
}

func nonNilComments(comments []map[string]string) []map[string]string {
	if comments == nil {
		return []map[string]string{}
	}
	return comments
}

// GuestCommentInput is a comment left through a share link.
type GuestCommentInput struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// AddGuestComment keeps a guest's comment with the draft: at most 200, each
// with a name under 80 characters and text under 2,000.
func (c *Configuration) AddGuestComment(ctx context.Context, token string, input GuestCommentInput) (*SharedContentDraft, error) {
	name, text := strings.TrimSpace(input.Name), strings.TrimSpace(input.Text)
	if name == "" || text == "" || utf8.RuneCountInString(name) > 80 || utf8.RuneCountInString(text) > 2000 {
		return nil, invalid("Add your name (under 80 characters) and a comment (under 2,000).")
	}
	draft, err := sharedDraftByToken(ctx, c.client, token)
	if err != nil {
		return nil, err
	}
	comments := nonNilComments(draft.GuestComments)
	if len(comments) >= 200 {
		return nil, conflict("This draft has as many guest comments as it can keep.")
	}
	comments = append(comments, map[string]string{
		"createdAt": time.Now().UTC().Format(time.RFC3339), "name": name, "text": text,
	})
	// A guest comment leaves the draft's version alone: writers keep saving.
	if _, err := c.client.ContentDraft.UpdateOneID(draft.ID).SetGuestComments(comments).Save(ctx); err != nil {
		return nil, err
	}
	return c.GetSharedContentDraft(ctx, token)
}

// contentDraftRevisionEvery is how often editing keeps a revision.
const contentDraftRevisionEvery = 10 * time.Minute

// recordContentDraftRevision keeps the draft as it is now when the last
// revision is older than contentDraftRevisionEvery, or always when forced.
func recordContentDraftRevision(ctx context.Context, tx *ent.Tx, actor Actor, draft *ent.ContentDraft, force bool) error {
	if !force {
		recent, err := tx.ContentDraftRevision.Query().Where(contentdraftrevision.ContentDraftID(draft.ID),
			contentdraftrevision.CreatedAtGT(time.Now().Add(-contentDraftRevisionEvery))).Exist(ctx)
		if err != nil || recent {
			return err
		}
	}
	return tx.ContentDraftRevision.Create().SetID(cuid.New()).SetOrganizationID(draft.OrganizationID).
		SetContentDraftID(draft.ID).SetVersion(draft.Version).SetTitle(draft.Title).SetBody(nonNilBody(draft.Body)).
		SetPlainText(draft.PlainText).SetNillableCreatedByUserID(projectActor(actor)).Exec(ctx)
}

// ContentDraftRevisionRecord is a revision as the API returns it. The body is
// only in a single revision's read.
type ContentDraftRevisionRecord struct {
	Body            []any     `json:"body,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	CreatedByUserID *string   `json:"createdByUserId"`
	ID              string    `json:"id"`
	PlainText       string    `json:"plainText"`
	Title           string    `json:"title"`
	Version         int       `json:"version"`
}

// ListContentDraftRevisions lists a draft's revisions, newest first.
func (c *Configuration) ListContentDraftRevisions(ctx context.Context, actor Actor, draftID string) ([]ContentDraftRevisionRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	rows, err := c.client.ContentDraftRevision.Query().Where(contentdraftrevision.ContentDraftID(draftID),
		contentdraftrevision.OrganizationID(actor.OrganizationID)).
		Order(ent.Desc(contentdraftrevision.FieldCreatedAt)).Limit(100).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]ContentDraftRevisionRecord, 0, len(rows))
	for _, row := range rows {
		text := row.PlainText
		if utf8.RuneCountInString(text) > 280 {
			text = string([]rune(text)[:280])
		}
		items = append(items, ContentDraftRevisionRecord{CreatedAt: row.CreatedAt, CreatedByUserID: row.CreatedByUserID,
			ID: row.ID, PlainText: text, Title: row.Title, Version: row.Version})
	}
	return items, nil
}

// GetContentDraftRevision reads one revision with its body, to restore it.
func (c *Configuration) GetContentDraftRevision(ctx context.Context, actor Actor, draftID, revisionID string) (*ContentDraftRevisionRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	row, err := c.client.ContentDraftRevision.Query().Where(contentdraftrevision.ID(revisionID),
		contentdraftrevision.ContentDraftID(draftID), contentdraftrevision.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ContentDraftRevisionRecord{Body: nonNilBody(row.Body), CreatedAt: row.CreatedAt,
		CreatedByUserID: row.CreatedByUserID, ID: row.ID, PlainText: row.PlainText, Title: row.Title, Version: row.Version}, nil
}

// ResumeContentDraftThread posts the rest of a thread that stopped partway:
// a new post answering the last live part, carrying the replies that did not
// go out. It goes out now.
func (c *Configuration) ResumeContentDraftThread(ctx context.Context, actor Actor, postID string) (*MovedDraftPost, error) {
	if err := c.authorizeScheduling(ctx, actor); err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	post, err := tx.ScheduledPost.Query().Where(scheduledpost.ID(postID), scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.ContentDraftIDNotNil()).WithChannelConnection().Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	progress := post.ThreadProgress
	if post.Status != scheduledpost.StatusPUBLISHED || progress.Total == 0 || progress.Posted >= progress.Total {
		return nil, conflict("This post's thread went out in full; there is nothing to resume.")
	}
	answer := progress.LastReplyID
	if answer == "" && post.RemotePostID != nil {
		answer = *post.RemotePostID
	}
	if answer == "" {
		return nil, conflict("The live post this thread continues is unknown, so it cannot resume.")
	}
	rest := post.Replies[progress.Posted:]
	create := tx.ScheduledPost.Create().SetID(cuid.New()).SetOrganizationID(post.OrganizationID).
		SetNillableContentDraftID(post.ContentDraftID).SetChannelConnectionID(post.ChannelConnectionID).
		SetScheduledFor(time.Now().UTC()).SetStatus(scheduledpost.StatusSCHEDULED).SetCaption(rest[0].Caption).
		SetReplyTo(answer).SetIdempotencyKey(fmt.Sprintf("%s:resume:%d", post.IdempotencyKey, progress.Posted))
	if len(rest[0].AssetIDs) > 0 {
		create.SetAssetID(rest[0].AssetIDs[0]).SetAssetIds(rest[0].AssetIDs)
	}
	if len(rest) > 1 {
		create.SetReplies(append([]thread.Reply{}, rest[1:]...))
	}
	resumed, err := create.Save(ctx)
	if ent.IsConstraintError(err) {
		return nil, conflict("This thread is already resuming.")
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "post.thread_resumed", "scheduled_post", resumed.ID,
		map[string]any{"from": post.ID, "posted": progress.Posted}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &MovedDraftPost{Post: contentDraftPost(resumed, post.Edges.ChannelConnection.Platform), Scheduled: resumed}, nil
}

// PostMetricsReader reads a live post's engagement from its platform.
type PostMetricsReader interface {
	PostMetrics(ctx context.Context, organizationID, destinationID, platform, secretReference, remotePostID string) (postoptions.Metrics, error)
}

// WithPostMetrics sets the engagement reader (the direct social publisher).
func (c *Configuration) WithPostMetrics(reader PostMetricsReader) *Configuration {
	c.postMetrics = reader
	return c
}

// RefreshDraftPostMetrics reads a live draft post's engagement from its
// platform now and keeps it.
func (c *Configuration) RefreshDraftPostMetrics(ctx context.Context, actor Actor, postID string) (*ContentDraftPost, error) {
	ref, err := c.LiveDraftPost(ctx, actor, postID)
	if err != nil {
		return nil, err
	}
	if c.postMetrics == nil {
		return nil, conflict("Engagement is not available on this server.")
	}
	metrics, err := c.postMetrics.PostMetrics(ctx, ref.OrganizationID, ref.ConnectionExternalID, ref.Platform,
		ref.SecretReference, ref.RemotePostID)
	if err != nil {
		return nil, conflict("The platform did not return this post's engagement; try again later.")
	}
	return c.RecordDraftPostMetrics(ctx, actor, postID, metrics)
}

// LivePostRef is what reading a live post's engagement needs.
type LivePostRef struct {
	ConnectionExternalID string
	OrganizationID       string
	Platform             string
	PostID               string
	RemotePostID         string
	SecretReference      string
}

// LiveDraftPost finds a live draft post to read its engagement.
func (c *Configuration) LiveDraftPost(ctx context.Context, actor Actor, postID string) (*LivePostRef, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	post, err := c.client.ScheduledPost.Query().Where(scheduledpost.ID(postID), scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.ContentDraftIDNotNil()).WithChannelConnection().Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if post.Status != scheduledpost.StatusPUBLISHED || post.RemotePostID == nil {
		return nil, conflict("Engagement is read once the post is live.")
	}
	connection := post.Edges.ChannelConnection
	return &LivePostRef{ConnectionExternalID: connection.ExternalAccountID, OrganizationID: post.OrganizationID,
		Platform: connection.Platform, PostID: post.ID, RemotePostID: *post.RemotePostID,
		SecretReference: connection.SecretReference}, nil
}

// RecordDraftPostMetrics keeps a live post's engagement as just read.
func (c *Configuration) RecordDraftPostMetrics(ctx context.Context, actor Actor, postID string, metrics postoptions.Metrics) (*ContentDraftPost, error) {
	post, err := c.client.ScheduledPost.Query().Where(scheduledpost.ID(postID), scheduledpost.OrganizationID(actor.OrganizationID)).
		WithChannelConnection().Only(ctx)
	if err != nil {
		return nil, err
	}
	saved, err := c.client.ScheduledPost.UpdateOne(post).SetMetrics(metrics).SetMetricsAt(time.Now().UTC()).Save(ctx)
	if err != nil {
		return nil, err
	}
	result := contentDraftPost(saved, post.Edges.ChannelConnection.Platform)
	return &result, nil
}
