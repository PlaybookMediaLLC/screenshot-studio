package product

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/socialset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
	"github.com/lucsky/cuid"
)

// Content drafts (RFC 037): posts written by hand in the document editor.
// Reading needs any workspace role; writing needs the roles that edit
// artifacts. Every operation is plan-gated by contentDraftFeature.
const (
	contentDraftFeature       = "content:drafts"
	contentDraftTitleLimit    = 200
	contentDraftBodyLimit     = 1 << 20
	contentDraftTextLimit     = 100_000
	contentDraftAssetLimit    = 20
	contentDraftChannelLimit  = 10
	contentDraftThreadsLimit  = 256 << 10
	contentDraftUntitledTitle = "Untitled draft"
)

var (
	contentDraftEditRoles = []string{"owner", "admin", "creator"}
	// The same shape the HTTP layer accepts for path IDs: a cuid or a UUID.
	contentDraftRefPattern = regexp.MustCompile(`^(?:[a-z0-9]{10,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`)
)

// ContentDraftVersionConflictError refuses a write made against an older
// version. Current is the version the draft is at now.
type ContentDraftVersionConflictError struct{ Current int }

func (e *ContentDraftVersionConflictError) Error() string {
	return fmt.Sprintf("This draft was saved elsewhere since you opened it; it is now at version %d.", e.Current)
}

func (e *ContentDraftVersionConflictError) Unwrap() error { return publishing.ErrConflict }

// ContentDraftRecord is a draft as the API returns it. The collaboration
// state is not part of it.
type ContentDraftRecord struct {
	AssetIDs             []string          `json:"assetIds"`
	Body                 []any             `json:"body"`
	ChannelConnectionIDs []string          `json:"channelConnectionIds"`
	CreatedAt            time.Time         `json:"createdAt"`
	CreatedByUserID      *string           `json:"createdByUserId"`
	ChannelText          map[string]string `json:"channelText"`
	Discussions          map[string]any    `json:"discussions"`
	ID                   string            `json:"id"`
	OrganizationID       string            `json:"organizationId"`
	PlainText            string            `json:"plainText"`
	Status               string            `json:"status"`
	Title                string            `json:"title"`
	UpdatedAt            time.Time         `json:"updatedAt"`
	UpdatedByUserID      *string           `json:"updatedByUserId"`
	Version              int               `json:"version"`
	// Review before scheduling: none, pending, approved or changes_requested;
	// approval holds for ApprovedVersion only.
	ApprovedVersion  *int                `json:"approvedVersion"`
	ReviewNote       *string             `json:"reviewNote"`
	ReviewStatus     string              `json:"reviewStatus"`
	ReviewedByUserID *string             `json:"reviewedByUserId"`
	ShareToken       *string             `json:"shareToken"`
	GuestComments    []map[string]string `json:"guestComments"`
	// PublishedPosts counts the draft's live posts (lists only).
	PublishedPosts int `json:"publishedPosts"`
	// The draft's social set and what it copied from the set's defaults when
	// it was created (RFC 043); later changes to the set leave these alone.
	Engagement         schema.Engagement `json:"engagement"`
	NaturalPostingTime bool              `json:"naturalPostingTime"`
	PlannedFor         *time.Time        `json:"plannedFor"`
	PrimaryPlatform    *string           `json:"primaryPlatform"`
	SocialSetID        *string           `json:"socialSetId"`
	Tags               []string          `json:"tags"`
}

// ContentDraftPage is one page of a workspace's drafts, newest first.
type ContentDraftPage struct {
	Items      []ContentDraftRecord `json:"items"`
	NextCursor *string              `json:"nextCursor"`
}

// ContentDraftListQuery filters a draft list. Status is empty for every
// status except archived; SocialSetID is empty for every set the actor sees.
type ContentDraftListQuery struct {
	Cursor      string
	Limit       int
	SocialSetID string
	Status      string
}

// ContentDraftInput is a new draft. Every field is optional.
type ContentDraftInput struct {
	AssetIDs             []string          `json:"assetIds"`
	Body                 []any             `json:"body"`
	ChannelConnectionIDs []string          `json:"channelConnectionIds"`
	ChannelText          map[string]string `json:"channelText"`
	Discussions          map[string]any    `json:"discussions"`
	PlainText            string            `json:"plainText"`
	Title                string            `json:"title"`
	// SocialSetID is the set the draft belongs to; empty is the workspace's
	// default set. Without ChannelConnectionIDs the draft starts with the
	// set's default platforms.
	SocialSetID string `json:"socialSetId"`
}

// ContentDraftUpdate changes the fields it sets, based on BaseVersion.
// Status may move between draft and archived; scheduled is set by scheduling.
type ContentDraftUpdate struct {
	AssetIDs             *[]string          `json:"assetIds"`
	BaseVersion          int                `json:"baseVersion"`
	Body                 *[]any             `json:"body"`
	ChannelConnectionIDs *[]string          `json:"channelConnectionIds"`
	ChannelText          *map[string]string `json:"channelText"`
	Discussions          *map[string]any    `json:"discussions"`
	PlainText            *string            `json:"plainText"`
	Status               *string            `json:"status"`
	Title                *string            `json:"title"`
	// The draft's own choices, which start as copies of its set's defaults.
	NaturalPostingTime *bool   `json:"naturalPostingTime"`
	PrimaryPlatform    *string `json:"primaryPlatform"`
	// Tags and PlannedFor are experiments; PlannedFor is RFC 3339, or empty to clear.
	PlannedFor *string   `json:"plannedFor"`
	Tags       *[]string `json:"tags"`
}

func contentDraftRecord(row *ent.ContentDraft) ContentDraftRecord {
	return ContentDraftRecord{AssetIDs: nonNilStrings(row.AssetIds), Body: nonNilBody(row.Body),
		ChannelConnectionIDs: nonNilStrings(row.ChannelConnectionIds), CreatedAt: row.CreatedAt,
		CreatedByUserID: row.CreatedByUserID, ChannelText: nonNilChannelText(row.ChannelText), Discussions: nonNilDiscussions(row.Discussions), ID: row.ID, OrganizationID: row.OrganizationID, PlainText: row.PlainText,
		Status: string(row.Status), Title: row.Title, UpdatedAt: row.UpdatedAt, UpdatedByUserID: row.UpdatedByUserID,
		Version: row.Version, ApprovedVersion: row.ApprovedVersion, ReviewNote: row.ReviewNote,
		ReviewStatus: string(row.ReviewStatus), ReviewedByUserID: row.ReviewedByUserID, ShareToken: row.ShareToken,
		GuestComments: nonNilComments(row.GuestComments), Engagement: row.Engagement,
		NaturalPostingTime: row.NaturalPostingTime, PlannedFor: row.PlannedFor, PrimaryPlatform: row.PrimaryPlatform,
		SocialSetID: row.SocialSetID, Tags: nonNilStrings(row.Tags)}
}

func nonNilBody(body []any) []any {
	if body == nil {
		return []any{}
	}
	return body
}

func nonNilDiscussions(discussions map[string]any) map[string]any {
	if discussions == nil {
		return map[string]any{}
	}
	return discussions
}

func nonNilChannelText(text map[string]string) map[string]string {
	if text == nil {
		return map[string]string{}
	}
	return text
}

// contentDraftChannelText checks per-channel text: a draft channel each, and
// within contentDraftTextLimit. Empty text is dropped (the body applies).
func contentDraftChannelText(text map[string]string) (map[string]string, error) {
	out := map[string]string{}
	for channel, value := range text {
		if _, ok := draftChannelLimits[channel]; !ok {
			return nil, invalid("Channel text is for a draft channel: x, linkedin, instagram, threads, bluesky or mastodon.")
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len(value) > contentDraftTextLimit {
			return nil, invalid("Keep each channel's text under the draft's text limit.")
		}
		out[channel] = value
	}
	return out, nil
}

// contentDraftDiscussions bounds the comment threads kept with a draft.
func contentDraftDiscussions(discussions map[string]any) (map[string]any, error) {
	if discussions == nil {
		return map[string]any{}, nil
	}
	encoded, err := json.Marshal(discussions)
	if err != nil || len(encoded) > contentDraftThreadsLimit {
		return nil, invalid("Keep the draft's comments under 256 KB.")
	}
	return discussions, nil
}

func contentDraftTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return contentDraftUntitledTitle, nil
	}
	if utf8.RuneCountInString(title) > contentDraftTitleLimit {
		return "", invalid(fmt.Sprintf("Use a title of up to %d characters.", contentDraftTitleLimit))
	}
	return title, nil
}

func contentDraftBody(body []any) ([]any, error) {
	if body == nil {
		return []any{}, nil
	}
	encoded, err := json.Marshal(body)
	if err != nil || len(encoded) > contentDraftBodyLimit {
		return nil, invalid("Keep the draft under 1 MB.")
	}
	return body, nil
}

func contentDraftText(text string) (string, error) {
	if utf8.RuneCountInString(text) > contentDraftTextLimit {
		return "", invalid("The draft's text is too long.")
	}
	return text, nil
}

// uniqueIDs drops duplicates, keeping the first occurrence's order.
func uniqueIDs(ids []string, limit int, what string) ([]string, error) {
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if !contentDraftRefPattern.MatchString(id) {
			return nil, invalid(fmt.Sprintf("Every %s must be a valid ID.", what))
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	if len(out) > limit {
		return nil, invalid(fmt.Sprintf("Attach at most %d %ss.", limit, what))
	}
	return out, nil
}

// contentDraftAssets checks that every asset is an uploaded asset of this
// workspace, so a draft cannot point at another workspace's files.
func contentDraftAssets(ctx context.Context, tx *ent.Tx, organizationID string, ids []string) ([]string, error) {
	ids, err := uniqueIDs(ids, contentDraftAssetLimit, "asset")
	if err != nil || len(ids) == 0 {
		return ids, err
	}
	count, err := tx.Asset.Query().Where(asset.IDIn(ids...), asset.OrganizationID(organizationID),
		asset.StatusEQ(asset.StatusUPLOADED)).Count(ctx)
	if err != nil {
		return nil, err
	}
	if count != len(ids) {
		return nil, invalid("Every image must be an uploaded asset of this workspace.")
	}
	return ids, nil
}

// contentDraftChannels checks that every channel is a connection of this
// workspace and, for a draft in a social set, an account of that set.
func contentDraftChannels(ctx context.Context, tx *ent.Tx, organizationID string, socialSetID *string, ids []string) ([]string, error) {
	ids, err := uniqueIDs(ids, contentDraftChannelLimit, "channel")
	if err != nil || len(ids) == 0 {
		return ids, err
	}
	query := tx.ChannelConnection.Query().Where(channelconnection.IDIn(ids...), channelconnection.OrganizationID(organizationID))
	if socialSetID != nil {
		query.Where(channelconnection.SocialSetID(*socialSetID))
	}
	count, err := query.Count(ctx)
	if err != nil {
		return nil, err
	}
	if count != len(ids) {
		if socialSetID != nil {
			return nil, invalid("Every channel must be an account of the draft's social set.")
		}
		return nil, invalid("Every channel must be a connection of this workspace.")
	}
	return ids, nil
}

// contentDraftVisible reports whether actor may see draft: a draft in no set
// (written before RFC 043) is the workspace's, otherwise it follows its set.
func contentDraftVisible(ctx context.Context, client *ent.Client, actor Actor, draft *ent.ContentDraft) (bool, error) {
	if draft.SocialSetID == nil {
		return true, nil
	}
	set, err := client.SocialSet.Query().Where(socialset.ID(*draft.SocialSetID), socialset.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if set.DeletedAt != nil {
		// A deleted set's archived drafts stay readable to whoever could see the set.
		copied := *set
		copied.DeletedAt = nil
		return socialSetVisible(&copied, actor), nil
	}
	return socialSetVisible(set, actor), nil
}

// visibleContentDraft loads a draft of the workspace that actor may see; any
// other draft, including one in someone else's private set, is not found.
func visibleContentDraft(ctx context.Context, client *ent.Client, actor Actor, id string) (*ent.ContentDraft, error) {
	draft, err := client.ContentDraft.Query().Where(contentdraft.ID(id), contentdraft.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	visible, err := contentDraftVisible(ctx, client, actor, draft)
	if err != nil {
		return nil, err
	}
	if !visible {
		return nil, publishing.ErrNotFound
	}
	return draft, nil
}

// draftVisibilityPredicate keeps drafts in no set or in a set actor sees.
func (c *Configuration) draftVisibilityPredicate(ctx context.Context, actor Actor) (predicate.ContentDraft, error) {
	ids, err := c.visibleSocialSetIDs(ctx, actor)
	if err != nil {
		return nil, err
	}
	return contentdraft.Or(contentdraft.SocialSetIDIsNil(), contentdraft.SocialSetIDIn(ids...)), nil
}

// draftDefaults resolves a new draft's set and the defaults it copies: its
// set's default platforms that have an active account, in order, the primary
// platform among them, natural posting times and engagement defaults.
func (c *Configuration) draftDefaults(ctx context.Context, tx *ent.Tx, actor Actor, socialSetID string) (*ent.SocialSet, []string, *string, error) {
	var set *ent.SocialSet
	var err error
	if socialSetID == "" {
		if set, err = c.defaultSocialSet(ctx, actor.OrganizationID); err != nil {
			return nil, nil, nil, err
		}
		if !socialSetVisible(set, actor) {
			return nil, nil, nil, notFound("Social set not found.")
		}
	} else if set, err = visibleSocialSet(ctx, tx.Client(), actor, socialSetID); err != nil {
		return nil, nil, nil, err
	}
	connections, err := tx.ChannelConnection.Query().Where(channelconnection.SocialSetID(set.ID),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE)).All(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	byPlatform := map[string]string{}
	for _, connection := range connections {
		byPlatform[connection.Platform] = connection.ID
	}
	channels := []string{}
	var primary *string
	for _, platform := range set.DefaultPlatforms {
		if id, ok := byPlatform[platform]; ok {
			channels = append(channels, id)
			if primary == nil || (set.PrimaryPlatform != nil && *set.PrimaryPlatform == platform) {
				value := platform
				primary = &value
			}
		}
	}
	return set, channels, primary, nil
}

// draftTags normalizes tags: trimmed, lowercase, distinct, at most ten of at
// most 32 characters.
func draftTags(tags []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" {
			continue
		}
		if utf8.RuneCountInString(tag) > 32 {
			return nil, invalid("Keep each tag to 32 characters.")
		}
		if !seen[tag] {
			seen[tag] = true
			out = append(out, tag)
		}
	}
	if len(out) > 10 {
		return nil, invalid("Add at most 10 tags to a draft.")
	}
	return out, nil
}

// authorizeContentDrafts checks the role and the plan for a draft operation.
func (c *Configuration) authorizeContentDrafts(ctx context.Context, actor Actor, write bool) error {
	var err error
	if write {
		err = c.authorizeRoles(ctx, actor, contentDraftEditRoles...)
	} else {
		err = c.AuthorizeRead(ctx, actor)
	}
	if err != nil {
		return err
	}
	return c.requireWorkspaceFeature(ctx, actor.OrganizationID, contentDraftFeature)
}

func (c *Configuration) CreateContentDraft(ctx context.Context, actor Actor, input ContentDraftInput) (*ContentDraftRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return nil, err
	}
	title, err := contentDraftTitle(input.Title)
	if err != nil {
		return nil, err
	}
	body, err := contentDraftBody(input.Body)
	if err != nil {
		return nil, err
	}
	text, err := contentDraftText(input.PlainText)
	if err != nil {
		return nil, err
	}
	discussions, err := contentDraftDiscussions(input.Discussions)
	if err != nil {
		return nil, err
	}
	channelText, err := contentDraftChannelText(input.ChannelText)
	if err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	assets, err := contentDraftAssets(ctx, tx, actor.OrganizationID, input.AssetIDs)
	if err != nil {
		return nil, err
	}
	set, defaults, primary, err := c.draftDefaults(ctx, tx, actor, input.SocialSetID)
	if err != nil {
		return nil, err
	}
	channels := defaults
	if input.ChannelConnectionIDs != nil {
		if channels, err = contentDraftChannels(ctx, tx, actor.OrganizationID, &set.ID, input.ChannelConnectionIDs); err != nil {
			return nil, err
		}
	}
	engagement := set.EngagementDefaults
	draftID := cuid.New()
	if err = recordDiscussionActivity(ctx, tx, actor, &ent.ContentDraft{ID: draftID, Discussions: map[string]any{}}, discussions); err != nil {
		return nil, err
	}
	row, err := tx.ContentDraft.Create().SetID(draftID).SetOrganizationID(actor.OrganizationID).SetTitle(title).
		SetBody(body).SetPlainText(text).SetAssetIds(assets).SetChannelConnectionIds(channels).SetDiscussions(discussions).SetChannelText(channelText).
		SetSocialSetID(set.ID).SetNillablePrimaryPlatform(primary).SetNaturalPostingTime(set.NaturalPostingTimes).
		SetEngagement(engagement).
		SetNillableCreatedByUserID(projectActor(actor)).SetNillableUpdatedByUserID(projectActor(actor)).Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.content_draft_created", "content_draft", row.ID); err != nil {
		return nil, err
	}
	if err := emitDraftEvent(ctx, tx, row, webhooks.DraftCreated, nil); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := contentDraftRecord(row.Unwrap())
	return &result, nil
}

func (c *Configuration) GetContentDraft(ctx context.Context, actor Actor, id string) (*ContentDraftRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	row, err := visibleContentDraft(ctx, c.client, actor, id)
	if err != nil {
		return nil, err
	}
	result := contentDraftRecord(row)
	return &result, nil
}

func (c *Configuration) ListContentDrafts(ctx context.Context, actor Actor, query ContentDraftListQuery) (*ContentDraftPage, error) {
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	if query.Limit < 1 || query.Limit > 100 {
		query.Limit = 24
	}
	visible, err := c.draftVisibilityPredicate(ctx, actor)
	if err != nil {
		return nil, err
	}
	rows := c.client.ContentDraft.Query().Where(contentdraft.OrganizationID(actor.OrganizationID), visible)
	if query.SocialSetID != "" {
		rows.Where(contentdraft.SocialSetID(query.SocialSetID))
	}
	switch query.Status {
	case "":
		rows.Where(contentdraft.StatusNEQ(contentdraft.StatusArchived))
	case "draft", "scheduled", "archived":
		rows.Where(contentdraft.StatusEQ(contentdraft.Status(query.Status)))
	default:
		return nil, invalid("Filter by draft, scheduled, or archived.")
	}
	if query.Cursor != "" {
		at, id, err := decodeTimeCursor(query.Cursor)
		if err != nil {
			return nil, err
		}
		rows.Where(contentdraft.Or(contentdraft.UpdatedAtLT(at), contentdraft.And(contentdraft.UpdatedAt(at), contentdraft.IDLT(id))))
	}
	found, err := rows.Order(ent.Desc(contentdraft.FieldUpdatedAt), ent.Desc(contentdraft.FieldID)).Limit(query.Limit + 1).All(ctx)
	if err != nil {
		return nil, err
	}
	page := &ContentDraftPage{Items: make([]ContentDraftRecord, 0, len(found))}
	if len(found) > query.Limit {
		found = found[:query.Limit]
		last := found[len(found)-1]
		next := encodeTimeCursor(last.UpdatedAt, last.ID)
		page.NextCursor = &next
	}
	ids := make([]string, 0, len(found))
	for _, row := range found {
		ids = append(ids, row.ID)
	}
	live, err := c.client.ScheduledPost.Query().Where(scheduledpost.ContentDraftIDIn(ids...),
		scheduledpost.OrganizationID(actor.OrganizationID), scheduledpost.StatusEQ(scheduledpost.StatusPUBLISHED)).All(ctx)
	if err != nil {
		return nil, err
	}
	published := map[string]int{}
	for _, post := range live {
		published[*post.ContentDraftID]++
	}
	for _, row := range found {
		record := contentDraftRecord(row)
		record.PublishedPosts = published[row.ID]
		page.Items = append(page.Items, record)
	}
	return page, nil
}

func encodeTimeCursor(at time.Time, id string) string {
	encoded, _ := json.Marshal(projectCursor{ID: id, Value: at.UTC().Format(time.RFC3339Nano)})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodeTimeCursor(raw string) (time.Time, string, error) {
	var cursor projectCursor
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(decoded, &cursor) != nil || cursor.ID == "" {
		return time.Time{}, "", invalid("The page cursor is not valid.")
	}
	at, err := time.Parse(time.RFC3339Nano, cursor.Value)
	if err != nil {
		return time.Time{}, "", invalid("The page cursor is not valid.")
	}
	return at, cursor.ID, nil
}

// applyContentDraftUpdate validates the fields an update sets onto the update builder.
func (c *Configuration) applyContentDraftUpdate(ctx context.Context, tx *ent.Tx, actor Actor, draft *ent.ContentDraft,
	update *ent.ContentDraftUpdate, input ContentDraftUpdate) error {
	if input.Tags != nil {
		if err := c.requireExperiment(ctx, actor, ExperimentDraftTags); err != nil {
			return err
		}
		tags, err := draftTags(*input.Tags)
		if err != nil {
			return err
		}
		update.SetTags(tags)
	}
	if input.PlannedFor != nil {
		if err := c.requireExperiment(ctx, actor, ExperimentDraftPlanning); err != nil {
			return err
		}
		if *input.PlannedFor == "" {
			update.ClearPlannedFor()
		} else {
			at, err := time.Parse(time.RFC3339, *input.PlannedFor)
			if err != nil {
				return invalid("Plan the draft for a date and time.")
			}
			update.SetPlannedFor(at.UTC())
		}
	}
	if input.NaturalPostingTime != nil {
		update.SetNaturalPostingTime(*input.NaturalPostingTime)
	}
	if input.PrimaryPlatform != nil {
		if *input.PrimaryPlatform == "" {
			update.ClearPrimaryPlatform()
		} else if _, ok := draftPlatformChannels[*input.PrimaryPlatform]; !ok {
			return invalid("The primary platform is a draft platform.")
		} else {
			update.SetPrimaryPlatform(*input.PrimaryPlatform)
		}
	}
	if input.Title != nil {
		title, err := contentDraftTitle(*input.Title)
		if err != nil {
			return err
		}
		update.SetTitle(title)
	}
	if input.Body != nil {
		body, err := contentDraftBody(*input.Body)
		if err != nil {
			return err
		}
		update.SetBody(body)
	}
	if input.PlainText != nil {
		text, err := contentDraftText(*input.PlainText)
		if err != nil {
			return err
		}
		update.SetPlainText(text)
	}
	if input.AssetIDs != nil {
		assets, err := contentDraftAssets(ctx, tx, actor.OrganizationID, *input.AssetIDs)
		if err != nil {
			return err
		}
		update.SetAssetIds(assets)
	}
	if input.ChannelConnectionIDs != nil {
		channels, err := contentDraftChannels(ctx, tx, actor.OrganizationID, draft.SocialSetID, *input.ChannelConnectionIDs)
		if err != nil {
			return err
		}
		update.SetChannelConnectionIds(channels)
	}
	if input.Discussions != nil {
		discussions, err := contentDraftDiscussions(*input.Discussions)
		if err != nil {
			return err
		}
		update.SetDiscussions(discussions)
	}
	if input.ChannelText != nil {
		channelText, err := contentDraftChannelText(*input.ChannelText)
		if err != nil {
			return err
		}
		update.SetChannelText(channelText)
	}
	if input.Status != nil {
		if *input.Status != "draft" && *input.Status != "archived" {
			return invalid("A draft can be set to draft or archived; scheduling sets scheduled.")
		}
		update.SetStatus(contentdraft.Status(*input.Status))
	}
	return nil
}

func (c *Configuration) UpdateContentDraft(ctx context.Context, actor Actor, id string, input ContentDraftUpdate) (*ContentDraftRecord, error) {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return nil, err
	}
	if input.BaseVersion < 1 {
		return nil, invalid("baseVersion is required.")
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if input.Discussions != nil {
		if _, err = tx.PlatformExec(ctx, `SELECT id FROM content_draft WHERE id=$1 AND "organizationId"=$2 FOR UPDATE`, id, actor.OrganizationID); err != nil {
			return nil, err
		}
	}
	previous, err := visibleContentDraft(ctx, tx.Client(), actor, id)
	if err != nil {
		return nil, err
	}
	if input.Discussions != nil {
		if err = recordDiscussionActivity(ctx, tx, actor, previous, *input.Discussions); err != nil {
			return nil, err
		}
	}
	// The version check and the write are one statement, so two writers based
	// on the same version can never both succeed.
	update := tx.ContentDraft.Update().Where(contentdraft.ID(id), contentdraft.OrganizationID(actor.OrganizationID),
		contentdraft.Version(input.BaseVersion)).AddVersion(1).SetNillableUpdatedByUserID(projectActor(actor))
	if err := c.applyContentDraftUpdate(ctx, tx, actor, previous, update, input); err != nil {
		return nil, err
	}
	count, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, contentDraftMiss(ctx, tx, actor, id)
	}
	row, err := tx.ContentDraft.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := recordContentDraftRevision(ctx, tx, actor, row, false); err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.content_draft_updated", "content_draft", id,
		map[string]any{"version": row.Version}); err != nil {
		return nil, err
	}
	if err := emitDraftChanges(ctx, tx, previous, row); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := contentDraftRecord(row)
	return &result, nil
}

// contentDraftMiss explains a guarded write that touched no row: the draft is
// not in this workspace, or it moved past the version the writer had.
func contentDraftMiss(ctx context.Context, tx *ent.Tx, actor Actor, id string) error {
	current, err := tx.ContentDraft.Query().Where(contentdraft.ID(id), contentdraft.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	return &ContentDraftVersionConflictError{Current: current.Version}
}

func (c *Configuration) DeleteContentDraft(ctx context.Context, actor Actor, id string) error {
	if err := c.authorizeContentDrafts(ctx, actor, true); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	existing, err := visibleContentDraft(ctx, tx.Client(), actor, id)
	if err != nil {
		return err
	}
	count, err := tx.ContentDraft.Delete().Where(contentdraft.ID(id), contentdraft.OrganizationID(actor.OrganizationID)).Exec(ctx)
	if ent.IsConstraintError(err) {
		// Its scheduled posts keep the draft they came from.
		return conflict("This draft has scheduled posts. Archive it instead.")
	}
	if err != nil {
		return err
	}
	if count == 0 {
		return publishing.ErrNotFound
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.content_draft_deleted", "content_draft", id); err != nil {
		return err
	}
	if err := emitDraftEvent(ctx, tx, existing, webhooks.DraftDeleted, nil); err != nil {
		return err
	}
	return tx.Commit()
}
