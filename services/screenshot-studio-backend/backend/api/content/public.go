package content

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/subscriptions"
	commentdtos "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/comments"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/track"
)

type publicController struct {
	track         TrackService
	agentInsert   AgentGraphInsertService
	posts         *posts.Service
	subscriptions *subscriptions.Service
}

// RegisterPublicController registers PublicController (/public). store backs
// the global ThrottlerBehindProxyGuard, which on this controller only limits
// POST /public/posts/:id/comments (no auth runs here, so the guard sees the
// same request it would see globally).
func RegisterPublicController(r *httpx.Router, trackService TrackService, agentInsert AgentGraphInsertService,
	postsService *posts.Service, subscriptionService *subscriptions.Service, store redis.Store) {
	h := &publicController{track: trackService, agentInsert: agentInsert, posts: postsService, subscriptions: subscriptionService}
	g := r.Group("/public")
	g.Post("/agent", h.createAgent)
	g.Get("/posts/:id", h.getPreview)
	g.Get("/posts/:id/comments", h.getComments)
	g.Post("/posts/:id/comments", h.createComment, httpx.With(auth.ThrottlerBehindProxyGuard(store)))
	g.Post("/t", h.trackEvent, httpx.Raw())
	g.Post("/modify-subscription", h.modifySubscription)
	g.Get("/stream", h.streamFile, httpx.Raw())
}

func (h *publicController) createAgent(c *httpx.Ctx) (any, error) {
	var body struct {
		Text   string `json:"text"`
		APIKey string `json:"apiKey"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	key := os.Getenv("AGENT_API_KEY")
	if body.APIKey == "" || key == "" || body.APIKey != key {
		return nil, nil
	}
	return h.agentInsert.NewPost(c.R.Context(), body.Text)
}

type previewIntegration struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Picture            *string `json:"picture"`
	ProviderIdentifier string  `json:"providerIdentifier"`
	Profile            *string `json:"profile"`
}

func (h *publicController) getPreview(c *httpx.Ctx) (any, error) {
	list, err := h.posts.GetPostsRecursively(c.R.Context(), c.Param("id"), true, "")
	if err != nil {
		return nil, err
	}
	// the batch only links the posts in the dashboard, it stays out of the
	// public preview
	out := make([]json.RawMessage, 0, len(list))
	for _, p := range list {
		data, err := json.Marshal(p)
		if err != nil {
			return nil, err
		}
		replace := map[string]any{}
		if i := p.Edges.Integration; i != nil {
			replace["integration"] = previewIntegration{
				ID: i.ID, Name: i.Name, Picture: i.Picture, ProviderIdentifier: i.ProviderIdentifier, Profile: i.Profile,
			}
		}
		row, err := rewriteObject(data, []string{"childrenPost", "batchId"}, replace)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

func (h *publicController) getComments(c *httpx.Ctx) (any, error) {
	comments, err := h.posts.GetComments(c.R.Context(), c.Param("id"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"comments": comments}, nil
}

func (h *publicController) createComment(c *httpx.Ctx) (any, error) {
	var body commentdtos.CreatePublicCommentDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return nullable(h.posts.CreatePublicComment(c.R.Context(), c.Param("id"), &body, "", c.RealIP()))
}

// trackCookie is res.cookie(name, value, { domain, secure, httpOnly,
// sameSite: 'none', expires: +1 year }).
func trackCookie(name, value string) *http.Cookie {
	cookie := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Domain:   helpers.GetCookieURLFromDomain(os.Getenv("FRONTEND_URL")),
		SameSite: http.SameSiteNoneMode,
		Expires:  time.Now().Add(365 * 24 * time.Hour),
	}
	if os.Getenv("NOT_SECURED") == "" {
		cookie.Secure = true
		cookie.HttpOnly = true
	}
	return cookie
}

func (h *publicController) trackEvent(c *httpx.Ctx) (any, error) {
	var body struct {
		Fbclid     string         `json:"fbclid"`
		TT         track.Enum     `json:"tt"`
		Additional map[string]any `json:"additional"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	uniqueID := c.Cookie("track")
	if uniqueID == "" {
		uniqueID = ids.Make(10)
	}
	fbclid := c.Cookie("fbclid")
	if fbclid == "" {
		fbclid = body.Fbclid
	}
	if err := h.track.Track(c.R.Context(), uniqueID, c.RealIP(), c.Header("User-Agent"), body.TT, body.Additional, fbclid, nil); err != nil {
		return nil, err
	}
	if c.Cookie("track") == "" {
		c.SetCookie(trackCookie("track", uniqueID))
	}
	if body.Fbclid != "" && c.Cookie("fbclid") == "" {
		c.SetCookie(trackCookie("fbclid", body.Fbclid))
	}
	c.JSON(http.StatusOK, map[string]string{"track": uniqueID})
	return nil, nil
}

func (h *publicController) modifySubscription(c *httpx.Ctx) (any, error) {
	var body struct {
		Params any `json:"params"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	fail := map[string]bool{"success": false}

	params, _ := body.Params.(string)
	load, err := helpers.VerifyJWT(params)
	if err != nil {
		return fail, nil
	}
	orgID, _ := load["orgId"].(string)
	billing, _ := load["billing"].(string)
	plan, ok := subscriptions.Pricing[billing]
	if orgID == "" || billing == "" || !ok {
		return fail, nil
	}

	if _, err := h.subscriptions.ModifySubscriptionByOrg(c.R.Context(), orgID, plan.Channel, billing); err != nil {
		return fail, nil
	}
	return map[string]bool{"success": true}, nil
}

const maxRedirects = 5

func (h *publicController) streamFile(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var query webhooks.OnlyURL
	if err := c.BindQuery(&query); err != nil {
		return nil, err
	}
	if err := query.Validate(ctx); err != nil {
		return nil, err
	}
	if !strings.HasSuffix(query.URL, "mp4") {
		c.Send(http.StatusBadRequest, "Invalid video URL")
		return nil, nil
	}

	// Manually follow redirects so every hop is re-validated against
	// the SSRF blocklist (see GHSA-34w8-5j2v-h6ww). Following redirects
	// automatically would bypass the DTO-level URL check.
	client := *ssrf.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	currentURL := query.URL
	var r *http.Response
	for hop := 0; hop <= maxRedirects; hop++ {
		if !ssrf.IsSafePublicHTTPSURL(ctx, currentURL) {
			c.Send(http.StatusBadRequest, "Blocked URL")
			return nil, nil
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, currentURL, nil)
		if err != nil {
			return nil, err
		}
		if r, err = client.Do(req); err != nil {
			return nil, err
		}

		if r.StatusCode >= 300 && r.StatusCode < 400 {
			r.Body.Close()
			location := r.Header.Get("Location")
			if location == "" {
				c.Send(http.StatusBadGateway, "Redirect without Location")
				return nil, nil
			}
			base, err := url.Parse(currentURL)
			if err != nil {
				c.Send(http.StatusBadRequest, "Invalid redirect target")
				return nil, nil
			}
			next, err := base.Parse(location)
			if err != nil {
				c.Send(http.StatusBadRequest, "Invalid redirect target")
				return nil, nil
			}
			currentURL = next.String()
			continue
		}
		break
	}

	if r == nil {
		c.Send(http.StatusBadGateway, "No upstream response")
		return nil, nil
	}
	if r.StatusCode >= 300 && r.StatusCode < 400 {
		c.Send(http.StatusLoopDetected, "Too many redirects")
		return nil, nil
	}
	defer r.Body.Close()

	if (r.StatusCode < 200 || r.StatusCode > 299) && r.StatusCode != http.StatusPartialContent {
		return nil, errors.New("Upstream error: " + strings.TrimPrefix(r.Status, strconv.Itoa(r.StatusCode)+" "))
	}

	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.SetHeader("Content-Type", contentType)
	if contentRange := r.Header.Get("Content-Range"); contentRange != "" {
		c.SetHeader("Content-Range", contentRange)
	}
	if length := r.Header.Get("Content-Length"); length != "" {
		c.SetHeader("Content-Length", length)
	}
	acceptRanges := r.Header.Get("Accept-Ranges")
	if acceptRanges == "" {
		acceptRanges = "bytes"
	}
	c.SetHeader("Accept-Ranges", acceptRanges)

	status := http.StatusOK
	if r.StatusCode == http.StatusPartialContent {
		status = http.StatusPartialContent // Partial Content for range responses
	}
	c.MarkWritten()
	c.W.WriteHeader(status)
	_, _ = io.Copy(c.W, r.Body)
	return nil, nil
}
