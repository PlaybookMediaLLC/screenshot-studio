// Package adminstats ports database/prisma/admin-stats.
package adminstats

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	enterrors "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/oauthapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/oauthauthorization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/predicate"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

type StatsParams struct {
	From           time.Time
	To             time.Time
	UnknownOnly    bool
	OrganizationID string
	IncludeDeleted bool
}

type OrgActivityParams struct {
	From           time.Time
	To             time.Time
	OrganizationID string
	IncludeDeleted bool
}

// Unknown errors are stored as the serialized error payload, e.g.
// {..."message":"Unknown Error"...}. Matches `message LIKE '%"message":"Unknown Error"%'`.
const unknownErrorToken = `"message":"Unknown Error"`

type PerSocial struct {
	Provider string `json:"provider"`
	Count    int    `json:"count"`
}

type PerState struct {
	State string `json:"state"`
	Count int    `json:"count"`
}

type Bucket struct {
	Total     int         `json:"total"`
	PerSocial []PerSocial `json:"perSocial"`
}

type OrgActivityResponse struct {
	From             string     `json:"from"`
	To               string     `json:"to"`
	OrganizationID   string     `json:"organizationId"`
	Errors           Bucket     `json:"errors"`
	Posts            Bucket     `json:"posts"`
	ConnectedInRange Bucket     `json:"connectedInRange"`
	Channels         Bucket     `json:"channels"`
	PostsByState     []PerState `json:"postsByState"`
	FirstActivityAt  *string    `json:"firstActivityAt"`
	LastActivityAt   *string    `json:"lastActivityAt"`
}

type StatsResponse struct {
	From               string `json:"from"`
	To                 string `json:"to"`
	Errors             Bucket `json:"errors"`
	Posts              Bucket `json:"posts"`
	Connected          Bucket `json:"connected"`
	PublishingAccounts Bucket `json:"publishingAccounts"`
	ScheduledAccounts  Bucket `json:"scheduledAccounts"`
	PublishingChannels Bucket `json:"publishingChannels"`
	ScheduledChannels  Bucket `json:"scheduledChannels"`
	ActiveOrgsBySource Bucket `json:"activeOrgsBySource"`
	ConnectedClients   Bucket `json:"connectedClients"`
}

// localeCompare is String.prototype.localeCompare (root collation).
func localeCompare(a, b string) int { return collate.New(language.Und).CompareString(a, b) }

func sortDesc(list []PerSocial) []PerSocial {
	slices.SortStableFunc(list, func(a, b PerSocial) int {
		if a.Count != b.Count {
			return b.Count - a.Count
		}
		return localeCompare(a.Provider, b.Provider)
	})
	return list
}

func isoString(t time.Time) string { return t.UTC().Format(ent.JSTime) }

// fold turns counts keyed by provider (in first-seen order, like a JS Map)
// into a sorted perSocial list.
type folded struct {
	keys   []string
	counts map[string]int
}

func newFolded() *folded { return &folded{counts: map[string]int{}} }

func (f *folded) add(key string, n int) {
	if _, ok := f.counts[key]; !ok {
		f.keys = append(f.keys, key)
	}
	f.counts[key] += n
}

func (f *folded) list() []PerSocial {
	out := make([]PerSocial, 0, len(f.keys))
	for _, k := range f.keys {
		out = append(out, PerSocial{Provider: k, Count: f.counts[k]})
	}
	return sortDesc(out)
}

// distinct counts distinct values per key and overall.
type distinct struct {
	keys  []string
	sets  map[string]map[string]struct{}
	total map[string]struct{}
}

func newDistinct() *distinct {
	return &distinct{sets: map[string]map[string]struct{}{}, total: map[string]struct{}{}}
}

func (d *distinct) add(key, value string) {
	if _, ok := d.sets[key]; !ok {
		d.keys = append(d.keys, key)
		d.sets[key] = map[string]struct{}{}
	}
	d.sets[key][value] = struct{}{}
	d.total[value] = struct{}{}
}

func (d *distinct) bucket() Bucket {
	out := make([]PerSocial, 0, len(d.keys))
	for _, k := range d.keys {
		out = append(out, PerSocial{Provider: k, Count: len(d.sets[k])})
	}
	return Bucket{Total: len(d.total), PerSocial: sortDesc(out)}
}

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

func (r *Repository) errorStats(ctx context.Context, from, to time.Time, unknownOnly bool, organizationID string) (Bucket, error) {
	where := []predicate.Errors{enterrors.CreatedAtGTE(from), enterrors.CreatedAtLTE(to)}
	if unknownOnly {
		where = append(where, enterrors.MessageContains(unknownErrorToken))
	}
	if organizationID != "" {
		where = append(where, enterrors.OrganizationID(organizationID))
	}
	total, err := r.client.Errors.Query().Where(where...).Count(ctx)
	if err != nil {
		return Bucket{}, err
	}
	var grouped []struct {
		Platform string `json:"platform"`
		Count    int    `json:"count"`
	}
	if err := r.client.Errors.Query().Where(where...).GroupBy(enterrors.FieldPlatform).Aggregate(ent.Count()).Scan(ctx, &grouped); err != nil {
		return Bucket{}, err
	}
	list := make([]PerSocial, 0, len(grouped))
	for _, g := range grouped {
		list = append(list, PerSocial{Provider: g.Platform, Count: g.Count})
	}
	return Bucket{Total: total, PerSocial: sortDesc(list)}, nil
}

func (r *Repository) providers(ctx context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.client.Integration.Query().Where(integration.IDIn(ids...)).
		Select(integration.FieldID, integration.FieldProviderIdentifier).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ID] = row.ProviderIdentifier
	}
	return out, nil
}

func providerOf(providers map[string]string, id string) string {
	if p := providers[id]; p != "" {
		return p
	}
	return "unknown"
}

func (r *Repository) postStats(ctx context.Context, from, to time.Time, organizationID string, includeDeleted bool) (Bucket, error) {
	// Only count top-level posts (thread children share a parentPostId) so the
	// numbers match a "post published to a channel" rather than every fragment.
	where := []predicate.Post{post.StateEQ(post.StatePUBLISHED), post.ParentPostIDIsNil()}
	if !includeDeleted {
		where = append(where, post.DeletedAtIsNil())
	}
	where = append(where, post.PublishDateGTE(from), post.PublishDateLTE(to))
	if organizationID != "" {
		where = append(where, post.OrganizationID(organizationID))
	}
	total, err := r.client.Post.Query().Where(where...).Count(ctx)
	if err != nil {
		return Bucket{}, err
	}
	var grouped []struct {
		IntegrationID string `json:"integrationId"`
		Count         int    `json:"count"`
	}
	if err := r.client.Post.Query().Where(where...).GroupBy(post.FieldIntegrationID).Aggregate(ent.Count()).Scan(ctx, &grouped); err != nil {
		return Bucket{}, err
	}

	// groupBy can't reach into the integration relation, so resolve the
	// providerIdentifier for the integrations we saw and fold the counts.
	ids := make([]string, 0, len(grouped))
	for _, g := range grouped {
		ids = append(ids, g.IntegrationID)
	}
	providers, err := r.providers(ctx, ids)
	if err != nil {
		return Bucket{}, err
	}
	byProvider := newFolded()
	for _, g := range grouped {
		byProvider.add(providerOf(providers, g.IntegrationID), g.Count)
	}
	return Bucket{Total: total, PerSocial: byProvider.list()}, nil
}

type orgIntegration struct {
	OrganizationID string `json:"organizationId"`
	IntegrationID  string `json:"integrationId"`
}

type accountStats struct {
	publishingAccounts, scheduledAccounts, publishingChannels, scheduledChannels Bucket
}

// Distinct organizations with at least one top-level post in the range,
// per provider and overall: "publishing" = already PUBLISHED, "scheduled" =
// QUEUE or PUBLISHED (a published post was scheduled for that day too).
// The totals are distinct across all providers combined, not a summation.
func (r *Repository) accountStats(ctx context.Context, from, to time.Time) (accountStats, error) {
	whereBase := []predicate.Post{post.ParentPostIDIsNil(), post.DeletedAtIsNil(), post.PublishDateGTE(from), post.PublishDateLTE(to)}
	group := func(state predicate.Post) ([]orgIntegration, error) {
		var out []orgIntegration
		err := r.client.Post.Query().Where(append(append([]predicate.Post{}, whereBase...), state)...).
			GroupBy(post.FieldOrganizationID, post.FieldIntegrationID).Scan(ctx, &out)
		return out, err
	}
	publishedGroups, err := group(post.StateEQ(post.StatePUBLISHED))
	if err != nil {
		return accountStats{}, err
	}
	scheduledGroups, err := group(post.StateIn(post.StateQUEUE, post.StatePUBLISHED))
	if err != nil {
		return accountStats{}, err
	}

	seen := map[string]bool{}
	var ids []string
	for _, g := range append(append([]orgIntegration{}, publishedGroups...), scheduledGroups...) {
		if !seen[g.IntegrationID] {
			seen[g.IntegrationID] = true
			ids = append(ids, g.IntegrationID)
		}
	}
	providers, err := r.providers(ctx, ids)
	if err != nil {
		return accountStats{}, err
	}

	distinctOrgs := func(groups []orgIntegration) Bucket {
		d := newDistinct()
		for _, g := range groups {
			d.add(providerOf(providers, g.IntegrationID), g.OrganizationID)
		}
		return d.bucket()
	}
	// Same idea per channel: distinct integrations regardless of which
	// organization owns them (a user with two TikTok channels counts twice).
	distinctChannels := func(groups []orgIntegration) Bucket {
		d := newDistinct()
		for _, g := range groups {
			d.add(providerOf(providers, g.IntegrationID), g.IntegrationID)
		}
		return d.bucket()
	}
	return accountStats{
		publishingAccounts: distinctOrgs(publishedGroups),
		scheduledAccounts:  distinctOrgs(scheduledGroups),
		publishingChannels: distinctChannels(publishedGroups),
		scheduledChannels:  distinctChannels(scheduledGroups),
	}, nil
}

// Distinct organizations with at least one top-level scheduled, published
// or failed post in the range, per creation source (web, API, MCP, ...).
// The total is distinct across all sources combined, not a summation.
func (r *Repository) sourceStats(ctx context.Context, from, to time.Time) (Bucket, error) {
	var groups []struct {
		OrganizationID string `json:"organizationId"`
		CreationMethod string `json:"creationMethod"`
	}
	err := r.client.Post.Query().Where(
		post.ParentPostIDIsNil(), post.DeletedAtIsNil(), post.PublishDateGTE(from), post.PublishDateLTE(to),
		post.StateIn(post.StateQUEUE, post.StatePUBLISHED, post.StateERROR),
	).GroupBy(post.FieldOrganizationID, post.FieldCreationMethod).Scan(ctx, &groups)
	if err != nil {
		return Bucket{}, err
	}
	d := newDistinct()
	for _, g := range groups {
		d.add(g.CreationMethod, g.OrganizationID)
	}
	return d.bucket(), nil
}

func (r *Repository) providerCounts(ctx context.Context, where []predicate.Integration) (Bucket, error) {
	total, err := r.client.Integration.Query().Where(where...).Count(ctx)
	if err != nil {
		return Bucket{}, err
	}
	var grouped []struct {
		ProviderIdentifier string `json:"providerIdentifier"`
		Count              int    `json:"count"`
	}
	if err := r.client.Integration.Query().Where(where...).GroupBy(integration.FieldProviderIdentifier).Aggregate(ent.Count()).Scan(ctx, &grouped); err != nil {
		return Bucket{}, err
	}
	list := make([]PerSocial, 0, len(grouped))
	for _, g := range grouped {
		list = append(list, PerSocial{Provider: g.ProviderIdentifier, Count: g.Count})
	}
	return Bucket{Total: total, PerSocial: sortDesc(list)}, nil
}

func (r *Repository) connectedStats(ctx context.Context, from, to time.Time, organizationID string, includeDeleted bool) (Bucket, error) {
	var where []predicate.Integration
	if !includeDeleted {
		where = append(where, integration.DeletedAtIsNil())
	}
	where = append(where, integration.CreatedAtGTE(from), integration.CreatedAtLTE(to))
	if organizationID != "" {
		where = append(where, integration.OrganizationID(organizationID))
	}
	return r.providerCounts(ctx, where)
}

// Active OAuth authorizations first created in the range (MCP clients like
// Claude, Cursor or ChatGPT connecting to Postiz), per client name. A
// re-authorization upserts the same row, so it keeps its original createdAt
// and is not counted again. Dynamic registration creates a new OAuthApp row
// for every client install, so the counts are folded by the registered
// client_name rather than by app id.
func (r *Repository) clientStats(ctx context.Context, params StatsParams) (Bucket, error) {
	where := []predicate.OAuthAuthorization{oauthauthorization.AccessTokenNotNil()}
	if !params.IncludeDeleted {
		where = append(where, oauthauthorization.RevokedAtIsNil())
	}
	where = append(where, oauthauthorization.CreatedAtGTE(params.From), oauthauthorization.CreatedAtLTE(params.To))
	if params.OrganizationID != "" {
		where = append(where, oauthauthorization.OrganizationID(params.OrganizationID))
	}
	total, err := r.client.OAuthAuthorization.Query().Where(where...).Count(ctx)
	if err != nil {
		return Bucket{}, err
	}
	var grouped []struct {
		OauthAppID string `json:"oauthAppId"`
		Count      int    `json:"count"`
	}
	if err := r.client.OAuthAuthorization.Query().Where(where...).GroupBy(oauthauthorization.FieldOauthAppID).Aggregate(ent.Count()).Scan(ctx, &grouped); err != nil {
		return Bucket{}, err
	}

	// groupBy can't reach into the oauthApp relation, so resolve the client
	// name for the apps we saw and fold the counts.
	names := map[string]string{}
	if len(grouped) > 0 {
		ids := make([]string, 0, len(grouped))
		for _, g := range grouped {
			ids = append(ids, g.OauthAppID)
		}
		apps, err := r.client.OAuthApp.Query().Where(oauthapp.IDIn(ids...)).Select(oauthapp.FieldID, oauthapp.FieldName).All(ctx)
		if err != nil {
			return Bucket{}, err
		}
		for _, app := range apps {
			names[app.ID] = strings.ToLower(strings.TrimSpace(app.Name))
		}
	}
	byName := newFolded()
	for _, g := range grouped {
		name := names[g.OauthAppID]
		if name == "" {
			name = "unknown"
		}
		byName.add(name, g.Count)
	}
	return Bucket{Total: total, PerSocial: byName.list()}, nil
}

func (r *Repository) postStateStats(ctx context.Context, params OrgActivityParams) ([]PerState, error) {
	where := []predicate.Post{post.OrganizationID(params.OrganizationID), post.ParentPostIDIsNil()}
	if !params.IncludeDeleted {
		where = append(where, post.DeletedAtIsNil())
	}
	where = append(where, post.PublishDateGTE(params.From), post.PublishDateLTE(params.To))
	var grouped []PerState
	if err := r.client.Post.Query().Where(where...).GroupBy(post.FieldState).Aggregate(ent.Count()).Scan(ctx, &grouped); err != nil {
		return nil, err
	}
	if grouped == nil {
		grouped = []PerState{}
	}
	slices.SortStableFunc(grouped, func(a, b PerState) int {
		if a.Count != b.Count {
			return b.Count - a.Count
		}
		return localeCompare(a.State, b.State)
	})
	return grouped, nil
}

func (r *Repository) currentChannelStats(ctx context.Context, organizationID string, includeDeleted bool) (Bucket, error) {
	where := []predicate.Integration{integration.OrganizationID(organizationID)}
	if !includeDeleted {
		where = append(where, integration.DeletedAtIsNil())
	}
	return r.providerCounts(ctx, where)
}

func (r *Repository) activityRange(ctx context.Context, organizationID string, includeDeleted bool) (first, last *string, err error) {
	where := []predicate.Post{post.OrganizationID(organizationID), post.StateEQ(post.StatePUBLISHED)}
	if !includeDeleted {
		where = append(where, post.DeletedAtIsNil())
	}
	var agg []struct {
		Min *time.Time `json:"min"`
		Max *time.Time `json:"max"`
	}
	if err := r.client.Post.Query().Where(where...).
		Aggregate(ent.Min(post.FieldPublishDate), ent.Max(post.FieldPublishDate)).Scan(ctx, &agg); err != nil {
		return nil, nil, err
	}
	if len(agg) == 0 {
		return nil, nil, nil
	}
	if agg[0].Min != nil {
		s := isoString(*agg[0].Min)
		first = &s
	}
	if agg[0].Max != nil {
		s := isoString(*agg[0].Max)
		last = &s
	}
	return first, last, nil
}

func (r *Repository) GetOrgActivity(ctx context.Context, params OrgActivityParams) (*OrgActivityResponse, error) {
	errorsBucket, err := r.errorStats(ctx, params.From, params.To, false, params.OrganizationID)
	if err != nil {
		return nil, err
	}
	posts, err := r.postStats(ctx, params.From, params.To, params.OrganizationID, params.IncludeDeleted)
	if err != nil {
		return nil, err
	}
	connectedInRange, err := r.connectedStats(ctx, params.From, params.To, params.OrganizationID, params.IncludeDeleted)
	if err != nil {
		return nil, err
	}
	channels, err := r.currentChannelStats(ctx, params.OrganizationID, params.IncludeDeleted)
	if err != nil {
		return nil, err
	}
	postsByState, err := r.postStateStats(ctx, params)
	if err != nil {
		return nil, err
	}
	first, last, err := r.activityRange(ctx, params.OrganizationID, params.IncludeDeleted)
	if err != nil {
		return nil, err
	}
	return &OrgActivityResponse{
		From: isoString(params.From), To: isoString(params.To), OrganizationID: params.OrganizationID,
		Errors: errorsBucket, Posts: posts, ConnectedInRange: connectedInRange, Channels: channels,
		PostsByState: postsByState, FirstActivityAt: first, LastActivityAt: last,
	}, nil
}

func (r *Repository) GetStats(ctx context.Context, params StatsParams) (*StatsResponse, error) {
	errorsBucket, err := r.errorStats(ctx, params.From, params.To, params.UnknownOnly, params.OrganizationID)
	if err != nil {
		return nil, err
	}
	posts, err := r.postStats(ctx, params.From, params.To, params.OrganizationID, params.IncludeDeleted)
	if err != nil {
		return nil, err
	}
	accounts, err := r.accountStats(ctx, params.From, params.To)
	if err != nil {
		return nil, err
	}
	connected, err := r.connectedStats(ctx, params.From, params.To, params.OrganizationID, params.IncludeDeleted)
	if err != nil {
		return nil, err
	}
	activeOrgsBySource, err := r.sourceStats(ctx, params.From, params.To)
	if err != nil {
		return nil, err
	}
	connectedClients, err := r.clientStats(ctx, params)
	if err != nil {
		return nil, err
	}
	return &StatsResponse{
		From: isoString(params.From), To: isoString(params.To),
		Errors: errorsBucket, Posts: posts, Connected: connected,
		PublishingAccounts: accounts.publishingAccounts, ScheduledAccounts: accounts.scheduledAccounts,
		PublishingChannels: accounts.publishingChannels, ScheduledChannels: accounts.scheduledChannels,
		ActiveOrgsBySource: activeOrgsBySource, ConnectedClients: connectedClients,
	}, nil
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) GetStats(ctx context.Context, params StatsParams) (*StatsResponse, error) {
	return s.repo.GetStats(ctx, params)
}

func (s *Service) GetOrgActivity(ctx context.Context, params OrgActivityParams) (*OrgActivityResponse, error) {
	return s.repo.GetOrgActivity(ctx, params)
}
