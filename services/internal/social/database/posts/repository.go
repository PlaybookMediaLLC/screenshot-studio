// Package posts ports database/prisma/posts (PostsRepository and
// PostsService): posts and their groups, threads (child posts), tags, preview
// comments, scheduling and the post workflow start.
package posts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	dtos "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/comments"
	entErrors "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/popularposts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/tags"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/tagsposts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/google/uuid"
)

type Repository struct {
	client *ent.Client
}

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// Date marshals like a JavaScript Date, the way Prisma rows reach clients.
type Date struct{ time.Time }

func (d Date) MarshalJSON() ([]byte, error) { return json.Marshal(d.UTC().Format(ent.JSTime)) }

func datePtr(t *time.Time) *Date {
	if t == nil {
		return nil
	}
	return &Date{*t}
}

// PostIntegration is the integration `select` of the post list queries. Type
// is only selected by some of them.
type PostIntegration struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	ProviderIdentifier string  `json:"providerIdentifier"`
	Picture            *string `json:"picture"`
	Type               string  `json:"type,omitempty"`
}

func postIntegration(i *ent.Integration, withType bool) PostIntegration {
	out := PostIntegration{}
	if i == nil {
		return out
	}
	out = PostIntegration{ID: i.ID, Name: i.Name, ProviderIdentifier: i.ProviderIdentifier, Picture: i.Picture}
	if withType {
		out.Type = string(i.Type)
	}
	return out
}

// TagWrapper is `tags: { select: { tag: true } }`.
type TagWrapper struct {
	Tag *ent.Tags `json:"tag"`
}

func tagWrappers(p *ent.Post) []TagWrapper {
	out := []TagWrapper{}
	for _, t := range p.Edges.Tags {
		out = append(out, TagWrapper{Tag: t.Edges.Tag})
	}
	return out
}

// withLiveTags is `tags: { where: { tag: { deletedAt: null } }, select: { tag: true } }`.
func withLiveTags(q *ent.TagsPostsQuery) {
	q.Where(tagsposts.HasTagWith(tags.DeletedAtIsNil())).WithTag()
}

// ThreeHoursPost is searchForMissingThreeHoursPosts's select.
type ThreeHoursPost struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organizationId"`
	Integration    struct {
		ProviderIdentifier string `json:"providerIdentifier"`
	} `json:"integration"`
	PublishDate Date `json:"publishDate"`
}

func (r *Repository) SearchForMissingThreeHoursPosts(ctx context.Context) ([]ThreeHoursPost, error) {
	now := time.Now().UTC()
	list, err := r.client.Post.Query().Where(
		post.HasIntegrationWith(
			integration.RefreshNeeded(false),
			integration.InBetweenSteps(false),
			integration.Disabled(false),
			integration.DeletedAtIsNil(),
		),
		post.PublishDateGTE(now.AddDate(0, 0, -2)),
		post.PublishDateLT(now),
		post.StateEQ(post.StateQUEUE),
		post.DeletedAtIsNil(),
		post.ParentPostIDIsNil(),
	).WithIntegration().All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ThreeHoursPost, 0, len(list))
	for _, p := range list {
		item := ThreeHoursPost{ID: p.ID, OrganizationID: p.OrganizationID, PublishDate: Date{p.PublishDate}}
		item.Integration.ProviderIdentifier = p.Edges.Integration.ProviderIdentifier
		out = append(out, item)
	}
	return out, nil
}

// PostSummary is the select of getOldPosts, getPostsSince and the webhook payload.
type PostSummary struct {
	ID          string          `json:"id"`
	Content     string          `json:"content"`
	PublishDate Date            `json:"publishDate"`
	ReleaseURL  *string         `json:"releaseURL"`
	State       post.State      `json:"state"`
	Integration PostIntegration `json:"integration"`
}

func summaries(list []*ent.Post) []PostSummary {
	out := make([]PostSummary, 0, len(list))
	for _, p := range list {
		out = append(out, PostSummary{
			ID: p.ID, Content: p.Content, PublishDate: Date{p.PublishDate}, ReleaseURL: p.ReleaseURL,
			State: p.State, Integration: postIntegration(p.Edges.Integration, true),
		})
	}
	return out
}

func (r *Repository) GetOldPosts(ctx context.Context, orgID, date string) ([]PostSummary, error) {
	lte, err := parseDate(date, time.Local)
	if err != nil {
		return nil, err
	}
	list, err := r.client.Post.Query().Where(
		post.HasIntegrationWith(
			integration.RefreshNeeded(false),
			integration.InBetweenSteps(false),
			integration.Disabled(false),
		),
		post.OrganizationID(orgID),
		post.PublishDateLTE(lte),
		post.DeletedAtIsNil(),
		post.ParentPostIDIsNil(),
	).Order(ent.Desc(post.FieldPublishDate)).WithIntegration().All(ctx)
	if err != nil {
		return nil, err
	}
	return summaries(list), nil
}

func (r *Repository) UpdateImages(ctx context.Context, id, images string) (*ent.Post, error) {
	return r.client.Post.UpdateOneID(id).SetImage(images).Save(ctx)
}

type PostURL struct {
	ID         string  `json:"id"`
	ReleaseURL *string `json:"releaseURL"`
}

func (r *Repository) GetPostURLs(ctx context.Context, orgID string, ids []string) ([]PostURL, error) {
	list, err := r.client.Post.Query().Where(post.OrganizationID(orgID), post.IDIn(ids...)).
		Select(post.FieldID, post.FieldReleaseURL).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]PostURL, 0, len(list))
	for _, p := range list {
		out = append(out, PostURL{ID: p.ID, ReleaseURL: p.ReleaseURL})
	}
	return out, nil
}

// curatedError: Post.error persists the raw serialized workflow failure; only
// curated provider messages are surfaced to the calendar and the public API —
// bad_body failures whose message came from a provider handleErrors mapping
// or a hand-written provider throw (unmapped API responses carry the
// 'Unknown Error' placeholder instead). Internal debug strings (e.g. 'Refresh
// channel needed') and unmapped failures come out as null.
func curatedError(raw *string) *string {
	if raw == nil || *raw == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(*raw), &parsed); err != nil {
		return nil
	}
	var kind, message any
	if m := dig(parsed, "cause", "failure", "message"); truthy(m) {
		kind, message = dig(parsed, "cause", "type"), m
	} else {
		kind = dig(parsed, "failure", "cause", "applicationFailureInfo", "type")
		message = dig(parsed, "failure", "cause", "message")
	}
	s, ok := message.(string)
	if kind == "bad_body" && ok && s != "" && s != "Unknown Error" {
		return &s
	}
	return nil
}

func dig(v any, path ...string) any {
	for _, key := range path {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[key]
	}
	return v
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case string:
		return t != ""
	case bool:
		return t
	case float64:
		return t != 0
	}
	return true
}

// ListPost is getPostsList's post select.
type ListPost struct {
	ID             string              `json:"id"`
	Content        string              `json:"content"`
	PublishDate    Date                `json:"publishDate"`
	ReleaseURL     *string             `json:"releaseURL"`
	ReleaseID      *string             `json:"releaseId"`
	State          post.State          `json:"state"`
	IntervalInDays *int                `json:"intervalInDays"`
	Group          string              `json:"group"`
	CreationMethod post.CreationMethod `json:"creationMethod"`
	Tags           []TagWrapper        `json:"tags"`
	Integration    PostIntegration     `json:"integration"`
}

// CalendarPost is getPosts's post select; repeated posts carry actualDate,
// the publish date of the stored row.
type CalendarPost struct {
	ListPost
	Error      *string `json:"error"`
	Settings   *string `json:"settings"`
	ActualDate *Date   `json:"actualDate,omitempty"`
}

func listPost(p *ent.Post) ListPost {
	return ListPost{
		ID: p.ID, Content: p.Content, PublishDate: Date{p.PublishDate}, ReleaseURL: p.ReleaseURL,
		ReleaseID: p.ReleaseID, State: p.State, IntervalInDays: p.IntervalInDays, Group: p.Group,
		CreationMethod: p.CreationMethod, Tags: tagWrappers(p), Integration: postIntegration(p.Edges.Integration, false),
	}
}

func (r *Repository) GetPosts(ctx context.Context, orgID string, query *dtos.GetPostsDto) ([]CalendarPost, error) {
	// Use the provided start and end dates directly
	startDate, err := parseDate(query.StartDate, time.UTC)
	if err != nil {
		return nil, err
	}
	endDate, err := parseDate(query.EndDate, time.UTC)
	if err != nil {
		return nil, err
	}

	integrationWhere := []predicate.Integration{integration.DeletedAtIsNil(), integration.OrganizationID(orgID)}
	if query.Customer != "" {
		integrationWhere = append(integrationWhere, integration.CustomerID(query.Customer))
	}

	list, err := r.client.Post.Query().Where(
		post.OrganizationID(orgID),
		post.Or(
			post.And(post.PublishDateGTE(startDate), post.PublishDateLTE(endDate)),
			post.IntervalInDaysNotNil(),
		),
		post.HasIntegrationWith(integrationWhere...),
		post.DeletedAtIsNil(),
		post.ParentPostIDIsNil(),
	).WithIntegration().WithTags(withLiveTags).All(ctx)
	if err != nil {
		return nil, err
	}

	out := []CalendarPost{}
	for _, p := range list {
		item := CalendarPost{ListPost: listPost(p), Error: curatedError(p.Error), Settings: p.Settings}
		// ponytail: a negative interval would loop forever (as in the original app), so it shows once
		if p.IntervalInDays == nil || *p.IntervalInDays <= 0 {
			out = append(out, item)
			continue
		}

		publishDate := p.PublishDate.UTC()
		for startingDate := publishDate; !endDate.Before(startingDate); startingDate = startingDate.AddDate(0, 0, *p.IntervalInDays) {
			if !startingDate.Before(publishDate) {
				repeated := item
				repeated.PublishDate = Date{startingDate}
				repeated.ActualDate = &Date{p.PublishDate}
				out = append(out, repeated)
			}
		}
	}
	return out, nil
}

type PostsList struct {
	Posts   []ListPost `json:"posts"`
	Total   int        `json:"total"`
	Page    int        `json:"page"`
	Limit   int        `json:"limit"`
	HasMore bool       `json:"hasMore"`
}

func (r *Repository) GetPostsList(ctx context.Context, orgID string, query *dtos.GetPostsListDto) (*PostsList, error) {
	page := query.Page
	limit := query.Limit
	if limit == 0 {
		limit = 20
	}
	skip := page * limit

	stateFilter := query.State
	if stateFilter == "" {
		stateFilter = "all"
	}
	where := []predicate.Post{post.OrganizationID(orgID)}
	switch stateFilter {
	case "scheduled":
		where = append(where, post.StateEQ(post.StateQUEUE))
	case "draft":
		where = append(where, post.StateEQ(post.StateDRAFT))
	case "published":
		where = append(where, post.StateEQ(post.StatePUBLISHED))
	default:
		where = append(where, post.StateIn(post.StateQUEUE, post.StateDRAFT, post.StatePUBLISHED, post.StateERROR))
	}

	order := ent.Asc(post.FieldPublishDate)
	if stateFilter == "published" {
		order = ent.Desc(post.FieldPublishDate)
	} else {
		// Published posts were already posted (publishDate in the past), so fetch
		// all of them; everything else stays upcoming. Ordering handles the rest.
		where = append(where, post.PublishDateGTE(time.Now().UTC()))
	}

	integrationWhere := []predicate.Integration{integration.DeletedAtIsNil(), integration.OrganizationID(orgID)}
	if query.Customer != "" {
		integrationWhere = append(integrationWhere, integration.CustomerID(query.Customer))
	}
	if ids := query.IntegrationIDs(); ids != nil {
		integrationWhere = append(integrationWhere, integration.IDIn(ids...))
	}
	where = append(where,
		post.DeletedAtIsNil(),
		post.ParentPostIDIsNil(),
		post.IntervalInDaysIsNil(),
		post.HasIntegrationWith(integrationWhere...),
	)

	list, err := r.client.Post.Query().Where(where...).Offset(skip).Limit(limit).Order(order).
		WithIntegration().WithTags(withLiveTags).All(ctx)
	if err != nil {
		return nil, err
	}
	total, err := r.client.Post.Query().Where(where...).Count(ctx)
	if err != nil {
		return nil, err
	}

	posts := make([]ListPost, 0, len(list))
	for _, p := range list {
		posts = append(posts, listPost(p))
	}
	return &PostsList{Posts: posts, Total: total, Page: page, Limit: limit, HasMore: skip+len(posts) < total}, nil
}

// DeletePost soft-deletes the group and returns the id of its root post ("" when none).
func (r *Repository) DeletePost(ctx context.Context, orgID, group string) (string, error) {
	if err := r.client.Post.Update().Where(post.OrganizationID(orgID), post.Group(group)).
		SetDeletedAt(time.Now()).Exec(ctx); err != nil {
		return "", err
	}
	p, err := r.client.Post.Query().Where(post.OrganizationID(orgID), post.Group(group), post.ParentPostIDIsNil()).
		Select(post.FieldID).First(ctx)
	if ent.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return p.ID, nil
}

// GetPostsByGroup includes the integration and the live tags; orgID "" skips the org filter.
func (r *Repository) GetPostsByGroup(ctx context.Context, orgID, group string) ([]*ent.Post, error) {
	where := []predicate.Post{post.Group(group), post.DeletedAtIsNil()}
	if orgID != "" {
		where = append(where, post.OrganizationID(orgID))
	}
	return r.client.Post.Query().Where(where...).WithIntegration().WithTags(withLiveTags).All(ctx)
}

// GetPostsByBatch returns the posts of the other channels in the batch, without the given group.
func (r *Repository) GetPostsByBatch(ctx context.Context, orgID, batchID, exceptGroup string) ([]*ent.Post, error) {
	return r.client.Post.Query().Where(
		post.OrganizationID(orgID),
		post.BatchID(batchID),
		post.GroupNEQ(exceptGroup),
		post.DeletedAtIsNil(),
		post.HasIntegrationWith(integration.DeletedAtIsNil()),
	).Order(ent.Asc(post.FieldCreatedAt)).All(ctx)
}

// GetPost returns nil when the post does not exist or is deleted. It always
// includes childrenPost (deleted ones too, like Prisma's include).
func (r *Repository) GetPost(ctx context.Context, id string, includeIntegration bool, orgID string) (*ent.Post, error) {
	where := []predicate.Post{post.ID(id), post.DeletedAtIsNil()}
	if orgID != "" {
		where = append(where, post.OrganizationID(orgID))
	}
	q := r.client.Post.Query().Where(where...).WithChildrenPost()
	if includeIntegration {
		q = q.WithIntegration().WithTags(withLiveTags)
	}
	p, err := q.Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return p, err
}

func (r *Repository) UpdatePost(ctx context.Context, id, postID, releaseURL string) (*ent.Post, error) {
	return r.client.Post.UpdateOneID(id).SetState(post.StatePUBLISHED).SetReleaseURL(releaseURL).
		SetReleaseID(postID).Save(ctx)
}

// UpdateReleaseID only updates a post whose releaseId is still 'missing';
// releaseURL "" keeps the stored one.
func (r *Repository) UpdateReleaseID(ctx context.Context, id, orgID, releaseID, releaseURL string) (*ent.Post, error) {
	u := r.client.Post.UpdateOneID(id).Where(post.OrganizationID(orgID), post.ReleaseID("missing")).SetReleaseID(releaseID)
	if releaseURL != "" {
		u.SetReleaseURL(releaseURL)
	}
	return u.Save(ctx)
}

func (r *Repository) UpdateResolvedRelease(ctx context.Context, id, orgID, releaseID, releaseURL string) (*ent.Post, error) {
	return r.client.Post.UpdateOneID(id).Where(post.OrganizationID(orgID)).SetReleaseID(releaseID).
		SetReleaseURL(releaseURL).Save(ctx)
}

// jsonString is `typeof v === 'string' ? v : JSON.stringify(v)`.
func jsonString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	data, _ := json.Marshal(v)
	return string(data)
}

// present is JavaScript truthiness for the optional err/body arguments.
func present(v any) bool {
	if v == nil {
		return false
	}
	if s, ok := v.(string); ok {
		return s != ""
	}
	return true
}

// ChangeState sets the state (and the error when errValue is set) and, for
// ERROR with an error and a body, records an Errors row. errValue and body
// are strings or JSON-marshalable values; nil means absent.
func (r *Repository) ChangeState(ctx context.Context, id string, state post.State, errValue, body any) (*ent.Post, error) {
	u := r.client.Post.UpdateOneID(id).SetState(state)
	if present(errValue) {
		u.SetError(jsonString(errValue))
	}
	updated, err := u.Save(ctx)
	if err != nil {
		return nil, err
	}
	updated.Edges.Integration, err = r.client.Integration.Get(ctx, updated.IntegrationID)
	if err != nil {
		return nil, err
	}

	if state == post.StateERROR && present(errValue) && present(body) {
		_ = r.client.Errors.Create().
			SetMessage(jsonString(errValue)).
			SetOrganizationID(updated.OrganizationID).
			SetPlatform(updated.Edges.Integration.ProviderIdentifier).
			SetPostID(updated.ID).
			SetBody(jsonString(body)).
			Exec(ctx)
	}

	return updated, nil
}

func (r *Repository) GetErrorsByPostIDs(ctx context.Context, postIDs []string) ([]*ent.Errors, error) {
	return r.client.Errors.Query().Where(entErrors.PostIDIn(postIDs...)).Order(ent.Desc(entErrors.FieldCreatedAt)).All(ctx)
}

// ChangeDate: action schedule sets the state to QUEUE (or DRAFT if it was a
// draft) and clears the release; update does not change the state.
func (r *Repository) ChangeDate(ctx context.Context, orgID, id, date string, isDraft bool, action string) (*ent.Post, error) {
	publishDate, err := parseDate(date, time.Local)
	if err != nil {
		return nil, err
	}
	u := r.client.Post.UpdateOneID(id).Where(post.OrganizationID(orgID)).SetPublishDate(publishDate)
	if action == "schedule" {
		state := post.StateQUEUE
		if isDraft {
			state = post.StateDRAFT
		}
		u.SetState(state).ClearReleaseID().ClearReleaseURL()
	}
	return u.Save(ctx)
}

func (r *Repository) CountPostsFromDay(ctx context.Context, orgID string, date time.Time) (int, error) {
	return r.client.Post.Query().Where(
		post.OrganizationID(orgID),
		post.PublishDateGTE(date),
		post.Or(
			post.And(post.DeletedAtIsNil(), post.StateIn(post.StateQUEUE)),
			post.StateEQ(post.StatePUBLISHED),
		),
	).Count(ctx)
}

type CreateOrUpdateResult struct {
	PreviousPost string
	Posts        []*ent.Post
}

// CreateOrUpdatePost upserts one channel's post and its comments (a thread).
//
// keepGroup keeps the existing group instead of rotating it, so open clients
// (calendar) holding the group stay valid. Used by out-of-band updates
// (agent / MCP / public API); the dashboard keeps the rotate-and-sweep.
// batchID is shared by the posts saved together for several channels, so
// opening one of them in the editor brings the others.
func (r *Repository) CreateOrUpdatePost(ctx context.Context, state, orgID, date string, body *dtos.Post, tagList []dtos.Tags, creationMethod post.CreationMethod, inter *int, keepGroup bool, batchID string) (*CreateOrUpdateResult, error) {
	posts := []*ent.Post{}
	group := uuid.NewString()
	if keepGroup && body.Group != "" {
		group = body.Group
	}

	// an edited post stays in the batch it was created in, even when it is
	// saved on its own or with a group that was rotated since
	var ids []string
	for _, v := range body.Value {
		if v.ID != "" {
			ids = append(ids, v.ID)
		}
	}
	existingBatchID := ""
	if body.Group != "" || len(ids) > 0 {
		var or []predicate.Post
		if body.Group != "" {
			or = append(or, post.Group(body.Group))
		}
		if len(ids) > 0 {
			or = append(or, post.IDIn(ids...))
		}
		found, err := r.client.Post.Query().Where(
			post.OrganizationID(orgID), post.DeletedAtIsNil(), post.BatchIDNotNil(), post.Or(or...),
		).Select(post.FieldBatchID).First(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return nil, err
		}
		if found != nil && found.BatchID != nil {
			existingBatchID = *found.BatchID
		}
	}
	if existingBatchID != "" {
		batchID = existingBatchID
	}

	publishDate, err := parseDate(date, time.Local)
	if err != nil {
		return nil, err
	}

	// integration: { connect: { id, organizationId } }
	exists, err := r.client.Integration.Query().Where(
		integration.ID(body.Integration.ID), integration.OrganizationID(orgID),
	).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("integration %s not found in organization %s", body.Integration.ID, orgID)
	}

	var settings *string
	if len(body.Settings) > 0 && string(body.Settings) != "null" {
		s := compactJSON(body.Settings)
		settings = &s
	}

	for _, value := range body.Value {
		var image *string
		if value.Image != nil {
			data, err := json.Marshal(value.Image)
			if err != nil {
				return nil, err
			}
			s := string(data)
			image = &s
		}
		parentID := ""
		if len(posts) > 0 {
			parentID = posts[len(posts)-1].ID
		}
		var interval *int
		if inter != nil && *inter != 0 {
			interval = inter
		}
		var newState *post.State
		if state != "update" {
			s := post.StateQUEUE
			if state == "draft" {
				s = post.StateDRAFT
			}
			newState = &s
		}

		existing := false
		if value.ID != "" {
			if existing, err = r.client.Post.Query().Where(post.ID(value.ID)).Exist(ctx); err != nil {
				return nil, err
			}
		}

		var saved *ent.Post
		if existing {
			u := r.client.Post.UpdateOneID(value.ID).
				SetPublishDate(publishDate).
				SetIntegrationID(body.Integration.ID).
				SetContent(value.Content).
				SetDelay(value.Delay).
				SetGroup(group).
				SetApprovedSubmitForOrder(post.ApprovedSubmitForOrderNO).
				SetNillableSettings(settings).
				SetNillableImage(image).
				SetNillableState(newState).
				SetOrganizationID(orgID).
				ClearLastMessageID().
				ClearSubmittedForOrderID()
			if parentID != "" {
				u.SetParentPostID(parentID)
			} else {
				u.ClearParentPostID()
			}
			if batchID != "" {
				u.SetBatchID(batchID)
			}
			if interval != nil {
				u.SetIntervalInDays(*interval)
			} else {
				u.ClearIntervalInDays()
			}
			saved, err = u.Save(ctx)
		} else {
			c := r.client.Post.Create().
				SetPublishDate(publishDate).
				SetIntegrationID(body.Integration.ID).
				SetContent(value.Content).
				SetDelay(value.Delay).
				SetGroup(group).
				SetApprovedSubmitForOrder(post.ApprovedSubmitForOrderNO).
				SetCreationMethod(creationMethod).
				SetNillableSettings(settings).
				SetNillableImage(image).
				SetNillableState(newState).
				SetNillableIntervalInDays(interval).
				SetOrganizationID(orgID)
			if parentID != "" {
				c.SetParentPostID(parentID)
			}
			if batchID != "" {
				c.SetBatchID(batchID)
			}
			saved, err = c.Save(ctx)
		}
		if err != nil {
			return nil, err
		}
		posts = append(posts, saved)

		if len(posts) == 1 {
			if _, err := r.client.TagsPosts.Delete().Where(tagsposts.PostID(posts[0].ID)).Exec(ctx); err != nil {
				return nil, err
			}

			var labels []string
			for _, t := range tagList {
				if t.Label != "" {
					labels = append(labels, t.Label)
				}
			}
			if len(tagList) > 0 && len(labels) > 0 {
				found, err := r.client.Tags.Query().Where(
					tags.OrgID(orgID), tags.DeletedAtIsNil(), tags.NameIn(labels...),
				).All(ctx)
				if err != nil {
					return nil, err
				}
				if len(found) > 0 {
					builders := make([]*ent.TagsPostsCreate, 0, len(found))
					for _, t := range found {
						builders = append(builders, r.client.TagsPosts.Create().SetPostID(posts[len(posts)-1].ID).SetTagID(t.ID))
					}
					if err := r.client.TagsPosts.CreateBulk(builders...).Exec(ctx); err != nil {
						return nil, err
					}
				}
			}
		}
	}

	previousPost := ""
	if body.Group != "" {
		found, err := r.client.Post.Query().Where(
			post.Group(body.Group), post.DeletedAtIsNil(), post.ParentPostIDIsNil(),
		).Select(post.FieldID).First(ctx)
		if err != nil && !ent.IsNotFound(err) {
			return nil, err
		}
		if found != nil {
			previousPost = found.ID
		}
	}

	if body.Group != "" && !keepGroup {
		if err := r.client.Post.Update().Where(post.Group(body.Group), post.DeletedAtIsNil()).
			ClearParentPostID().SetDeletedAt(time.Now()).Exec(ctx); err != nil {
			return nil, err
		}
	}

	// keepGroup: the updated rows still carry the old group, so sweep only the
	// rows dropped from it (removed comments) by id instead of by group.
	if body.Group != "" && keepGroup {
		kept := make([]string, 0, len(posts))
		for _, p := range posts {
			kept = append(kept, p.ID)
		}
		if err := r.client.Post.Update().Where(post.Group(body.Group), post.DeletedAtIsNil(), post.IDNotIn(kept...)).
			ClearParentPostID().SetDeletedAt(time.Now()).Exec(ctx); err != nil {
			return nil, err
		}
	}

	return &CreateOrUpdateResult{PreviousPost: previousPost, Posts: posts}, nil
}

// compactJSON is JSON.stringify of the parsed value.
func compactJSON(raw json.RawMessage) string {
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return string(raw)
	}
	return buf.String()
}

type SubmitResult struct {
	ID                string  `json:"id"`
	Description       *string `json:"description"`
	SubmittedForOrder *struct {
		MessageGroupID string `json:"messageGroupId"`
	} `json:"submittedForOrder"`
}

func (r *Repository) Submit(ctx context.Context, id, order, buyerOrganizationID string) (*SubmitResult, error) {
	p, err := r.client.Post.UpdateOneID(id).
		SetSubmittedForOrderID(order).
		SetApprovedSubmitForOrder(post.ApprovedSubmitForOrderWAITING_CONFIRMATION).
		SetSubmittedForOrganizationID(buyerOrganizationID).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	out := &SubmitResult{ID: p.ID, Description: p.Description}
	o, err := r.client.Orders.Get(ctx, order)
	if err != nil {
		return nil, err
	}
	out.SubmittedForOrder = &struct {
		MessageGroupID string `json:"messageGroupId"`
	}{MessageGroupID: o.MessageGroupID}
	return out, nil
}

func (r *Repository) UpdateMessage(ctx context.Context, id, messageID string) (*ent.Post, error) {
	return r.client.Post.UpdateOneID(id).SetLastMessageID(messageID).Save(ctx)
}

// GetPostByID includes the integration and the marketplace order; org ""
// skips the org filter. It returns nil when the post does not exist.
func (r *Repository) GetPostByID(ctx context.Context, id, org string) (*ent.Post, error) {
	where := []predicate.Post{post.ID(id)}
	if org != "" {
		where = append(where, post.OrganizationID(org))
	}
	p, err := r.client.Post.Query().Where(where...).
		WithIntegration().
		WithSubmittedForOrder(func(q *ent.OrdersQuery) {
			q.WithPosts(func(q *ent.PostQuery) { q.Where(post.StateEQ(post.StatePUBLISHED)) }).
				WithOrdersItems().
				WithSeller(func(q *ent.UserQuery) { q.Select(user.FieldID, user.FieldAccount) })
		}).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return p, err
}

type TimelinePost struct {
	ID             string              `json:"id"`
	State          post.State          `json:"state"`
	PublishDate    Date                `json:"publishDate"`
	CreatedAt      Date                `json:"createdAt"`
	UpdatedAt      Date                `json:"updatedAt"`
	DeletedAt      *Date               `json:"deletedAt"`
	ReleaseID      *string             `json:"releaseId"`
	ReleaseURL     *string             `json:"releaseURL"`
	Error          *string             `json:"error"`
	CreationMethod post.CreationMethod `json:"creationMethod"`
	Group          string              `json:"group"`
	ParentPostID   *string             `json:"parentPostId"`
}

type TimelineIntegration struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	ProviderIdentifier string `json:"providerIdentifier"`
	Disabled           bool   `json:"disabled"`
	RefreshNeeded      bool   `json:"refreshNeeded"`
	DeletedAt          *Date  `json:"deletedAt"`
}

type TimelineError struct {
	ID        string `json:"id"`
	Platform  string `json:"platform"`
	Message   string `json:"message"`
	Body      string `json:"body"`
	CreatedAt Date   `json:"createdAt"`
}

type PostTimeline struct {
	TimelinePost
	Integration  TimelineIntegration `json:"integration"`
	ChildrenPost []TimelinePost      `json:"childrenPost"`
	Errors       []TimelineError     `json:"errors"`
}

func timelinePost(p *ent.Post) TimelinePost {
	return TimelinePost{
		ID: p.ID, State: p.State, PublishDate: Date{p.PublishDate}, CreatedAt: Date{p.CreatedAt},
		UpdatedAt: Date{p.UpdatedAt}, DeletedAt: datePtr(p.DeletedAt), ReleaseID: p.ReleaseID,
		ReleaseURL: p.ReleaseURL, Error: p.Error, CreationMethod: p.CreationMethod, Group: p.Group,
		ParentPostID: p.ParentPostID,
	}
}

// GetPostTimeline returns nil when the post does not exist.
func (r *Repository) GetPostTimeline(ctx context.Context, id, org string) (*PostTimeline, error) {
	p, err := r.client.Post.Query().Where(post.ID(id), post.OrganizationID(org)).
		WithIntegration().
		WithChildrenPost(func(q *ent.PostQuery) { q.Order(ent.Asc(post.FieldPublishDate)) }).
		WithErrors(func(q *ent.ErrorsQuery) { q.Order(ent.Desc(entErrors.FieldCreatedAt)) }).
		First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	i := p.Edges.Integration
	out := &PostTimeline{
		TimelinePost: timelinePost(p),
		Integration: TimelineIntegration{
			ID: i.ID, Name: i.Name, ProviderIdentifier: i.ProviderIdentifier, Disabled: i.Disabled,
			RefreshNeeded: i.RefreshNeeded, DeletedAt: datePtr(i.DeletedAt),
		},
		ChildrenPost: []TimelinePost{},
		Errors:       []TimelineError{},
	}
	for _, c := range p.Edges.ChildrenPost {
		out.ChildrenPost = append(out.ChildrenPost, timelinePost(c))
	}
	for _, e := range p.Edges.Errors {
		out.Errors = append(out.Errors, TimelineError{ID: e.ID, Platform: e.Platform, Message: e.Message, Body: e.Body, CreatedAt: Date{e.CreatedAt}})
	}
	return out, nil
}

type Category struct {
	Category string `json:"category"`
}

type Topic struct {
	Topic string `json:"topic"`
}

type PopularPost struct {
	Content string `json:"content"`
	Hook    string `json:"hook"`
}

type PopularPostInput struct {
	Category string `json:"category"`
	Topic    string `json:"topic"`
	Content  string `json:"content"`
	Hook     string `json:"hook"`
}

func (r *Repository) FindAllExistingCategories(ctx context.Context) ([]Category, error) {
	list, err := r.client.PopularPosts.Query().Unique(true).Select(popularposts.FieldCategory).Strings(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Category, 0, len(list))
	for _, c := range list {
		out = append(out, Category{Category: c})
	}
	return out, nil
}

func (r *Repository) FindAllExistingTopicsOfCategory(ctx context.Context, category string) ([]Topic, error) {
	list, err := r.client.PopularPosts.Query().Where(popularposts.Category(category)).Unique(true).
		Select(popularposts.FieldTopic).Strings(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Topic, 0, len(list))
	for _, t := range list {
		out = append(out, Topic{Topic: t})
	}
	return out, nil
}

// FindPopularPosts: topic "" skips the topic filter.
func (r *Repository) FindPopularPosts(ctx context.Context, category, topic string) ([]PopularPost, error) {
	where := []predicate.PopularPosts{popularposts.Category(category)}
	if topic != "" {
		where = append(where, popularposts.Topic(topic))
	}
	list, err := r.client.PopularPosts.Query().Where(where...).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]PopularPost, 0, len(list))
	for _, p := range list {
		out = append(out, PopularPost{Content: p.Content, Hook: p.Hook})
	}
	return out, nil
}

// CreatePopularPosts stores the literal placeholders, exactly like the original app.
func (r *Repository) CreatePopularPosts(ctx context.Context, _ PopularPostInput) (*ent.PopularPosts, error) {
	return r.client.PopularPosts.Create().SetCategory("category").SetTopic("topic").SetContent("content").SetHook("hook").Save(ctx)
}

// GetPostsCountsByDates returns the times (minutes from the start of date)
// that are still in the future and have no post.
func (r *Repository) GetPostsCountsByDates(ctx context.Context, orgID string, times []int, date time.Time) ([]int, error) {
	in := make([]time.Time, 0, len(times))
	for _, t := range times {
		in = append(in, date.Add(time.Duration(t)*time.Minute))
	}
	dates, err := r.client.Post.Query().Where(
		post.DeletedAtIsNil(), post.OrganizationID(orgID), post.PublishDateIn(in...),
	).All(ctx)
	if err != nil {
		return nil, err
	}

	startOfDay := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	now := time.Now()
	out := []int{}
	for _, t := range times {
		if !date.Add(time.Duration(t) * time.Minute).After(now) {
			continue
		}
		taken := false
		for _, d := range dates {
			if int(d.PublishDate.Sub(startOfDay)/time.Minute) == t {
				taken = true
				break
			}
		}
		if !taken {
			out = append(out, t)
		}
	}
	return out, nil
}

// GetCommentsForPosts includes the comment author.
func (r *Repository) GetCommentsForPosts(ctx context.Context, postIDs []string) ([]*ent.Comments, error) {
	return r.client.Comments.Query().Where(comments.PostIDIn(postIDs...), comments.DeletedAtIsNil()).
		WithUser().Order(ent.Asc(comments.FieldCreatedAt)).All(ctx)
}

// GetCommentByID includes the post; nil when not found.
func (r *Repository) GetCommentByID(ctx context.Context, id string) (*ent.Comments, error) {
	c, err := r.client.Comments.Query().Where(comments.ID(id), comments.DeletedAtIsNil()).WithPost().First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return c, err
}

func (r *Repository) SetCommentResolved(ctx context.Context, id string, resolvedAt *time.Time) (*ent.Comments, error) {
	u := r.client.Comments.UpdateOneID(id)
	if resolvedAt == nil {
		u.ClearResolvedAt()
	} else {
		u.SetResolvedAt(*resolvedAt)
	}
	return u.Save(ctx)
}

func (r *Repository) GetAnchoredCommentsForPost(ctx context.Context, postID string) ([]*ent.Comments, error) {
	return r.client.Comments.Query().Where(
		comments.PostID(postID), comments.DeletedAtIsNil(), comments.AnchorStartNotNil(),
	).All(ctx)
}

func (r *Repository) DetachAnchorsForPost(ctx context.Context, postID string, ids []string) (int, error) {
	return r.client.Comments.Update().Where(comments.PostID(postID), comments.IDIn(ids...)).
		ClearAnchorStart().ClearAnchorEnd().Save(ctx)
}

func (r *Repository) GetTags(ctx context.Context, orgID string) ([]*ent.Tags, error) {
	return r.client.Tags.Query().Where(tags.OrgID(orgID), tags.DeletedAtIsNil()).All(ctx)
}

func (r *Repository) CreateTag(ctx context.Context, orgID string, body *dtos.CreateTagDto) (*ent.Tags, error) {
	return r.client.Tags.Create().SetOrgID(orgID).SetName(body.Name).SetColor(body.Color).Save(ctx)
}

// EditTag updates by id only, like the original app.
func (r *Repository) EditTag(ctx context.Context, id, orgID string, body *dtos.CreateTagDto) (*ent.Tags, error) {
	return r.client.Tags.UpdateOneID(id).SetName(body.Name).SetColor(body.Color).Save(ctx)
}

func (r *Repository) DeleteTag(ctx context.Context, id, orgID string) (*ent.Tags, error) {
	tag, err := r.client.Tags.UpdateOneID(id).Where(tags.OrgID(orgID)).SetDeletedAt(time.Now()).Save(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := r.client.TagsPosts.Delete().Where(tagsposts.TagID(tag.ID)).Exec(ctx); err != nil {
		return nil, err
	}
	return tag, nil
}

// CommentExtra are createComment's optional fields.
type CommentExtra struct {
	DisplayName *string
	ParentID    string
	AnchorStart *int
	AnchorEnd   *int
	AnchorQuote *string
}

// CreateComment: userID "" is an anonymous (preview) comment.
func (r *Repository) CreateComment(ctx context.Context, orgID, userID, postID, content string, extra CommentExtra) (*ent.Comments, error) {
	c := r.client.Comments.Create().
		SetOrganizationID(orgID).
		SetPostID(postID).
		SetContent(content).
		SetNillableDisplayName(extra.DisplayName).
		SetNillableAnchorStart(extra.AnchorStart).
		SetNillableAnchorEnd(extra.AnchorEnd).
		SetNillableAnchorQuote(extra.AnchorQuote)
	if userID != "" {
		c.SetUserID(userID)
	}
	if extra.ParentID != "" {
		c.SetParentID(extra.ParentID)
	}
	return c.Save(ctx)
}

func (r *Repository) GetPostByForWebhookID(ctx context.Context, postID, integrationID string) ([]PostSummary, error) {
	list, err := r.client.Post.Query().Where(post.ID(postID), post.DeletedAtIsNil(), post.ParentPostIDIsNil()).
		WithIntegration().All(ctx)
	if err != nil {
		return nil, err
	}
	if len(list) > 0 {
		return summaries(list), nil
	}

	// The running workflows pass the platform's post id, which updatePost
	// already stored on the row as releaseId before the webhook is sent.
	list, err = r.client.Post.Query().Where(
		post.ReleaseID(postID), post.IntegrationID(integrationID), post.DeletedAtIsNil(), post.ParentPostIDIsNil(),
	).Order(ent.Desc(post.FieldUpdatedAt)).Limit(1).WithIntegration().All(ctx)
	if err != nil {
		return nil, err
	}
	return summaries(list), nil
}

func (r *Repository) GetPostsSince(ctx context.Context, orgID, since string) ([]PostSummary, error) {
	gte, err := parseDate(since, time.Local)
	if err != nil {
		return nil, err
	}
	list, err := r.client.Post.Query().Where(
		post.OrganizationID(orgID), post.PublishDateGTE(gte), post.DeletedAtIsNil(), post.ParentPostIDIsNil(),
	).WithIntegration().All(ctx)
	if err != nil {
		return nil, err
	}
	return summaries(list), nil
}
