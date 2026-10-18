package posts

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/generator"
	dtos "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/upload"
	"github.com/getsentry/sentry-go"
	"github.com/google/uuid"
	"go.temporal.io/sdk/client"
)

// IntegrationService is the part of integration.Service posts uses.
type IntegrationService interface {
	GetIntegrationByID(ctx context.Context, orgID, id string) (*ent.Integration, error)
	GetIntegrationsList(ctx context.Context, orgID string) ([]*ent.Integration, error)
	// DisconnectChannel's err is the optional refresh error message ('' in posts).
	DisconnectChannel(ctx context.Context, orgID string, integration *ent.Integration, err string) error
	// FindFreeDateTime: integrationID "" means every channel.
	FindFreeDateTime(ctx context.Context, orgID, integrationID string) ([]int, error)
	GetPlugs(ctx context.Context, orgID, integrationID string) ([]*ent.Plugs, error)
}

// RefreshIntegrationService is the refresh integration service; Refresh
// returns nil instead of false.
type RefreshIntegrationService interface {
	Refresh(ctx context.Context, integration *ent.Integration, cause string) (*integrations.AuthTokenDetails, error)
}

type MediaService interface {
	// GetMediaByID returns nil when the media does not exist.
	GetMediaByID(ctx context.Context, id string) (*ent.Media, error)
}

type ShortLinkService interface {
	ConvertTextToShortLinks(ctx context.Context, id string, messages []string) ([]string, error)
	// GetStatistics returns the provider's link statistics (JSON value).
	GetStatistics(ctx context.Context, messages []string) (any, error)
}

type OpenaiService interface {
	// SeparatePosts returns the thread parts ({posts} in TypeScript).
	SeparatePosts(ctx context.Context, content string, length int) ([]string, error)
}

// Storage is the part of the upload provider (UploadFactory.createStorage()) posts uses.
type Storage interface {
	UploadFile(ctx context.Context, file upload.File) (*upload.UploadedStream, error)
}

type Service struct {
	repo                      *Repository
	integrationManager        *integrations.Manager
	integrationService        IntegrationService
	mediaService              MediaService
	shortLinkService          ShortLinkService
	openaiService             OpenaiService
	temporal                  client.Client
	refreshIntegrationService RefreshIntegrationService
	storage                   Storage
	redis                     redis.Store
}

func NewService(
	repo *Repository,
	integrationManager *integrations.Manager,
	integrationService IntegrationService,
	mediaService MediaService,
	shortLinkService ShortLinkService,
	openaiService OpenaiService,
	temporal client.Client,
	refreshIntegrationService RefreshIntegrationService,
	storage Storage,
	store redis.Store,
) *Service {
	return &Service{
		repo: repo, integrationManager: integrationManager, integrationService: integrationService,
		mediaService: mediaService, shortLinkService: shortLinkService, openaiService: openaiService,
		temporal: temporal, refreshIntegrationService: refreshIntegrationService, storage: storage, redis: store,
	}
}

func (s *Service) SearchForMissingThreeHoursPosts(ctx context.Context) ([]ThreeHoursPost, error) {
	return s.repo.SearchForMissingThreeHoursPosts(ctx)
}

func (s *Service) UpdatePost(ctx context.Context, id, postID, releaseURL string) (*ent.Post, error) {
	return s.repo.UpdatePost(ctx, id, postID, releaseURL)
}

func isRefreshToken(err error) bool { return temporalx.FailureType(err) == temporalx.TypeRefreshToken }

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func tokenExpired(i *ent.Integration) bool {
	return i.TokenExpiration != nil && i.TokenExpiration.Before(time.Now())
}

// refreshToken refreshes the channel token in place. ok=false when the
// refresh gave nothing back or the channel had to be disconnected.
func (s *Service) refreshToken(ctx context.Context, orgID string, integration *ent.Integration, provider integrations.Provider) (bool, error) {
	data, err := s.refreshIntegrationService.Refresh(ctx, integration, "")
	if err != nil {
		return false, err
	}
	if data == nil {
		return false, nil
	}

	if data.AccessToken != "" {
		integration.Token = data.AccessToken
		if provider.Info().RefreshWait {
			if err := sleep(ctx, 10*time.Second); err != nil {
				return false, err
			}
		}
		return true, nil
	}

	return false, s.integrationService.DisconnectChannel(ctx, orgID, integration, "")
}

// GetMissingContent lists the platform posts a 'missing' post can be matched to.
func (s *Service) GetMissingContent(ctx context.Context, orgID, postID string, forceRefresh bool) ([]integrations.MissingPost, error) {
	empty := []integrations.MissingPost{}
	p, err := s.repo.GetPostByID(ctx, postID, orgID)
	if err != nil {
		return nil, err
	}
	if p == nil || p.ReleaseID == nil || *p.ReleaseID != "missing" {
		return empty, nil
	}

	provider := s.integrationManager.GetSocialIntegration(p.Edges.Integration.ProviderIdentifier)
	finder, ok := provider.(integrations.MissingFinder)
	if !ok {
		return empty, nil
	}

	integration := p.Edges.Integration
	if tokenExpired(integration) || forceRefresh {
		ok, err := s.refreshToken(ctx, orgID, integration, provider)
		if err != nil {
			return nil, err
		}
		if !ok {
			return empty, nil
		}
	}

	list, err := finder.Missing(ctx, integration.InternalID, integration.Token)
	if err != nil {
		log.Println(err)
		// Postiz retries on every RefreshToken; one retry keeps Go off an
		// unbounded recursion.
		if isRefreshToken(err) && !forceRefresh {
			return s.GetMissingContent(ctx, orgID, postID, true)
		}
		return empty, nil
	}
	if list == nil {
		return empty, nil
	}
	return list, nil
}

func (s *Service) GetPostByID(ctx context.Context, postID, orgID string) (*ent.Post, error) {
	return s.repo.GetPostByID(ctx, postID, orgID)
}

func (s *Service) GetPostTimeline(ctx context.Context, postID, orgID string) (*PostTimeline, error) {
	return s.repo.GetPostTimeline(ctx, postID, orgID)
}

func (s *Service) UpdateReleaseID(ctx context.Context, orgID, postID, releaseID string) (*ent.Post, error) {
	p, err := s.repo.GetPostByID(ctx, postID, orgID)
	if err != nil {
		return nil, err
	}

	// the URL is a bonus: connecting must not fail when it cannot be fetched
	releaseURL := ""
	if p != nil && p.ReleaseID != nil && *p.ReleaseID == "missing" {
		provider := s.integrationManager.GetSocialIntegration(p.Edges.Integration.ProviderIdentifier)
		if u, ok := provider.(integrations.ReleaseURLer); ok {
			if url, err := u.ReleaseURL(ctx, p.Edges.Integration.Token, releaseID, p.Edges.Integration); err != nil {
				log.Println(err)
			} else {
				releaseURL = url
			}
		}
	}

	return s.repo.UpdateReleaseID(ctx, postID, orgID, releaseID, releaseURL)
}

type releaseResolution struct {
	ReleaseID   string
	ReleaseURL  string
	Pending     bool
	Unavailable bool
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// resolveRelease asks the provider for the final platform id of a post
// (p must include its integration) and stores it when it changed.
func (s *Service) resolveRelease(ctx context.Context, orgID string, p *ent.Post) (*releaseResolution, error) {
	provider := s.integrationManager.GetSocialIntegration(p.Edges.Integration.ProviderIdentifier)

	settings := json.RawMessage(deref(p.Settings))
	if len(settings) == 0 {
		settings = json.RawMessage("{}")
	}

	var resolved *integrations.ReleaseIDResolution
	if resolver, ok := provider.(integrations.ReleaseIDResolver); ok {
		var err error
		resolved, err = resolver.ResolveReleaseID(ctx, p.Edges.Integration.Token, deref(p.ReleaseID), p.Edges.Integration, settings, deref(p.ReleaseURL))
		if err != nil {
			return nil, err
		}
	}
	if resolved == nil || resolved.PostID == "" || resolved.PostID == deref(p.ReleaseID) {
		return &releaseResolution{
			ReleaseID:   deref(p.ReleaseID),
			ReleaseURL:  deref(p.ReleaseURL),
			Pending:     resolved != nil && resolved.Pending,
			Unavailable: resolved != nil && resolved.Unavailable,
		}, nil
	}

	if _, err := s.repo.UpdateResolvedRelease(ctx, p.ID, orgID, resolved.PostID, resolved.ReleaseURL); err != nil {
		return nil, err
	}
	return &releaseResolution{ReleaseID: resolved.PostID, ReleaseURL: resolved.ReleaseURL}, nil
}

// ReleaseURLResult: the flags are omitted where TypeScript left them out.
type ReleaseURLResult struct {
	ReleaseURL  string `json:"releaseURL"`
	Pending     *bool  `json:"pending,omitempty"`
	Unavailable *bool  `json:"unavailable,omitempty"`
	Reconnect   *bool  `json:"reconnect,omitempty"`
}

func boolPtr(b bool) *bool { return &b }

func (s *Service) GetReleaseURL(ctx context.Context, orgID, postID string, forceRefresh bool) (*ReleaseURLResult, error) {
	p, err := s.repo.GetPostByID(ctx, postID, orgID)
	if err != nil {
		return nil, err
	}
	if p == nil || deref(p.ReleaseURL) == "" {
		return &ReleaseURLResult{ReleaseURL: ""}, nil
	}

	provider := s.integrationManager.GetSocialIntegration(p.Edges.Integration.ProviderIdentifier)
	if _, ok := provider.(integrations.ReleaseIDResolver); !ok {
		return &ReleaseURLResult{ReleaseURL: *p.ReleaseURL}, nil
	}

	// only refreshed once the platform rejects the token, so a post that is
	// already resolved never reaches the platform
	if forceRefresh {
		ok, err := s.refreshToken(ctx, orgID, p.Edges.Integration, provider)
		if err != nil {
			return nil, err
		}
		if !ok {
			return &ReleaseURLResult{ReleaseURL: *p.ReleaseURL, Reconnect: boolPtr(true)}, nil
		}
	}

	resolved, err := s.resolveRelease(ctx, orgID, p)
	if err == nil {
		return &ReleaseURLResult{
			ReleaseURL: resolved.ReleaseURL, Pending: boolPtr(resolved.Pending), Unavailable: boolPtr(resolved.Unavailable),
		}, nil
	}
	log.Println(err)
	if isRefreshToken(err) && !forceRefresh {
		return s.GetReleaseURL(ctx, orgID, postID, true)
	}

	return &ReleaseURLResult{ReleaseURL: *p.ReleaseURL, Pending: boolPtr(true)}, nil
}

// CheckPostAnalytics returns []integrations.AnalyticsData, or
// map{"missing": true} for a post whose platform id is still missing.
func (s *Service) CheckPostAnalytics(ctx context.Context, orgID, postID string, date int64, forceRefresh bool) (any, error) {
	empty := []integrations.AnalyticsData{}
	p, err := s.repo.GetPostByID(ctx, postID, orgID)
	if err != nil {
		return nil, err
	}
	if p == nil || deref(p.ReleaseID) == "" {
		return empty, nil
	}

	if *p.ReleaseID == "missing" {
		return map[string]bool{"missing": true}, nil
	}

	provider := s.integrationManager.GetSocialIntegration(p.Edges.Integration.ProviderIdentifier)
	analytics, ok := provider.(integrations.PostAnalytics)
	if !ok {
		return empty, nil
	}

	integration := p.Edges.Integration
	if tokenExpired(integration) || forceRefresh {
		ok, err := s.refreshToken(ctx, orgID, integration, provider)
		if err != nil {
			return nil, err
		}
		if !ok {
			return empty, nil
		}
	}

	loadAnalytics, err := func() ([]integrations.AnalyticsData, error) {
		resolved, err := s.resolveRelease(ctx, orgID, p)
		if err != nil {
			return nil, err
		}
		list, err := analytics.PostAnalytics(ctx, integration.InternalID, integration.Token, resolved.ReleaseID, date)
		if err != nil {
			return nil, err
		}
		if list == nil {
			list = empty
		}
		data, _ := json.Marshal(list)
		ttl := time.Hour
		if env := os.Getenv("NODE_ENV"); env == "" || env == "development" {
			ttl = time.Second
		}
		if err := s.redis.Set(ctx, fmt.Sprintf("integration:%s:%s:%d", orgID, p.ID, date), string(data), ttl); err != nil {
			return nil, err
		}
		return list, nil
	}()
	if err == nil {
		return loadAnalytics, nil
	}
	// Retry once with a refreshed token
	if isRefreshToken(err) && !forceRefresh {
		return s.CheckPostAnalytics(ctx, orgID, postID, date, true)
	}
	log.Println(err)

	return empty, nil
}

func (s *Service) GetStatistics(ctx context.Context, orgID, id string) (map[string]any, error) {
	posts, err := s.GetPostsRecursively(ctx, id, true, orgID)
	if err != nil {
		return nil, err
	}
	content := make([]string, 0, len(posts))
	for _, p := range posts {
		content = append(content, p.Content)
	}
	clicks, err := s.shortLinkService.GetStatistics(ctx, content)
	if err != nil {
		return nil, err
	}
	return map[string]any{"clicks": clicks}, nil
}

// GetPostsRecursively returns the post and its comments chain (post ->
// first child -> ...). Only the first one includes the integration and tags.
// orgID "" skips the org filter.
func (s *Service) GetPostsRecursively(ctx context.Context, id string, includeIntegration bool, orgID string) ([]*ent.Post, error) {
	out := []*ent.Post{}
	p, err := s.repo.GetPost(ctx, id, includeIntegration, orgID)
	for ; err == nil && p != nil; p, err = s.repo.GetPost(ctx, p.Edges.ChildrenPost[0].ID, false, orgID) {
		out = append(out, p)
		if len(p.Edges.ChildrenPost) == 0 {
			return out, nil
		}
	}
	return out, err
}

func (s *Service) GetPosts(ctx context.Context, orgID string, query *dtos.GetPostsDto) ([]CalendarPost, error) {
	return s.repo.GetPosts(ctx, orgID, query)
}

func (s *Service) GetPostsMinified(ctx context.Context, orgID string, query *dtos.GetPostsDto) (map[string]any, error) {
	posts, err := s.repo.GetPosts(ctx, orgID, query)
	if err != nil {
		return nil, err
	}
	return helpers.MinifyPosts(posts)
}

func (s *Service) GetPostsList(ctx context.Context, orgID string, query *dtos.GetPostsListDto) (map[string]any, error) {
	list, err := s.repo.GetPostsList(ctx, orgID, query)
	if err != nil {
		return nil, err
	}
	return helpers.MinifyPostsList(list)
}

// parseJSONColumn is JSON.parse(value || fallback).
func parseJSONColumn(value *string, fallback string) (json.RawMessage, error) {
	s := deref(value)
	if s == "" {
		s = fallback
	}
	if !json.Valid([]byte(s)) {
		return nil, fmt.Errorf("invalid JSON: %.100s", s)
	}
	return json.RawMessage(s), nil
}

func (s *Service) GetPostGroupDebugExport(ctx context.Context, orgID, group string) (map[string]any, error) {
	loadAll, err := s.repo.GetPostsByGroup(ctx, orgID, group)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(loadAll))
	for _, p := range loadAll {
		ids = append(ids, p.ID)
	}
	errorList, err := s.repo.GetErrorsByPostIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	posts := s.ArrangePostsByGroup(loadAll, "")
	if len(posts) == 0 {
		return nil, fmt.Errorf("post group %s not found", group)
	}
	rootPost := posts[0]

	tagList := []map[string]string{}
	for _, t := range rootPost.Edges.Tags {
		tagList = append(tagList, map[string]string{"value": t.Edges.Tag.ID, "label": t.Edges.Tag.Name})
	}
	settings, err := parseJSONColumn(rootPost.Settings, "{}")
	if err != nil {
		return nil, err
	}
	values := []map[string]any{}
	for _, p := range posts {
		image, err := parseJSONColumn(p.Image, "[]")
		if err != nil {
			return nil, err
		}
		values = append(values, map[string]any{"content": p.Content, "image": image, "delay": p.Delay})
	}
	errs := []map[string]any{}
	for _, e := range errorList {
		errs = append(errs, map[string]any{"message": e.Message, "platform": e.Platform, "body": e.Body, "createdAt": Date{e.CreatedAt}})
	}

	debug := map[string]any{
		"state":               rootPost.State,
		"error":               rootPost.Error,
		"errors":              errs,
		"originalGroup":       group,
		"originalPublishDate": Date{rootPost.PublishDate},
		"exportedAt":          time.Now().UTC().Format(ent.JSTime),
	}
	if i := rootPost.Edges.Integration; i != nil {
		debug["providerIdentifier"] = i.ProviderIdentifier
		debug["providerName"] = i.Name
	}

	return map[string]any{
		"type":      "draft",
		"shortLink": false,
		"date":      rootPost.PublishDate.UTC().Format(ent.JSTime),
		"tags":      tagList,
		"posts": []map[string]any{{
			"integration": map[string]string{"id": "REPLACE_WITH_LOCAL_INTEGRATION_ID"},
			"group":       rootPost.Group,
			"settings":    settings,
			"value":       values,
		}},
		"_debug": debug,
	}, nil
}

func (s *Service) GetPostsByGroup(ctx context.Context, orgID, group string) (map[string]any, error) {
	loadAll, err := s.repo.GetPostsByGroup(ctx, orgID, group)
	if err != nil {
		return nil, err
	}
	posts := s.ArrangePostsByGroup(loadAll, "")
	if len(posts) == 0 {
		return nil, httpx.NotFound("Post not found")
	}

	var batch []*ent.Post
	if deref(posts[0].BatchID) != "" {
		if batch, err = s.repo.GetPostsByBatch(ctx, orgID, *posts[0].BatchID, group); err != nil {
			return nil, err
		}
	}

	// the other channels the post was created with, the editor holds one
	// post per channel, and a channel that repeats differently is its own post
	var order []string
	byGroup := map[string][]*ent.Post{}
	for _, p := range batch {
		if _, ok := byGroup[p.Group]; !ok {
			order = append(order, p.Group)
		}
		byGroup[p.Group] = append(byGroup[p.Group], p)
	}
	seen := map[string]bool{}
	var siblings [][]*ent.Post
	for _, g := range order {
		batchPosts := s.ArrangePostsByGroup(byGroup[g], "")
		if len(batchPosts) == 0 ||
			batchPosts[0].IntegrationID == posts[0].IntegrationID ||
			!sameInt(batchPosts[0].IntervalInDays, posts[0].IntervalInDays) ||
			seen[batchPosts[0].IntegrationID] {
			continue
		}
		seen[batchPosts[0].IntegrationID] = true
		siblings = append(siblings, batchPosts)
	}

	out, err := s.groupForEditor(ctx, posts, false)
	if err != nil {
		return nil, err
	}
	list := []map[string]any{}
	for _, sibling := range siblings {
		g, err := s.groupForEditor(ctx, sibling, false)
		if err != nil {
			return nil, err
		}
		list = append(list, g)
	}
	out["siblings"] = list
	return out, nil
}

func sameInt(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// groupForEditor is the post as the editor loads it, its channel without the tokens.
func (s *Service) groupForEditor(ctx context.Context, posts []*ent.Post, convertToJPEG bool) (map[string]any, error) {
	list := []map[string]any{}
	for _, p := range posts {
		m, err := toMap(p)
		if err != nil {
			return nil, err
		}
		delete(m, "integration")
		if i := p.Edges.Integration; i != nil {
			m["integration"] = map[string]any{
				"id": i.ID, "name": i.Name, "picture": i.Picture, "providerIdentifier": i.ProviderIdentifier, "profile": i.Profile,
			}
		}
		if _, err := p.Edges.TagsOrErr(); err == nil {
			m["tags"] = tagWrappers(p)
		}
		var images []map[string]any
		if err := json.Unmarshal([]byte(orDefault(deref(p.Image), "[]")), &images); err != nil {
			return nil, err
		}
		m["image"] = s.UpdateMedia(ctx, p.ID, images, convertToJPEG)
		list = append(list, m)
	}

	settings, err := parseJSONColumn(posts[0].Settings, "{}")
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"group":       posts[0].Group,
		"posts":       list,
		"integration": posts[0].IntegrationID,
		"settings":    settings,
	}
	if i := posts[0].Edges.Integration; i != nil {
		out["integrationPicture"] = i.Picture
	}
	return out, nil
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// ArrangePostsByGroup orders a group as root posts first, then their
// comments; comments lose the integration.
func (s *Service) ArrangePostsByGroup(all []*ent.Post, parent string) []*ent.Post {
	var findAll []*ent.Post
	for _, p := range all {
		pp := deref(p.ParentPostID)
		if (parent == "" && pp == "") || (parent != "" && pp == parent) {
			cp := *p
			if parent != "" {
				cp.Edges.Integration = nil
			}
			findAll = append(findAll, &cp)
		}
	}
	out := append([]*ent.Post{}, findAll...)
	for _, p := range findAll {
		out = append(out, s.ArrangePostsByGroup(all, p.ID)...)
	}
	return out
}

func (s *Service) GetPost(ctx context.Context, orgID, id string, convertToJPEG bool) (map[string]any, error) {
	posts, err := s.GetPostsRecursively(ctx, id, true, orgID)
	if err != nil {
		return nil, err
	}
	if len(posts) == 0 {
		return nil, httpx.NotFound("Post not found")
	}
	return s.groupForEditor(ctx, posts, convertToJPEG)
}

func (s *Service) GetOldPosts(ctx context.Context, orgID, date string) ([]PostSummary, error) {
	return s.repo.GetOldPosts(ctx, orgID, date)
}

var postReference = regexp.MustCompile(`\(post:[a-zA-Z0-9_-]+\)`)

// UpdateTags replaces (post:<id>) references with the referenced post's
// release URL (the first one when there are several). The posts are copied,
// not modified. Postiz runs the replacement over the JSON of the posts; the
// text columns are where the references live.
func (s *Service) UpdateTags(ctx context.Context, orgID string, posts []*ent.Post) ([]*ent.Post, error) {
	out := make([]*ent.Post, 0, len(posts))
	for _, p := range posts {
		cp := *p
		out = append(out, &cp)
	}
	fields := func(p *ent.Post) []*string {
		return []*string{&p.Content, p.Settings, p.Image, p.Title, p.Description}
	}

	for {
		var ids []string
		for _, p := range out {
			for _, f := range fields(p) {
				if f == nil {
					continue
				}
				for _, match := range postReference.FindAllString(*f, -1) {
					ids = append(ids, strings.TrimSuffix(strings.TrimPrefix(match, "(post:"), ")"))
				}
			}
		}
		if len(ids) == 0 {
			return out, nil
		}

		urls, err := s.repo.GetPostURLs(ctx, orgID, ids)
		if err != nil {
			return nil, err
		}
		for _, p := range out {
			for i, f := range fields(p) {
				if f == nil {
					continue
				}
				value := *f
				for _, id := range ids {
					url := ""
					for _, u := range urls {
						if u.ID == id {
							url = deref(u.ReleaseURL)
							break
						}
					}
					value = strings.ReplaceAll(value, "(post:"+id+")", splitFirst(url, ","))
				}
				switch i {
				case 0:
					p.Content = value
				case 1:
					p.Settings = &value
				case 2:
					p.Image = &value
				case 3:
					p.Title = &value
				case 4:
					p.Description = &value
				}
			}
		}
	}
}

// InternalPlugRun is one @PostPlug run requested by the post settings.
type InternalPlugRun struct {
	Type                string         `json:"type"`
	Post                string         `json:"post"`
	OriginalIntegration string         `json:"originalIntegration"`
	Integration         string         `json:"integration"`
	PlugName            string         `json:"plugName"`
	OrgID               string         `json:"orgId"`
	Delay               float64        `json:"delay"`
	Information         map[string]any `json:"information"`
}

// CheckInternalPlug reads the `plug--<name>--<field>` settings keys.
func (s *Service) CheckInternalPlug(integration *ent.Integration, orgID, id string, settings json.RawMessage) ([]InternalPlugRun, error) {
	entries, err := orderedEntries(settings)
	if err != nil {
		return nil, err
	}

	var names []string
	parsePlugs := map[string]map[string]any{}
	for _, e := range entries {
		if !strings.Contains(e.key, "plug-") {
			continue
		}
		parts := strings.Split(e.key, "--")
		name, identifier := partAt(parts, 1), partAt(parts, 2)
		if parsePlugs[name] == nil {
			parsePlugs[name] = map[string]any{"name": name}
			names = append(names, name)
		}
		var value any
		_ = json.Unmarshal(e.value, &value)
		parsePlugs[name][identifier] = value
	}

	out := []InternalPlugRun{}
	for _, name := range names {
		trigger := parsePlugs[name]
		list, _ := trigger["integrations"].([]any)
		for _, item := range list {
			intID, _ := dig(item, "id").(string)
			out = append(out, InternalPlugRun{
				Type:                "internal-plug",
				Post:                id,
				OriginalIntegration: integration.ID,
				Integration:         intID,
				PlugName:            fmt.Sprint(trigger["name"]),
				OrgID:               orgID,
				Delay:               jsNumber(trigger["delay"]),
				Information:         trigger,
			})
		}
	}
	return out, nil
}

// partAt is JavaScript's destructuring of split() results.
func partAt(parts []string, i int) string {
	if i < len(parts) {
		return parts[i]
	}
	return "undefined"
}

// jsNumber is +value; NaN becomes 0 (JSON has no NaN).
func jsNumber(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case bool:
		if t {
			return 1
		}
	case string:
		var f float64
		if _, err := fmt.Sscan(strings.TrimSpace(t), &f); err == nil {
			return f
		}
	}
	return 0
}

type entry struct {
	key   string
	value json.RawMessage
}

// orderedEntries decodes a JSON object keeping its key order (Object.entries).
func orderedEntries(raw json.RawMessage) ([]entry, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, fmt.Errorf("settings must be an object")
	}
	var out []entry
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, err
		}
		out = append(out, entry{key: tok.(string), value: value})
	}
	return out, nil
}

// GlobalPlugRun is one activated @Plug of the channel.
type GlobalPlugRun struct {
	Type      string `json:"type"`
	PlugID    string `json:"plugId"`
	Delay     int64  `json:"delay"`
	TotalRuns int    `json:"totalRuns"`
}

func (s *Service) CheckPlugs(ctx context.Context, orgID, providerName, integrationID string) ([]GlobalPlugRun, error) {
	loadAllPlugs := s.integrationManager.GetAllPlugs()
	getPlugs, err := s.integrationService.GetPlugs(ctx, orgID, integrationID)
	if err != nil {
		return nil, err
	}

	var currentPlug *integrations.ProviderPlugs
	for i := range loadAllPlugs {
		if loadAllPlugs[i].Identifier == providerName {
			currentPlug = &loadAllPlugs[i]
			break
		}
	}

	out := []GlobalPlugRun{}
	if currentPlug == nil {
		return out, nil
	}
	for _, plug := range getPlugs {
		for _, p := range currentPlug.Plugs {
			if p.MethodName == plug.PlugFunction {
				out = append(out, GlobalPlugRun{Type: "global", PlugID: plug.ID, Delay: p.RunEveryMilliseconds, TotalRuns: p.TotalRuns})
				break
			}
		}
	}
	return out, nil
}

// DeletePost soft-deletes the group and terminates its running workflows. It
// answers {error: true}, like Postiz.
func (s *Service) DeletePost(ctx context.Context, orgID, group string) (map[string]bool, error) {
	id, err := s.repo.DeletePost(ctx, orgID, group)
	if err != nil {
		return nil, err
	}
	if id != "" {
		s.terminateRunning(ctx, id)
	}
	return map[string]bool{"error": true}, nil
}

func (s *Service) CountPostsFromDay(ctx context.Context, orgID string, date time.Time) (int, error) {
	return s.repo.CountPostsFromDay(ctx, orgID, date)
}

func (s *Service) GetPostByForWebhookID(ctx context.Context, id, integrationID string) ([]PostSummary, error) {
	return s.repo.GetPostByForWebhookID(ctx, id, integrationID)
}

// guardAgainstRepublish: a schedule-type save targeting an already-PUBLISHED
// post republishes it to the platform: require the explicit `republish`
// opt-in instead. The message doubles as the confirmation dialog for API/MCP
// automation. source is createPost or changeDate.
func guardAgainstRepublish(p *ent.Post, source string) error {
	if p == nil || p.State != post.StatePUBLISHED {
		return nil
	}

	howToUpdate := "use action 'update'"
	if source == "createPost" {
		howToUpdate = "use type 'update'"
	}
	channel := "the channel"
	if p.Edges.Integration != nil && p.Edges.Integration.ProviderIdentifier != "" {
		channel = p.Edges.Integration.ProviderIdentifier
	}

	return httpx.BadRequest(fmt.Sprintf(
		"This post was already published on %s UTC. Saving it this way would publish it again to %s. To edit without republishing, %s. To intentionally publish again, pass republish: true.",
		p.PublishDate.UTC().Format("2006-01-02 15:04"), channel, howToUpdate,
	))
}

// CreatedPost is one entry of createPost's result.
type CreatedPost struct {
	PostID      string `json:"postId"`
	Integration string `json:"integration"`
}

// CreatePost saves every channel of the request and starts their workflows
// (except for type update). keepGroup: see Repository.CreateOrUpdatePost.
func (s *Service) CreatePost(ctx context.Context, orgID string, body *dtos.CreatePostDto, creationMethod post.CreationMethod, keepGroup bool) ([]CreatedPost, error) {
	postList := []CreatedPost{}
	batchID := uuid.NewString()
	for _, p := range body.Posts {
		if (body.Type == "schedule" || body.Type == "now") && !body.Republish && len(p.Value) > 0 && p.Value[0].ID != "" {
			existing, err := s.repo.GetPostByID(ctx, p.Value[0].ID, orgID)
			if err != nil {
				return nil, err
			}
			if err := guardAgainstRepublish(existing, "createPost"); err != nil {
				return nil, err
			}
		}
		removeLinks := false
		if ls, ok := s.integrationManager.GetSocialIntegration(p.SettingsType()).(integrations.LinkStripper); ok {
			removeLinks = ls.StripLinks()
		}

		messages := make([]string, 0, len(p.Value))
		for _, v := range p.Value {
			messages = append(messages, v.Content)
		}
		// No point shortlinking links on platforms that strip them out anyway
		updateContent := messages
		if body.ShortLink && !removeLinks {
			var err error
			if updateContent, err = s.shortLinkService.ConvertTextToShortLinks(ctx, orgID, messages); err != nil {
				return nil, err
			}
		}

		values := make([]dtos.PostContent, len(p.Value))
		for i, v := range p.Value {
			v.Content = updateContent[i]
			if removeLinks {
				v.Content = helpers.StripLinks(updateContent[i])
			}
			values[i] = v
		}
		p.Value = values

		date := orDefault(p.Date, body.Date)
		if body.Type == "now" {
			date = time.Now().Format("2006-01-02T15:04:00")
		}

		result, err := s.repo.CreateOrUpdatePost(ctx, body.Type, orgID, date, &p, body.Tags, creationMethod, body.Inter, keepGroup, batchID)
		if err != nil {
			return nil, err
		}
		if len(result.Posts) == 0 {
			return []CreatedPost{}, nil
		}

		var existing []*ent.Post
		for _, saved := range result.Posts {
			for _, v := range p.Value {
				if v.ID != "" && v.ID == saved.ID {
					existing = append(existing, saved)
					break
				}
			}
		}
		if err := s.DetachStaleAnchors(ctx, existing); err != nil {
			return nil, err
		}

		if body.Type != "update" {
			s.StartWorkflow(ctx, strings.ToLower(splitFirst(p.SettingsType(), "-")), result.Posts[0].ID, orgID, result.Posts[0].State)
		}

		sentry.NewMeter(ctx).Count("post_created", 1)
		postList = append(postList, CreatedPost{PostID: result.Posts[0].ID, Integration: p.Integration.ID})
	}

	return postList, nil
}

type UpdatePostSettingsResult struct {
	PostID      string `json:"postId"`
	PublishDate string `json:"publishDate"`
}

// UpdatePostSettings updates ONLY the provider settings of a not-yet-published
// post (scheduled or draft). The passed keys are merged into the existing
// settings; content and publish date stay as they are, so the running
// publish workflow is left untouched (type "update"). Shared by the agent/MCP
// tool and the public API PUT /posts/:id/settings so both go through one path.
func (s *Service) UpdatePostSettings(ctx context.Context, orgID, postID string, settings map[string]any, creationMethod post.CreationMethod) (*UpdatePostSettingsResult, error) {
	// Ordered as post -> comments, root includes integration and tags.
	ordered, err := s.GetPostsRecursively(ctx, postID, true, orgID)
	if err != nil {
		return nil, err
	}
	if len(ordered) == 0 {
		return nil, httpx.NotFound("Post not found")
	}
	root := ordered[0]

	if deref(root.ParentPostID) != "" {
		return nil, httpx.BadRequest("This id belongs to a comment, pass the id of the main post")
	}

	if root.State != post.StateQUEUE && root.State != post.StateDRAFT {
		return nil, httpx.BadRequest("Only scheduled posts that were not published yet (or drafts) can be updated")
	}

	if root.State == post.StateQUEUE && root.PublishDate.Before(time.Now()) {
		return nil, httpx.BadRequest("The publish time of this post already passed, it cannot be updated")
	}

	integration := root.Edges.Integration

	existingSettings := map[string]any{}
	if err := json.Unmarshal([]byte(orDefault(deref(root.Settings), "{}")), &existingSettings); err != nil || existingSettings == nil {
		existingSettings = map[string]any{}
	}

	// Merge: only the passed keys change, everything else stays.
	for k, v := range settings {
		existingSettings[k] = v
	}
	existingSettings["__type"] = integration.ProviderIdentifier
	mergedSettings, err := json.Marshal(existingSettings)
	if err != nil {
		return nil, err
	}

	// Keep the existing content/ids so the posts are updated in place (the
	// workflow identity is preserved) - only the settings differ.
	value := make([]dtos.PostContent, 0, len(ordered))
	for _, p := range ordered {
		image := []dtos.MediaDto{}
		if err := json.Unmarshal([]byte(orDefault(deref(p.Image), "[]")), &image); err != nil || image == nil {
			image = []dtos.MediaDto{}
		}
		value = append(value, dtos.PostContent{ID: p.ID, Content: p.Content, Delay: p.Delay, Image: image})
	}

	// Same server-side validation as the dashboard / public create route.
	validations, err := s.ValidatePosts(ctx, orgID, []dtos.Post{{
		Integration: dtos.Integration{ID: integration.ID},
		Settings:    mergedSettings,
		Value:       value,
	}})
	if err != nil {
		return nil, err
	}
	validation := validations[0]

	if validation.EmptyContent {
		return nil, httpx.BadRequest(validation.Name + ": Your post should have at least one character or one image.")
	}

	if root.State != post.StateDRAFT {
		if !validation.Valid {
			return nil, httpx.BadRequest(validation.Name + ": " + orDefault(validation.SettingsError, "Please fix your settings"))
		}
		if validation.Errors != true {
			return nil, httpx.BadRequest(fmt.Sprintf("%s: %v", validation.Name, validation.Errors))
		}
		if validation.TooLong {
			return nil, httpx.BadRequest(fmt.Sprintf("%s: The maximum characters is %d", validation.Name, validation.MaximumCharacters))
		}
	}

	date := root.PublishDate.UTC().Format("2006-01-02T15:04:05")

	tagList := []dtos.Tags{}
	for _, t := range root.Edges.Tags {
		tagList = append(tagList, dtos.Tags{Value: t.Edges.Tag.Name, Label: t.Edges.Tag.Name})
	}

	output, err := s.CreatePost(ctx, orgID, &dtos.CreatePostDto{
		Date: date,
		// Settings-only update: keep the current state and leave the running
		// publish workflow alone.
		Type:      "update",
		ShortLink: false,
		Tags:      tagList,
		Posts: []dtos.Post{{
			Integration: dtos.Integration{ID: integration.ID},
			Group:       root.Group,
			Settings:    mergedSettings,
			Value:       value,
		}},
	}, creationMethod,
		// Keep the group stable: a client may have the calendar open while the
		// settings are updated out of band, and the calendar links posts by group.
		true)
	if err != nil {
		return nil, err
	}

	if len(output) == 0 {
		return nil, httpx.BadRequest("Failed to update the post")
	}

	return &UpdatePostSettingsResult{PostID: output[0].PostID, PublishDate: date}, nil
}

type SeparatedPosts struct {
	Posts []string `json:"posts"`
}

func (s *Service) SeparatePosts(ctx context.Context, content string, length int) (*SeparatedPosts, error) {
	posts, err := s.openaiService.SeparatePosts(ctx, content, length)
	if err != nil {
		return nil, err
	}
	return &SeparatedPosts{Posts: posts}, nil
}

// ChangeState: see Repository.ChangeState.
func (s *Service) ChangeState(ctx context.Context, id string, state post.State, errValue, body any) (*ent.Post, error) {
	return s.repo.ChangeState(ctx, id, state, errValue, body)
}

type PostStatusResult struct {
	ID    string     `json:"id"`
	State post.State `json:"state"`
}

// ChangePostStatus: status is draft or schedule.
func (s *Service) ChangePostStatus(ctx context.Context, orgID, id, status string) (*PostStatusResult, error) {
	p, err := s.repo.GetPostByID(ctx, id, orgID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, httpx.BadRequest("Post not found")
	}

	state := post.StateQUEUE
	if status == "draft" {
		state = post.StateDRAFT
	}
	if _, err := s.repo.ChangeState(ctx, id, state, nil, nil); err != nil {
		return nil, err
	}

	s.StartWorkflow(ctx, strings.ToLower(splitFirst(p.Edges.Integration.ProviderIdentifier, "-")), p.ID, orgID, state)

	return &PostStatusResult{ID: id, State: state}, nil
}

// ChangeDate: action schedule sets the status to QUEUE and changes the date
// (reschedules the post); update just changes the date. "" means schedule.
func (s *Service) ChangeDate(ctx context.Context, orgID, id, date, action string, republish bool) (*ent.Post, error) {
	if action == "" {
		action = "schedule"
	}
	p, err := s.repo.GetPostByID(ctx, id, orgID)
	if err != nil {
		return nil, err
	}

	if action == "schedule" && !republish {
		if err := guardAgainstRepublish(p, "changeDate"); err != nil {
			return nil, err
		}
	}
	if p == nil {
		return nil, fmt.Errorf("post %s not found", id)
	}

	newDate, err := s.repo.ChangeDate(ctx, orgID, id, date, p.State == post.StateDRAFT, action)
	if err != nil {
		return nil, err
	}

	if action == "schedule" {
		state := post.StateQUEUE
		if p.State == post.StateDRAFT {
			state = post.StateDRAFT
		}
		s.StartWorkflow(ctx, strings.ToLower(splitFirst(p.Edges.Integration.ProviderIdentifier, "-")), p.ID, orgID, state)
	}

	return newDate, nil
}

func (s *Service) FindAllExistingCategories(ctx context.Context) ([]Category, error) {
	return s.repo.FindAllExistingCategories(ctx)
}

func (s *Service) FindAllExistingTopicsOfCategory(ctx context.Context, category string) ([]Topic, error) {
	return s.repo.FindAllExistingTopicsOfCategory(ctx, category)
}

func (s *Service) FindPopularPosts(ctx context.Context, category, topic string) ([]PopularPost, error) {
	return s.repo.FindPopularPosts(ctx, category, topic)
}

func (s *Service) CreatePopularPosts(ctx context.Context, p PopularPostInput) (*ent.PopularPosts, error) {
	return s.repo.CreatePopularPosts(ctx, p)
}

// FindFreeDateTime returns the first free posting time (UTC,
// YYYY-MM-DDTHH:mm:00) from today on; integrationID "" means every channel.
func (s *Service) FindFreeDateTime(ctx context.Context, orgID, integrationID string) (string, error) {
	times, err := s.integrationService.FindFreeDateTime(ctx, orgID, integrationID)
	if err != nil {
		return "", err
	}
	if len(times) == 0 {
		times = []int{120, 400, 700}
	}

	now := time.Now().UTC()
	date := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	for daysChecked := 0; ; daysChecked++ {
		// stop searching after a year so an empty times list can never recurse forever
		if daysChecked > 365 {
			first := 0
			if len(times) > 0 {
				first = times[0]
			}
			return date.Add(time.Duration(first) * time.Minute).Format("2006-01-02T15:04:00"), nil
		}

		list, err := s.repo.GetPostsCountsByDates(ctx, orgID, times, date)
		if err != nil {
			return "", err
		}
		if len(list) == 0 {
			date = date.AddDate(0, 0, 1)
			continue
		}

		num := list[0]
		for _, t := range list {
			num = min(num, t)
		}
		return date.Add(time.Duration(num) * time.Minute).Format("2006-01-02T15:04:00"), nil
	}
}

func (s *Service) GetTags(ctx context.Context, orgID string) ([]*ent.Tags, error) {
	return s.repo.GetTags(ctx, orgID)
}

func (s *Service) CreateTag(ctx context.Context, orgID string, body *dtos.CreateTagDto) (*ent.Tags, error) {
	return s.repo.CreateTag(ctx, orgID, body)
}

func (s *Service) EditTag(ctx context.Context, id, orgID string, body *dtos.CreateTagDto) (*ent.Tags, error) {
	return s.repo.EditTag(ctx, id, orgID, body)
}

func (s *Service) DeleteTag(ctx context.Context, id, orgID string) (*ent.Tags, error) {
	return s.repo.DeleteTag(ctx, id, orgID)
}

// GeneratePostsDraft creates the generated posts as drafts on every active
// channel (except reddit) at random times of the given ISO week.
func (s *Service) GeneratePostsDraft(ctx context.Context, orgID string, body *generator.CreateGeneratedPostsDto) error {
	all, err := s.integrationService.GetIntegrationsList(ctx, orgID)
	if err != nil {
		return err
	}
	var getAllIntegrations []*ent.Integration
	for _, i := range all {
		if !i.Disabled && i.ProviderIdentifier != "reddit" {
			getAllIntegrations = append(getAllIntegrations, i)
		}
	}

	// dayjs().isoWeek(week).year(year).startOf('isoWeek')
	now := time.Now()
	_, week := now.ISOWeek()
	d := now.AddDate(0, 0, (body.Week-week)*7)
	d = time.Date(body.Year, d.Month(), d.Day(), d.Hour(), d.Minute(), d.Second(), d.Nanosecond(), d.Location())
	monday := (int(d.Weekday()) + 6) % 7
	allDates := time.Date(d.Year(), d.Month(), d.Day()-monday, 0, 0, 0, 0, d.Location())

	dates := make([]string, 7)
	for i := range dates {
		dates[i] = allDates.AddDate(0, 0, i).Format("2006-01-02")
	}

	findTime := func() (string, error) {
		// ponytail: Postiz recurses until it finds a future time; a week fully
		// in the past gives up instead of looping forever.
		for range 10000 {
			totalMinutes := rand.IntN(144) * 10

			// Convert total minutes to hours and minutes
			randomDate := fmt.Sprintf("%sT%02d:%02d:00", dates[rand.IntN(len(dates))], totalMinutes/60, totalMinutes%60)
			t, err := parseDate(randomDate, time.Local)
			if err != nil {
				return "", err
			}
			if !t.Before(time.Now()) {
				return randomDate, nil
			}
		}
		return "", fmt.Errorf("week %d of %d is in the past", body.Week, body.Year)
	}

	postID := orDefault(body.PostID, body.URL)
	for _, integration := range getAllIntegrations {
		for _, toPost := range body.Posts {
			group := ids.Make(10)
			randomDate, err := findTime()
			if err != nil {
				return err
			}

			settings, err := json.Marshal(map[string]any{
				"__type": integration.ProviderIdentifier, "title": "", "tags": []any{}, "subreddit": []any{},
			})
			if err != nil {
				return err
			}
			value := make([]dtos.PostContent, 0, len(toPost.List)+1)
			for _, l := range toPost.List {
				value = append(value, dtos.PostContent{Content: l.Post, Image: []dtos.MediaDto{}})
			}
			value = append(value, dtos.PostContent{
				Content: "Check out the full story here:\n" + postID,
				Image:   []dtos.MediaDto{},
			})

			if _, err := s.CreatePost(ctx, orgID, &dtos.CreatePostDto{
				Type:      "draft",
				Date:      randomDate,
				Order:     "",
				ShortLink: false,
				Tags:      []dtos.Tags{},
				Posts: []dtos.Post{{
					Group:       group,
					Integration: dtos.Integration{ID: integration.ID},
					Settings:    settings,
					Value:       value,
				}},
			}, post.CreationMethodWEB, false); err != nil {
				return err
			}
		}
	}
	return nil
}
