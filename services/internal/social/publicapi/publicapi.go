// Package publicapi ports apps/backend/src/public-api: the /public/v1
// controller authenticated with an organization API key or OAuth app token.
package publicapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/adminstats"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/users"
	analyticsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/analytics"
	billingdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/billing"
	clippingdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/clipping"
	mediadto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/media"
	notificationsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/notifications"
	postsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/posts"
	videosdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/videos"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/upload"
)

// PostsService is the part of posts.Service the public API uses.
type PostsService interface {
	FindFreeDateTime(ctx context.Context, orgID, integrationID string) (string, error)
	GetPosts(ctx context.Context, orgID string, query *postsdto.GetPostsDto) ([]posts.CalendarPost, error)
	MapTypeToPost(ctx context.Context, body *postsdto.CreatePostDto, organization string, replaceDraft bool) (*postsdto.CreatePostDto, error)
	ValidatePosts(ctx context.Context, orgID string, posts []postsdto.Post) ([]posts.PostValidation, error)
	CreatePost(ctx context.Context, orgID string, body *postsdto.CreatePostDto, creationMethod post.CreationMethod, keepGroup bool) ([]posts.CreatedPost, error)
	GetPost(ctx context.Context, orgID, id string, convertToJPEG bool) (map[string]any, error)
	GetPostByID(ctx context.Context, postID, orgID string) (*ent.Post, error)
	DeletePost(ctx context.Context, orgID, group string) (map[string]bool, error)
	GetPostTimeline(ctx context.Context, postID, orgID string) (*posts.PostTimeline, error)
	GetMissingContent(ctx context.Context, orgID, postID string, forceRefresh bool) ([]integrations.MissingPost, error)
	UpdatePostSettings(ctx context.Context, orgID, postID string, settings map[string]any, creationMethod post.CreationMethod) (*posts.UpdatePostSettingsResult, error)
	ChangePostStatus(ctx context.Context, orgID, id, status string) (*posts.PostStatusResult, error)
	UpdateReleaseID(ctx context.Context, orgID, postID, releaseID string) (*ent.Post, error)
	CheckPostAnalytics(ctx context.Context, orgID, postID string, date int64, forceRefresh bool) (any, error)
}

// Deps are PublicIntegrationsController's dependencies plus what its
// middleware and guards need.
type Deps struct {
	// Orgs and OAuth back PublicAuthMiddleware and SuperAdminGuard.
	Orgs  auth.OrganizationService
	OAuth auth.OAuthService
	// Store backs the global ThrottlerBehindProxyGuard.
	Store redis.Store
	Perms *auth.PermissionsService

	Integrations  *integration.Service
	Posts         PostsService
	Media         *media.Service
	Storage       upload.Provider // FileInterceptor('file', streamUploadOptions())
	Notifications *notifications.Service
	Manager       *integrations.Manager
	Users         *users.Service
	AdminStats    *adminstats.Service
	Organizations *organizations.Service
	Clipping      *clipping.Service
	Subscriptions *subscriptions.Service
	// ValidationSchema is getValidationSchemas()[dto.name] (chat.ValidationSchema).
	ValidationSchema func(dto any) any
}

// refreshWait is timer(10000) after a refresh for providers with refreshWait;
// tests shorten it.
var refreshWait = 10 * time.Second

type controller struct{ Deps }

func msg(status int, text string) *httpx.Error {
	return httpx.NewError(status, map[string]string{"msg": text})
}

// RegisterPublicIntegrationsController registers PublicIntegrationsController
// under /public/v1 behind PublicAuthMiddleware and the global throttler guard.
func RegisterPublicIntegrationsController(r *httpx.Router, d Deps) {
	h := &controller{d}
	superAdmin := httpx.With(auth.SuperAdminGuard(d.Orgs))

	g := r.Group("/public/v1", auth.PublicAuthMiddleware(d.Orgs, d.OAuth), auth.ThrottlerBehindProxyGuard(d.Store))
	g.Post("/upload", h.uploadSimple)
	g.Post("/upload-from-url", h.uploadsFromURL)
	g.Get("/find-slot/:id", h.findSlotIntegration)
	g.Get("/posts", h.getPosts)
	g.Get("/posts/:id/status", h.getPostStatus)
	g.Post("/posts", h.createPost, d.Perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionPostsPerMonth)))
	g.Delete("/posts/:id", h.deletePost)
	g.Delete("/posts/group/:group", h.deletePostByGroup)
	g.Get("/is-connected", h.getActiveIntegrations)
	g.Get("/media", h.getMedia)
	g.Get("/me", h.getMe)
	g.Get("/groups", h.listGroups)
	g.Get("/integrations", h.listIntegration)
	g.Get("/social/:integration", h.getIntegrationURL, d.Perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionChannel)))
	g.Get("/users", h.listUsers, superAdmin)
	g.Get("/debug/posts/:id", h.getPostTimeline, superAdmin)
	g.Get("/debug/account", h.getAccountOverview, superAdmin)
	g.Get("/debug/channels", h.getChannelHealth, superAdmin)
	g.Get("/debug/activity", h.getOrgActivity, superAdmin)
	g.Post("/credits/reset", h.resetCredits, superAdmin)
	g.Get("/notifications", h.getNotifications)
	g.Post("/generate-video", h.generateVideo)
	g.Post("/video/function", h.videoFunction)
	g.Post("/clipping", h.startClipping)
	g.Get("/clipping", h.getClippings)
	g.Get("/clipping/:id", h.getClipping)
	g.Delete("/integrations/:id", h.deleteChannel)
	g.Get("/integration-settings/:id", h.getIntegrationSettings)
	g.Get("/posts/:id/missing", h.getMissingContent)
	g.Put("/posts/:id/settings", h.updatePostSettings)
	g.Put("/posts/:id/status", h.changePostStatus)
	g.Put("/posts/:id/release-id", h.updateReleaseID)
	g.Get("/analytics/:integration", h.getAnalytics)
	g.Get("/analytics/post/:postId", h.getPostAnalytics)
	g.Post("/integration-trigger/:id", h.triggerIntegrationTool)
}

// subscriptionError renders the media/clipping SubscriptionException through
// the global SubscriptionExceptionFilter.
func subscriptionError(err error) error {
	var sub *media.SubscriptionError
	if errors.As(err, &sub) {
		return auth.SubscriptionException(auth.Sections(sub.Section), auth.AuthorizationActions(sub.Action))
	}
	return err
}

func (h *controller) uploadSimple(c *httpx.Ctx) (any, error) {
	file, _, err := upload.ReceiveFile(c.R.Context(), h.Storage, c.R, "file")
	if err != nil {
		return nil, err
	}
	if file == nil {
		return nil, msg(http.StatusBadRequest, "No file provided")
	}
	return h.Media.SaveFile(c.R.Context(), c.Org.ID, file.Filename, file.Path, "")
}

func (h *controller) uploadsFromURL(c *httpx.Ctx) (any, error) {
	var body mediadto.UploadDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	saved, err := h.Media.UploadFromURL(c.R.Context(), c.Org.ID, body.URL)
	if err != nil {
		// Validation failures keep this route's { msg } error shape
		var bad *httpx.Error
		if errors.As(err, &bad) && bad.Status == http.StatusBadRequest {
			return nil, msg(http.StatusBadRequest, exceptionMessage(bad))
		}
		return nil, err
	}
	return saved, nil
}

// exceptionMessage is HttpException.message for a BadRequestException.
func exceptionMessage(e *httpx.Error) string {
	if s := e.Message(); s != "" {
		return s
	}
	return "Bad Request Exception"
}

func (h *controller) findSlotIntegration(c *httpx.Ctx) (any, error) {
	date, err := h.Posts.FindFreeDateTime(c.R.Context(), c.Org.ID, c.Param("id"))
	if err != nil {
		return nil, err
	}
	return map[string]string{"date": date}, nil
}

func (h *controller) getPosts(c *httpx.Ctx) (any, error) {
	var query postsdto.GetPostsDto
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	list, err := h.Posts.GetPosts(c.R.Context(), c.Org.ID, &query)
	if err != nil {
		return nil, err
	}
	return map[string]any{"posts": list}, nil
}

// getPostStatus exposes only the publication receipt for a post owned by the
// authenticated organization. The full post record contains private data.
func (h *controller) getPostStatus(c *httpx.Ctx) (any, error) {
	p, err := h.Posts.GetPostByID(c.R.Context(), c.Param("id"), c.Org.ID)
	if err != nil {
		return nil, err
	}
	if p == nil || p.DeletedAt != nil {
		return nil, msg(http.StatusNotFound, "Post not found")
	}
	return map[string]any{
		"postId":     p.ID,
		"state":      p.State,
		"releaseId":  p.ReleaseID,
		"releaseURL": p.ReleaseURL,
	}, nil
}

func (h *controller) createPost(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var raw struct {
		Type           any `json:"type"`
		CreationMethod any `json:"creationMethod"`
	}
	if err := c.Decode(&raw); err != nil {
		return nil, err
	}
	var rawBody postsdto.CreatePostDto
	if err := c.Decode(&rawBody); err != nil {
		return nil, err
	}
	// a date per channel is a dashboard feature, the public API keeps one
	// date for the whole request
	for i := range rawBody.Posts {
		rawBody.Posts[i].Date = ""
	}

	// rawBody?.type === 'draft' || true
	body, err := h.Posts.MapTypeToPost(ctx, &rawBody, c.Org.ID, true)
	if err != nil {
		return nil, err
	}
	body.Type, _ = raw.Type.(string)

	if domain := os.Getenv("RESTRICT_UPLOAD_DOMAINS"); domain != "" {
		for _, p := range body.Posts {
			for _, v := range p.Value {
				for _, image := range v.Image {
					if !strings.Contains(image.Path, domain) {
						return nil, msg(http.StatusBadRequest, "All media must be uploaded through our upload API route and contain the domain: "+domain)
					}
				}
			}
		}
	}

	// Server-side validation — same rules as the dashboard, surfaced as a
	// readable 400 (see PostValidationExceptionFilter).
	validation, err := h.Posts.ValidatePosts(ctx, c.Org.ID, body.Posts)
	if err != nil {
		return nil, err
	}
	fail := func(item posts.PostValidation, message string) error {
		return auth.PostValidationException(auth.PostValidationError{Provider: item.Identifier, Name: item.Name, Error: message})
	}
	for _, item := range validation {
		if item.EmptyContent {
			return nil, fail(item, "Your post should have at least one character or one image.")
		}
	}
	if body.Type != "draft" {
		for _, item := range validation {
			if !item.Valid {
				message := item.SettingsError
				if message == "" {
					message = "Please fix your settings"
				}
				return nil, fail(item, message)
			}
			if ok, _ := item.Errors.(bool); !ok {
				return nil, fail(item, errorString(item.Errors))
			}
			if item.TooLong {
				return nil, fail(item, "post is too long, please fix it")
			}
		}
	}

	creationMethod := post.CreationMethodAPI
	if method, _ := raw.CreationMethod.(string); method == string(post.CreationMethodCLI) {
		creationMethod = post.CreationMethodCLI
	}
	return h.Posts.CreatePost(ctx, c.Org.ID, body, creationMethod, false)
}

// errorString is `item.errors as string` once rendered into the message.
func errorString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

func (h *controller) deletePost(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	found, err := h.Posts.GetPost(ctx, c.Org.ID, c.Param("id"), false)
	if err != nil {
		return nil, err
	}
	group, _ := found["group"].(string)
	return h.Posts.DeletePost(ctx, c.Org.ID, group)
}

func (h *controller) deletePostByGroup(c *httpx.Ctx) (any, error) {
	return h.Posts.DeletePost(c.R.Context(), c.Org.ID, c.Param("group"))
}

func (h *controller) getActiveIntegrations(*httpx.Ctx) (any, error) {
	return map[string]bool{"connected": true}, nil
}

type mediaItem struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	OriginalName *string      `json:"originalName"`
	Path         string       `json:"path"`
	CreatedAt    media.JSTime `json:"createdAt"`
}

func (h *controller) getMedia(c *httpx.Ctx) (any, error) {
	var query mediadto.GetMediaDto
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	page := 0
	if query.Page != nil {
		page = *query.Page
	}
	found, err := h.Media.GetMedia(c.R.Context(), c.Org.ID, page, query.Search)
	if err != nil {
		return nil, err
	}
	results := make([]mediaItem, 0, len(found.Results))
	for _, p := range found.Results {
		results = append(results, mediaItem{ID: p.ID, Name: p.Name, OriginalName: p.OriginalName, Path: p.Path, CreatedAt: p.CreatedAt})
	}
	return map[string]any{"pages": found.Pages, "results": results}, nil
}

type meUser struct {
	ID      string  `json:"id"`
	Name    *string `json:"name"`
	Picture *string `json:"picture"`
}

// getMe: `user` is only known for OAuth app tokens; an API key belongs to the
// whole organization.
func (h *controller) getMe(c *httpx.Ctx) (any, error) {
	var user *meUser
	if c.OAuthUserID != "" {
		personal, err := h.Users.GetPersonal(c.R.Context(), c.OAuthUserID)
		if err != nil {
			return nil, err
		}
		if personal != nil {
			user = &meUser{ID: personal.ID, Name: personal.Name}
			if personal.Picture != nil && personal.Picture.Path != "" {
				user.Picture = &personal.Picture.Path
			}
		}
	}
	return map[string]any{
		"organization": map[string]string{"id": c.Org.ID, "name": c.Org.Name},
		"user":         user,
	}, nil
}

type idName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (h *controller) listGroups(c *httpx.Ctx) (any, error) {
	customers, err := h.Integrations.Customers(c.R.Context(), c.Org.ID)
	if err != nil {
		return nil, err
	}
	out := make([]idName, 0, len(customers))
	for _, customer := range customers {
		out = append(out, idName{ID: customer.ID, Name: customer.Name})
	}
	return out, nil
}

type publicIntegration struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Identifier string  `json:"identifier"`
	Picture    *string `json:"picture"`
	Disabled   bool    `json:"disabled"`
	Profile    *string `json:"profile"`
	Customer   *idName `json:"customer,omitempty"`
}

func (h *controller) listIntegration(c *httpx.Ctx) (any, error) {
	group := c.Query("group")
	list, err := h.Integrations.GetIntegrationsList(c.R.Context(), c.Org.ID)
	if err != nil {
		return nil, err
	}
	out := []publicIntegration{}
	for _, in := range list {
		customer := in.Edges.Customer
		if group != "" && (customer == nil || customer.ID != group) {
			continue
		}
		item := publicIntegration{ID: in.ID, Name: in.Name, Identifier: in.ProviderIdentifier, Picture: in.Picture,
			Disabled: in.Disabled, Profile: in.Profile}
		if in.CustomName != nil && *in.CustomName != "" {
			item.Name = *in.CustomName
		}
		if customer != nil {
			item.Customer = &idName{ID: customer.ID, Name: customer.Name}
		}
		out = append(out, item)
	}
	return out, nil
}

func (h *controller) getIntegrationURL(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	name, refresh := c.Param("integration"), c.Query("refresh")
	if !slices.Contains(h.Manager.GetAllowedSocialsIntegrations(), name) {
		return nil, msg(http.StatusBadRequest, "Integration not allowed")
	}

	// A provider migrated via MIGRATE_PROVIDERS reconnects through its target
	// provider's OAuth: the callback lands on the target and the channel is
	// migrated in place (see migrateIntegration).
	target := name
	if refresh != "" {
		if migrateTo := h.Manager.GetMigrationTarget(name); migrateTo != "" {
			target = migrateTo
		}
	}
	provider := h.Manager.GetSocialIntegration(target)
	if _, ok := provider.(integrations.ExternalURLer); ok {
		return nil, msg(http.StatusBadRequest, "This integration requires an external URL and is not supported via the public API")
	}

	url, err := func() (string, error) {
		generated, err := provider.GenerateAuthURL(ctx, nil)
		if err != nil {
			return "", err
		}
		if refresh != "" {
			if err := h.Store.Set(ctx, "refresh:"+generated.State, refresh, time.Hour); err != nil {
				return "", err
			}
		}
		if err := h.Store.Set(ctx, "organization:"+generated.State, c.Org.ID, time.Hour); err != nil {
			return "", err
		}
		if err := h.Store.Set(ctx, "login:"+generated.State, generated.CodeVerifier, time.Hour); err != nil {
			return "", err
		}
		return generated.URL, nil
	}()
	if err != nil {
		return nil, msg(http.StatusInternalServerError, "Failed to generate auth URL")
	}
	return map[string]string{"url": url}, nil
}

func (h *controller) listUsers(c *httpx.Ctx) (any, error) {
	term := strings.TrimSpace(c.Query("name"))
	if term == "" {
		return nil, msg(http.StatusBadRequest, "A search term is required")
	}
	return h.Users.GetImpersonateUser(c.R.Context(), term)
}

func (h *controller) getPostTimeline(c *httpx.Ctx) (any, error) {
	timeline, err := h.Posts.GetPostTimeline(c.R.Context(), c.Param("id"), c.Org.ID)
	if err != nil {
		return nil, err
	}
	if timeline == nil {
		return nil, msg(http.StatusNotFound, "Post not found")
	}
	return timeline, nil
}

func (h *controller) getAccountOverview(c *httpx.Ctx) (any, error) {
	account, err := h.Organizations.GetAccountOverview(c.R.Context(), c.Org.ID)
	if err != nil {
		return nil, err
	}
	if account == nil {
		return nil, msg(http.StatusNotFound, "Organization not found")
	}
	return account, nil
}

func (h *controller) getChannelHealth(c *httpx.Ctx) (any, error) {
	return h.Integrations.GetChannelHealth(c.R.Context(), c.Org.ID, c.IncludeDeleted)
}

// dayjsLayouts are the ISO 8601 shapes dayjs(string) parses.
var dayjsLayouts = []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999", "2006-01-02T15:04", "2006-01-02"}

func parseDayjs(value string) (time.Time, error) {
	for _, layout := range dayjsLayouts {
		if t, err := time.ParseInLocation(layout, value, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("Invalid Date: %s", value)
}

func (h *controller) getOrgActivity(c *httpx.Ctx) (any, error) {
	var query analyticsdto.GetOrgActivityDto
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	now := time.Now()
	from, to := now.AddDate(0, 0, -30), now
	var err error
	if query.From != nil && *query.From != "" {
		if from, err = parseDayjs(*query.From); err != nil {
			return nil, err
		}
	}
	if query.To != nil && *query.To != "" {
		if to, err = parseDayjs(*query.To); err != nil {
			return nil, err
		}
	}
	from = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.Local)
	to = time.Date(to.Year(), to.Month(), to.Day(), 23, 59, 59, int(999*time.Millisecond), time.Local)

	return h.AdminStats.GetOrgActivity(c.R.Context(), adminstats.OrgActivityParams{
		OrganizationID: c.Org.ID, From: from, To: to, IncludeDeleted: c.IncludeDeleted,
	})
}

func (h *controller) resetCredits(c *httpx.Ctx) (any, error) {
	var body billingdto.ResetCreditsDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	reset, err := h.Subscriptions.ResetCredits(c.R.Context(), c.Org.ID, *body.Type)
	if err != nil {
		return nil, err
	}
	if reset == nil {
		return nil, msg(http.StatusNotFound, "No subscription found")
	}
	return reset, nil
}

func (h *controller) getNotifications(c *httpx.Ctx) (any, error) {
	var query notificationsdto.GetNotificationsDto
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	return h.Notifications.GetNotificationsPaginated(c.R.Context(), c.Org.ID, query.Page)
}

func (h *controller) generateVideo(c *httpx.Ctx) (any, error) {
	var body videosdto.VideoDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	saved, err := h.Media.GenerateVideo(c.R.Context(), c.Org, media.VideoDto{Type: body.Type, Output: body.Output, CustomParams: body.CustomParams})
	return saved, subscriptionError(err)
}

func (h *controller) videoFunction(c *httpx.Ctx) (any, error) {
	var body videosdto.VideoFunctionDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.Media.VideoFunction(c.R.Context(), *body.Identifier, *body.FunctionName, body.Params)
}

func (h *controller) startClipping(c *httpx.Ctx) (any, error) {
	var body clippingdto.ClippingDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	started, err := h.Clipping.StartClipping(c.R.Context(), c.Org, body)
	return started, subscriptionError(err)
}

func (h *controller) getClippings(c *httpx.Ctx) (any, error) {
	page, _ := strconv.Atoi(c.Query("page"))
	return h.Clipping.GetClippings(c.R.Context(), c.Org.ID, page)
}

func (h *controller) getClipping(c *httpx.Ctx) (any, error) {
	return h.Clipping.GetClipping(c.R.Context(), c.Org.ID, c.Param("id"))
}

func (h *controller) deleteChannel(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	id := c.Param("id")
	groups, err := h.Integrations.GetPostsForChannel(ctx, c.Org.ID, id)
	if err != nil {
		return nil, err
	}
	background := context.WithoutCancel(ctx)
	for _, p := range groups {
		go func(group string) { _, _ = h.Posts.DeletePost(background, c.Org.ID, group) }(p.Group)
	}
	return h.Integrations.DeleteChannel(ctx, c.Org.ID, id)
}

type integrationSettings struct {
	Rules     string              `json:"rules"`
	MaxLength int                 `json:"maxLength"`
	Settings  any                 `json:"settings"`
	Tools     []integrations.Tool `json:"tools"`
}

func (h *controller) getIntegrationSettings(c *httpx.Ctx) (any, error) {
	loaded, err := h.Integrations.GetIntegrationByID(c.R.Context(), c.Org.ID, c.Param("id"))
	if err != nil {
		return nil, err
	}
	if loaded == nil {
		return nil, msg(http.StatusNotFound, "Integration not found")
	}

	provider := h.Manager.GetSocialIntegration(loaded.ProviderIdentifier)
	if provider == nil {
		return map[string]any{"output": integrationSettings{Settings: map[string]any{}, Tools: []integrations.Tool{}}}, nil
	}

	// maxLength(verified): the provider reads the "Verified" entry itself
	var additional []integrations.AdditionalSetting
	if loaded.AdditionalSettings != nil {
		if err := json.Unmarshal([]byte(*loaded.AdditionalSettings), &additional); err != nil {
			return nil, err
		}
	}
	identifier := provider.Info().Identifier
	var settings any = "No additional settings required"
	if dto := provider.SettingsDTO(); dto != nil && h.ValidationSchema != nil {
		if schema := h.ValidationSchema(dto); schema != nil {
			settings = schema
		}
	}
	return map[string]any{"output": integrationSettings{
		Rules:     h.Manager.GetAllRulesDescription()[identifier],
		MaxLength: provider.MaxLength(additional, nil),
		Settings:  settings,
		Tools:     h.Manager.GetAllTools()[identifier],
	}}, nil
}

func (h *controller) getMissingContent(c *httpx.Ctx) (any, error) {
	return h.Posts.GetMissingContent(c.R.Context(), c.Org.ID, c.Param("id"), false)
}

func (h *controller) updatePostSettings(c *httpx.Ctx) (any, error) {
	var body postsdto.UpdatePostSettingsDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.Posts.UpdatePostSettings(c.R.Context(), c.Org.ID, c.Param("id"), body.Settings, post.CreationMethodAPI)
}

func (h *controller) changePostStatus(c *httpx.Ctx) (any, error) {
	var body postsdto.ChangePostStatusDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.Posts.ChangePostStatus(c.R.Context(), c.Org.ID, c.Param("id"), body.Status)
}

func (h *controller) updateReleaseID(c *httpx.Ctx) (any, error) {
	var body struct {
		ReleaseID string `json:"releaseId"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	updated, err := h.Posts.UpdateReleaseID(c.R.Context(), c.Org.ID, c.Param("id"), body.ReleaseID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, errors.New("post not found")
	}
	// the batch only links the posts in the dashboard
	cp := *updated
	cp.BatchID = nil
	data, err := json.Marshal(&cp)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(bytes.Replace(data, []byte(`,"batchId":null`), nil, 1)), nil
}

func (h *controller) getAnalytics(c *httpx.Ctx) (any, error) {
	return h.Integrations.CheckAnalytics(c.R.Context(), c.Org, c.Param("integration"), c.Query("date"), false)
}

func (h *controller) getPostAnalytics(c *httpx.Ctx) (any, error) {
	date, _ := strconv.ParseFloat(c.Query("date"), 64)
	return h.Posts.CheckPostAnalytics(c.R.Context(), c.Org.ID, c.Param("postId"), int64(date), false)
}

func (h *controller) triggerIntegrationTool(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var body struct {
		MethodName string          `json:"methodName"`
		Data       json.RawMessage `json:"data"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	in, err := h.Integrations.GetIntegrationByID(ctx, c.Org.ID, c.Param("id"))
	if err != nil {
		return nil, err
	}
	if in == nil {
		return nil, msg(http.StatusNotFound, "Integration not found")
	}

	provider := h.Manager.GetSocialIntegration(in.ProviderIdentifier)
	if provider == nil {
		return nil, msg(http.StatusNotFound, "Integration provider not found")
	}

	tools := h.Manager.GetAllTools()[provider.Info().Identifier]
	fn := provider.Functions()[body.MethodName]
	if fn == nil || !slices.ContainsFunc(tools, func(t integrations.Tool) bool { return t.MethodName == body.MethodName }) {
		return nil, msg(http.StatusNotFound, "Tool not found")
	}

	data := body.Data
	if !truthyJSON(data) {
		data = json.RawMessage("{}")
	}
	for {
		result, err := fn(ctx, in.Token, data, in.InternalID, in)
		if err == nil {
			return map[string]any{"output": result}, nil
		}
		if temporalx.FailureType(err) != temporalx.TypeRefreshToken {
			return nil, msg(http.StatusInternalServerError, "Unexpected error")
		}

		refreshed, err := h.Integrations.RefreshIntegrationService().Refresh(ctx, in, "")
		if err != nil {
			return nil, err
		}
		if refreshed == nil {
			if err := h.Integrations.DisconnectChannel(ctx, c.Org.ID, in, ""); err != nil {
				return nil, err
			}
			return nil, msg(http.StatusUnauthorized, "Channel disconnected due to expired token")
		}
		if refreshed.AccessToken == "" {
			return nil, msg(http.StatusInternalServerError, "Unexpected error")
		}
		in.Token = refreshed.AccessToken
		if provider.Info().RefreshWait {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(refreshWait):
			}
		}
	}
}

// truthyJSON is JavaScript truthiness of a raw JSON value.
func truthyJSON(raw json.RawMessage) bool {
	switch strings.TrimSpace(string(raw)) {
	case "", "null", "false", "0", `""`:
		return false
	}
	return true
}
