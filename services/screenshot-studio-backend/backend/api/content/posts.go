package content

import (
	"encoding/json"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/posts"
	commentdtos "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/comments"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/generator"
	dtos "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// postsBodyLimit is main.ts `json({ limit: '50mb' })` on /posts.
const postsBodyLimit = 50 << 20

type postsController struct {
	posts      *posts.Service
	agentGraph AgentGraphService
	shortLink  ShortLinkService
}

// RegisterPostsController registers PostsController (/posts) behind the auth
// middleware.
func RegisterPostsController(r *httpx.Router, authMiddleware httpx.Middleware, perms *auth.PermissionsService,
	postsService *posts.Service, agentGraph AgentGraphService, shortLink ShortLinkService) {
	h := &postsController{posts: postsService, agentGraph: agentGraph, shortLink: shortLink}
	g := r.Group("/posts", authMiddleware, func(c *httpx.Ctx) error {
		c.BodyLimit(postsBodyLimit)
		return nil
	})
	postsPerMonth := perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionPostsPerMonth))

	g.Get("/:id/statistics", h.getStatistics)
	g.Get("/:id/missing", h.getMissingContent)
	g.Get("/:id/release-url", h.getReleaseURL)
	g.Put("/:id/release-id", h.updateReleaseID)
	g.Post("/should-shortlink", h.shouldShortlink)
	g.Post("/:id/comments", h.createComment)
	g.Put("/comments/:commentId/resolve", h.resolveComment)
	g.Get("/tags", h.getTags)
	g.Post("/tags", h.createTag)
	g.Put("/tags/:id", h.editTag)
	g.Delete("/tags/:id", h.deleteTag)
	g.Get("/", h.getPosts)
	g.Get("/find-slot", h.findSlot)
	g.Get("/find-slot/:id", h.findSlotIntegration)
	g.Get("/list", h.getPostsList)
	g.Get("/old", h.oldPosts)
	g.Get("/group/:group/debug-export", h.getPostGroupDebugExport)
	g.Get("/group/:group", h.getPostsByGroup)
	g.Get("/:id", h.getPost)
	g.Post("/valid", h.validatePosts)
	g.Post("/", h.createPost, postsPerMonth)
	g.Post("/generator/draft", h.generatePostsDraft, postsPerMonth)
	g.Post("/generator", h.generatePosts, postsPerMonth, httpx.Raw())
	g.Delete("/:group", h.deletePost)
	g.Put("/:id/date", h.changeDate)
	g.Post("/separate-posts", h.separatePosts)
}

func (h *postsController) getStatistics(c *httpx.Ctx) (any, error) {
	return h.posts.GetStatistics(c.R.Context(), c.Org.ID, c.Param("id"))
}

func (h *postsController) getMissingContent(c *httpx.Ctx) (any, error) {
	return h.posts.GetMissingContent(c.R.Context(), c.Org.ID, c.Param("id"), false)
}

func (h *postsController) getReleaseURL(c *httpx.Ctx) (any, error) {
	return nullable(h.posts.GetReleaseURL(c.R.Context(), c.Org.ID, c.Param("id"), false))
}

func (h *postsController) updateReleaseID(c *httpx.Ctx) (any, error) {
	var body struct {
		ReleaseID string `json:"releaseId"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return nullable(h.posts.UpdateReleaseID(c.R.Context(), c.Org.ID, c.Param("id"), body.ReleaseID))
}

func (h *postsController) shouldShortlink(c *httpx.Ctx) (any, error) {
	var body struct {
		Messages []string `json:"messages"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return map[string]bool{"ask": h.shortLink.AskShortLinkedin(body.Messages)}, nil
}

func (h *postsController) createComment(c *httpx.Ctx) (any, error) {
	var body commentdtos.CreatePublicCommentDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return nullable(h.posts.CreatePublicComment(c.R.Context(), c.Param("id"), &body, c.User.ID, c.RealIP()))
}

func (h *postsController) resolveComment(c *httpx.Ctx) (any, error) {
	var body commentdtos.ResolveCommentDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return nullable(h.posts.ResolveComment(c.R.Context(), c.Org.ID, c.Param("commentId"), body.Resolved))
}

func (h *postsController) getTags(c *httpx.Ctx) (any, error) {
	tags, err := h.posts.GetTags(c.R.Context(), c.Org.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"tags": tags}, nil
}

func (h *postsController) createTag(c *httpx.Ctx) (any, error) {
	var body dtos.CreateTagDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return nullable(h.posts.CreateTag(c.R.Context(), c.Org.ID, &body))
}

func (h *postsController) editTag(c *httpx.Ctx) (any, error) {
	var body dtos.CreateTagDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return nullable(h.posts.EditTag(c.R.Context(), c.Param("id"), c.Org.ID, &body))
}

func (h *postsController) deleteTag(c *httpx.Ctx) (any, error) {
	return nullable(h.posts.DeleteTag(c.R.Context(), c.Param("id"), c.Org.ID))
}

func (h *postsController) getPosts(c *httpx.Ctx) (any, error) {
	var query dtos.GetPostsDto
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	return h.posts.GetPostsMinified(c.R.Context(), c.Org.ID, &query)
}

func (h *postsController) findSlot(c *httpx.Ctx) (any, error) {
	date, err := h.posts.FindFreeDateTime(c.R.Context(), c.Org.ID, "")
	if err != nil {
		return nil, err
	}
	return map[string]string{"date": date}, nil
}

func (h *postsController) findSlotIntegration(c *httpx.Ctx) (any, error) {
	date, err := h.posts.FindFreeDateTime(c.R.Context(), c.Org.ID, c.Param("id"))
	if err != nil {
		return nil, err
	}
	return map[string]string{"date": date}, nil
}

func (h *postsController) getPostsList(c *httpx.Ctx) (any, error) {
	var query dtos.GetPostsListDto
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	return h.posts.GetPostsList(c.R.Context(), c.Org.ID, &query)
}

func (h *postsController) oldPosts(c *httpx.Ctx) (any, error) {
	return h.posts.GetOldPosts(c.R.Context(), c.Org.ID, c.Query("date"))
}

func (h *postsController) getPostGroupDebugExport(c *httpx.Ctx) (any, error) {
	if !c.User.IsSuperAdmin {
		return nil, httpx.HTTPException("Forbidden", http.StatusForbidden)
	}
	return h.posts.GetPostGroupDebugExport(c.R.Context(), c.Org.ID, c.Param("group"))
}

func (h *postsController) getPostsByGroup(c *httpx.Ctx) (any, error) {
	return h.posts.GetPostsByGroup(c.R.Context(), c.Org.ID, c.Param("group"))
}

func (h *postsController) getPost(c *httpx.Ctx) (any, error) {
	return h.posts.GetPost(c.R.Context(), c.Org.ID, c.Param("id"), false)
}

func (h *postsController) validatePosts(c *httpx.Ctx) (any, error) {
	var body dtos.CreatePostDto
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return h.posts.ValidatePosts(c.R.Context(), c.Org.ID, body.Posts)
}

func (h *postsController) createPost(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var rawBody dtos.CreatePostDto
	if err := c.Decode(&rawBody); err != nil {
		return nil, err
	}

	// Server-side validation — never trust the client to have validated.
	validation, err := h.posts.ValidatePosts(ctx, c.Org.ID, rawBody.Posts)
	if err != nil {
		return nil, err
	}

	fail := func(item posts.PostValidation, message string) error {
		return auth.PostValidationException(auth.PostValidationError{
			Provider: item.Identifier,
			Name:     item.Name,
			Error:    message,
		})
	}

	for _, item := range validation {
		if item.EmptyContent {
			return nil, fail(item, "Your post should have at least one character or one image.")
		}
	}

	if rawBody.Type != "draft" {
		for _, item := range validation {
			if !item.Valid {
				message := item.SettingsError
				if message == "" {
					message = "Please fix your settings"
				}
				return nil, fail(item, message)
			}
			if item.Errors != true {
				message, _ := item.Errors.(string)
				return nil, fail(item, message)
			}
			if item.TooLong {
				return nil, fail(item, "post is too long, please fix it")
			}
		}
	}

	body, err := h.posts.MapTypeToPost(ctx, &rawBody, c.Org.ID, false)
	if err != nil {
		return nil, err
	}
	return h.posts.CreatePost(ctx, c.Org.ID, body, post.CreationMethodWEB, false)
}

func (h *postsController) generatePostsDraft(c *httpx.Ctx) (any, error) {
	var body generator.CreateGeneratedPostsDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return nil, h.posts.GeneratePostsDraft(c.R.Context(), c.Org.ID, &body)
}

type errorEvent struct {
	Name    string `json:"name"`
	Error   bool   `json:"error"`
	Message string `json:"message"`
}

// generatePosts streams the generator events as NDJSON.
func (h *postsController) generatePosts(c *httpx.Ctx) (any, error) {
	var body generator.GeneratorDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}

	c.SetHeader("Content-Type", "application/json; charset=utf-8")
	c.MarkWritten()
	flusher := http.NewResponseController(c.W)
	writeLine := func(v any) error {
		data, err := json.Marshal(v)
		if err != nil {
			return err
		}
		if _, err := c.W.Write(append(data, '\n')); err != nil {
			return err
		}
		_ = flusher.Flush()
		return nil
	}

	for event, err := range h.agentGraph.Start(c.R.Context(), c.Org.ID, &body) {
		if err == nil {
			err = writeLine(event)
		}
		if err != nil {
			// The stream has already started, so we cannot surface a normal HTTP
			// error here. Emit a final error event on the open stream instead, so the
			// client can stop and show the message rather than hang on a truncated
			// stream. HttpExceptions carry a curated, user-facing message (e.g. the
			// AI safety rejection); anything else gets a generic message.
			message, ok := exceptionMessage(err)
			if !ok {
				message = "Something went wrong while generating your posts, please try again."
			}
			_ = writeLine(errorEvent{Name: "error", Error: true, Message: message})
			break
		}
	}
	// res.end() without a write still sends the 200 headers.
	_ = flusher.Flush()
	return nil, nil
}

func (h *postsController) deletePost(c *httpx.Ctx) (any, error) {
	return h.posts.DeletePost(c.R.Context(), c.Org.ID, c.Param("group"))
}

func (h *postsController) changeDate(c *httpx.Ctx) (any, error) {
	var body struct {
		Date string `json:"date"`
		// 'update' is the safe default: clients that don't send an action must
		// never requeue (and thereby republish) a post by accident
		Action    *string `json:"action"`
		Republish bool    `json:"republish"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	action := "update"
	if body.Action != nil {
		action = *body.Action
	}
	return nullable(h.posts.ChangeDate(c.R.Context(), c.Org.ID, c.Param("id"), body.Date, action, body.Republish))
}

func (h *postsController) separatePosts(c *httpx.Ctx) (any, error) {
	var body struct {
		Content string `json:"content"`
		Len     int    `json:"len"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	return nullable(h.posts.SeparatePosts(c.R.Context(), body.Content, body.Len))
}
