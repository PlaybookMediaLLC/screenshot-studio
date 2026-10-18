// Package reddit is the Reddit provider.
package reddit

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

const identifier = "reddit"

// Base URLs, overridden by tests.
var (
	wwwURL       = "https://www.reddit.com"
	oauthURL     = "https://oauth.reddit.com"
	uploadScheme = "https:"
	submitDelay  = 5 * time.Second
)

var scopes = []string{"read", "identity", "submit", "flair"}

type Provider struct {
	*integrations.Base
}

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.PendingPoster = (*Provider)(nil)
	_ integrations.Commenter     = (*Provider)(nil)
)

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, nil)}
}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier: identifier,
		Name:       "Reddit",
		Editor:     "normal",
		Scopes:     scopes,
		// Reddit has strict rate limits (1 request per second)
		MaxConcurrentJob: 1,
	}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 10000 }

func (p *Provider) SettingsDTO() any { return &RedditSettingsDTO{} }

func (p *Provider) CheckValidity(_ context.Context, posts [][]integrations.ValidityMedia, settings json.RawMessage, _ []integrations.AdditionalSetting) (string, error) {
	var s struct {
		Subreddit []struct {
			Value *struct {
				Type string `json:"type"`
			} `json:"value"`
		} `json:"subreddit"`
	}
	_ = json.Unmarshal(settings, &s)
	for _, item := range s.Subreddit {
		if item.Value != nil && item.Value.Type == "media" && (len(posts) == 0 || len(posts[0]) != 1) {
			return "When posting a media post, you must attached exactly one media file.", nil
		}
	}
	for _, post := range posts {
		for _, media := range post {
			if media.Thumbnail == "" && strings.Contains(media.Path, "mp4") {
				return "You must attach a thumbnail to your video post.", nil
			}
		}
	}
	return "", nil
}

func basicAuth() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(os.Getenv("REDDIT_CLIENT_ID")+":"+os.Getenv("REDDIT_CLIENT_SECRET")))
}

// form encodes pairs in order, like URLSearchParams.
func form(pairs ...string) []byte {
	var b strings.Builder
	for i := 0; i+1 < len(pairs); i += 2 {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(url.QueryEscape(pairs[i]) + "=" + url.QueryEscape(pairs[i+1]))
	}
	return []byte(b.String())
}

func encodeURIComponent(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        any    `json:"scope"`
}

func (p *Provider) requestToken(ctx context.Context, body []byte) (*tokenResponse, error) {
	res, err := p.Fetch(ctx, wwwURL+"/api/v1/access_token", integrations.Request{
		Method: http.MethodPost,
		Headers: map[string]string{
			"Content-Type":  "application/x-www-form-urlencoded",
			"Authorization": basicAuth(),
		},
		Body: body,
	})
	if err != nil {
		return nil, err
	}
	var token tokenResponse
	return &token, res.JSON(&token)
}

func (p *Provider) me(ctx context.Context, accessToken string) (id, name, picture string, err error) {
	res, err := p.Fetch(ctx, oauthURL+"/api/v1/me", integrations.Request{
		Headers: map[string]string{"Authorization": "Bearer " + accessToken},
	})
	if err != nil {
		return "", "", "", err
	}
	var me struct {
		Name    string `json:"name"`
		ID      string `json:"id"`
		IconImg string `json:"icon_img"`
	}
	if err := res.JSON(&me); err != nil {
		return "", "", "", err
	}
	return me.ID, me.Name, strings.Split(me.IconImg, "?")[0], nil
}

func (p *Provider) RefreshToken(ctx context.Context, refreshToken string) (*integrations.AuthTokenDetails, error) {
	token, err := p.requestToken(ctx, form("grant_type", "refresh_token", "refresh_token", refreshToken))
	if err != nil {
		return nil, err
	}
	id, name, picture, err := p.me(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	return &integrations.AuthTokenDetails{
		ID: id, Name: name, AccessToken: token.AccessToken, RefreshToken: refreshToken,
		ExpiresIn: token.ExpiresIn, Picture: picture, Username: name,
	}, nil
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	codeVerifier := ids.Secure(30)
	authURL := "https://www.reddit.com/api/v1/authorize?client_id=" + os.Getenv("REDDIT_CLIENT_ID") +
		"&response_type=code&state=" + state +
		"&redirect_uri=" + encodeURIComponent(os.Getenv("FRONTEND_URL")+"/integrations/social/reddit") +
		"&duration=permanent&scope=" + encodeURIComponent(strings.Join(scopes, " "))
	return &integrations.GenerateAuthURLResponse{URL: authURL, CodeVerifier: codeVerifier, State: state}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	token, err := p.requestToken(ctx, form(
		"grant_type", "authorization_code",
		"code", params.Code,
		"redirect_uri", os.Getenv("FRONTEND_URL")+"/integrations/social/reddit",
	))
	if err != nil {
		return nil, err
	}
	if err := p.CheckScopes(scopes, token.Scope); err != nil {
		return nil, err
	}
	id, name, picture, err := p.me(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	return &integrations.AuthTokenDetails{
		ID: id, Name: name, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken,
		ExpiresIn: token.ExpiresIn, Picture: picture, Username: name,
	}, nil
}

// mediaTypes covers what mime-types' lookup returns for post media, which
// Go's built-in table may lack.
var mediaTypes = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
	".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime",
}

// lookup is mime-types' lookup: "" when the extension is unknown.
func lookup(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if t, ok := mediaTypes[ext]; ok {
		return t
	}
	t, _, _ := strings.Cut(mime.TypeByExtension(ext), ";")
	return t
}

var locationRe = regexp.MustCompile(`<Location>(.*?)</Location>`)

func (p *Provider) uploadFileToReddit(ctx context.Context, accessToken, path string) (string, error) {
	mimeType := lookup(path)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	filename := path[strings.LastIndex(path, "/")+1:]

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("filepath", filename)
	_ = w.WriteField("mimetype", mimeType)
	_ = w.Close()
	res, err := p.Fetch(ctx, oauthURL+"/api/media/asset", integrations.Request{
		Method:  http.MethodPost,
		Headers: map[string]string{"Authorization": "Bearer " + accessToken, "Content-Type": w.FormDataContentType()},
		Body:    buf.Bytes(),
	})
	if err != nil {
		return "", err
	}
	var lease struct {
		Args struct {
			Action string `json:"action"`
			Fields []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
			} `json:"fields"`
		} `json:"args"`
	}
	if err := res.JSON(&lease); err != nil {
		return "", err
	}

	// Stream the file into Reddit's S3 form instead of buffering it in memory.
	// S3 requires the exact part length, which comes from a HEAD request.
	fileSize, err := p.MediaSize(ctx, path, identifier)
	if err != nil {
		return "", err
	}
	stream, err := p.MediaStream(ctx, path, identifier)
	if err != nil {
		return "", err
	}
	defer stream.Close()

	buf.Reset()
	w = multipart.NewWriter(&buf)
	for _, field := range lease.Args.Fields {
		_ = w.WriteField(field.Name, field.Value)
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	header.Set("Content-Type", mimeType)
	if _, err := w.CreatePart(header); err != nil {
		return "", err
	}
	head := bytes.Clone(buf.Bytes())
	buf.Reset()
	_ = w.Close()
	length := int64(len(head)) + fileSize + int64(buf.Len())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, uploadScheme+lease.Args.Action, io.MultiReader(bytes.NewReader(head), stream, &buf))
	if err != nil {
		return "", err
	}
	req.ContentLength = length
	req.Header.Set("Content-Type", w.FormDataContentType())
	upload, err := integrations.Do(req)
	if err != nil {
		return "", err
	}

	// S3 only echoes a <Location> body when the POST succeeds with 201; guard
	// the parse so an empty/unexpected body fails with a clear error.
	match := locationRe.FindStringSubmatch(string(upload.Body))
	if match == nil || match[1] == "" {
		body := string(upload.Body)
		if body == "" {
			body = "{}"
		}
		return "", temporalx.BadBody(identifier, body, "{}", "Reddit media upload did not return a location")
	}
	return match[1], nil
}

// RedditPendingData travels through the workflow history between
// postPending, checkPostStatus and finalizePost. The cursor makes every
// subreddit submit its own finalizePost call, and `armed` is the
// submit-in-flight handshake: set by checkPostStatus BEFORE finalizePost runs
// (the workflow commits it first), so an interrupted submit is detected by
// the next check instead of re-run.
type RedditPendingData struct {
	Subreddits     []RedditSettingsValueDTO `json:"subreddits"`
	Message        string                   `json:"message"`
	MediaPath      string                   `json:"mediaPath,omitempty"`
	MediaThumbnail string                   `json:"mediaThumbnail,omitempty"`
	Cursor         int                      `json:"cursor"`
	Results        []PendingResult          `json:"results"`
	Armed          *Armed                   `json:"armed,omitempty"`
}

type PendingResult struct {
	PostID     string `json:"postId"`
	ReleaseURL string `json:"releaseURL"`
}

type Armed struct {
	Sr    string `json:"sr"`
	Title string `json:"title"`
	// When this attempt was armed (ms): bounds the listing lookup (so an older
	// post with the same title is never mistaken for this one) and the
	// resubmit guard (a timed-out finalize may still be running for up to the
	// 10-minute activity ceiling).
	ArmedAt int64 `json:"armedAt"`
	// Media submissions appear in the listing minutes after the submit
	// (Reddit creates them asynchronously), so their recovery lookups get a
	// longer grace before concluding the submit never landed.
	Media bool `json:"media"`
	// true once Reddit accepted the submit (media posts answer with only a
	// websocket url) - the id is then recovered from the submitted listing,
	// and the submit must NEVER run again.
	Submitted bool `json:"submitted"`
	Lookups   int  `json:"lookups"`
}

var srPrefix = regexp.MustCompile(`^/?r/`)

func normalizeSr(subreddit string) string {
	return strings.ToLower(strings.Trim(srPrefix.ReplaceAllString(subreddit, ""), "/"))
}

func deref[T any](v *T) T {
	var zero T
	if v == nil {
		return zero
	}
	return *v
}

func nowMs() int64 { return time.Now().UnixMilli() }

type found struct{ id, url string }

// findSubmittedPost is a read-only recovery of a submission: the submit
// endpoint answers media posts with only a websocket url, and an interrupted
// activity may have submitted without us seeing the response - the user's
// newest submissions answer both cases without ever re-submitting.
func (p *Provider) findSubmittedPost(ctx context.Context, accessToken, username, sr, title string, armedAt int64) (*found, error) {
	res, err := p.Fetch(ctx, oauthURL+"/user/"+username+"/submitted?limit=25&sort=new", integrations.Request{
		Method:  http.MethodGet,
		Headers: map[string]string{"Authorization": "Bearer " + accessToken},
	})
	if err != nil {
		return nil, err
	}
	var listing struct {
		Data *struct {
			Children []struct {
				Data struct {
					ID         string  `json:"id"`
					Subreddit  string  `json:"subreddit"`
					Title      string  `json:"title"`
					CreatedUTC float64 `json:"created_utc"`
					Permalink  string  `json:"permalink"`
				} `json:"data"`
			} `json:"children"`
		} `json:"data"`
	}
	if err := res.JSON(&listing); err != nil {
		return nil, err
	}

	// Only submissions created after this attempt was armed (with a minute of
	// clock slack): an older post with the same title in the same subreddit
	// must never be mistaken for this one. Fall back to a one-hour window for
	// pendingData that predates the armedAt field.
	cutoff := nowMs() - 60*60*1000
	if armedAt != 0 {
		cutoff = armedAt - 60*1000
	}
	if listing.Data == nil {
		return nil, nil
	}
	for _, child := range listing.Data.Children {
		c := child.Data
		if strings.ToLower(c.Subreddit) == sr && (title == "" || c.Title == title) && c.CreatedUTC*1000 > float64(cutoff) {
			if c.ID == "" {
				return nil, nil
			}
			link := "https://www.reddit.com/r/" + sr
			if c.Permalink != "" {
				link = "https://www.reddit.com" + c.Permalink
			}
			return &found{id: c.ID, url: link}, nil
		}
	}
	return nil, nil
}

func completedResponse(results []PendingResult) *integrations.PendingCheckResponse {
	var postIDs, urls []string
	for _, r := range results {
		if r.PostID != "" {
			postIDs = append(postIDs, r.PostID)
		}
		if r.ReleaseURL != "" {
			urls = append(urls, r.ReleaseURL)
		}
	}
	return &integrations.PendingCheckResponse{Status: "completed", PostID: strings.Join(postIDs, ","), ReleaseURL: strings.Join(urls, ",")}
}

func pending(status string, data *RedditPendingData) (*integrations.PendingCheckResponse, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return &integrations.PendingCheckResponse{Status: status, PendingData: raw}, nil
}

func decodePending(raw json.RawMessage) (*RedditPendingData, error) {
	data := &RedditPendingData{}
	if err := json.Unmarshal(raw, data); err != nil {
		return nil, err
	}
	if data.Results == nil {
		data.Results = []PendingResult{}
	}
	return data, nil
}

func (p *Provider) PostPending(_ context.Context, _ string, _ string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	post := posts[0]
	var settings RedditSettingsDTO
	if len(post.Settings) > 0 {
		if err := json.Unmarshal(post.Settings, &settings); err != nil {
			return nil, err
		}
	}
	data := &RedditPendingData{Subreddits: settings.Subreddit, Message: post.Message, Results: []PendingResult{}}
	if len(post.Media) > 0 {
		data.MediaPath = post.Media[0].Path
		data.MediaThumbnail = post.Media[0].Thumbnail
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	// Nothing is submitted here: finalizePost publishes ONE subreddit per call
	// (advancing the cursor between calls), so a crashed activity can never
	// replay the whole loop and duplicate every already-published subreddit.
	return []integrations.PostResponse{{ID: post.ID, Status: "pending", PendingData: raw}}, nil
}

func (p *Provider) CheckPostStatus(ctx context.Context, accessToken string, pendingData json.RawMessage, integration *ent.Integration) (*integrations.PendingCheckResponse, error) {
	data, err := decodePending(pendingData)
	if err != nil {
		return nil, err
	}

	// A previous finalizePost may have died mid-submit (or submitted a media
	// post that only answers over a websocket): ask Reddit what actually
	// happened before authorizing anything else.
	if armed := data.Armed; armed != nil {
		var hit *found

		// Legacy rows may have no username stored: the listing can never be
		// read, so fall straight through to the grace budget below.
		if integration != nil && deref(integration.Profile) != "" {
			hit, err = p.findSubmittedPost(ctx, accessToken, *integration.Profile, armed.Sr, armed.Title, armed.ArmedAt)
			if err != nil {
				if temporalx.FailureType(err) == temporalx.TypeRefreshToken {
					return nil, err
				}
				// A failed lookup still consumes the grace budget below: a
				// permanently broken listing must never wedge the post into
				// pending until the whole check budget burns down.
				hit = nil
			}
		}

		switch {
		case hit != nil:
			data.Results = append(data.Results, PendingResult{PostID: hit.id, ReleaseURL: hit.url})
			data.Cursor++
			data.Armed = nil
		case armed.Submitted:
			// Reddit accepted this submit; media posts are created
			// asynchronously and can lag in the listing for minutes. Keep
			// looking for the real id (comments and webhooks need it), then
			// accept without one rather than ever re-submitting.
			if armed.Lookups < 9 {
				armed.Lookups++
				return pending("pending", data)
			}
			data.Results = append(data.Results, PendingResult{ReleaseURL: "https://www.reddit.com/r/" + armed.Sr})
			data.Cursor++
			data.Armed = nil
		case armed.Media && (nowMs()-armed.ArmedAt < 10*60*1000 || armed.Lookups < 9):
			// A media finalize that timed out may STILL be running on a worker
			// for up to its 10-minute startToCloseTimeout, and its accepted
			// submit can appear in the listing minutes later - never authorize
			// a resubmit inside that window. The lookups floor guarantees
			// several minutes of listing checks AFTER the failure regardless
			// of how long the dead activity ran.
			armed.Lookups++
			return pending("pending", data)
		case !armed.Media && armed.Lookups < 1:
			// Self/link posts appear in the listing instantly: one grace miss
			// covers listing lag.
			armed.Lookups++
			return pending("pending", data)
		default:
			// Armed but no accepted response was ever seen and the in-flight
			// window has passed: conclude the submit never landed and let
			// finalizePost run it again.
			data.Armed = nil
		}
	}

	if data.Cursor >= len(data.Subreddits) {
		return completedResponse(data.Results), nil
	}

	// Arm the next subreddit BEFORE finalizePost submits it: the workflow
	// commits this state first, so if finalize dies mid-submit the next check
	// finds the armed marker and asks Reddit instead of resubmitting blindly.
	value := data.Subreddits[data.Cursor].Value
	if value == nil {
		return nil, errors.New("reddit: subreddit entry has no value")
	}
	data.Armed = &Armed{
		Sr:      normalizeSr(deref(value.Subreddit)),
		Title:   deref(value.Title),
		ArmedAt: nowMs(),
		Media:   deref(value.Type) == "media",
	}
	return pending("ready", data)
}

func (p *Provider) FinalizePost(ctx context.Context, accessToken string, pendingData json.RawMessage, _ *ent.Integration) (*integrations.PendingCheckResponse, error) {
	data, err := decodePending(pendingData)
	if err != nil {
		return nil, err
	}
	if data.Cursor >= len(data.Subreddits) || data.Armed == nil || data.Subreddits[data.Cursor].Value == nil {
		// Nothing armed for this cursor: let the check re-derive the state.
		return pending("pending", data)
	}

	value := data.Subreddits[data.Cursor].Value
	valueType := deref(value.Type)
	isVideo := helpers.HasExtension(data.MediaPath, "mp4")
	kind := valueType
	if valueType == "media" {
		kind = "image"
		if isVideo {
			kind = "video"
		}
	}
	if !slices.Contains([]string{"link", "self", "image", "video", "videogif"}, kind) {
		kind = "self"
	}
	sr := normalizeSr(deref(value.Subreddit))

	postData := []string{"api_type", "json", "title", deref(value.Title), "kind", kind}
	if value.Flair != nil {
		postData = append(postData, "flair_id", deref(value.Flair.ID))
	}
	if valueType == "link" {
		postData = append(postData, "url", deref(value.URL))
	}
	if valueType == "media" {
		mediaURL, err := p.uploadFileToReddit(ctx, accessToken, data.MediaPath)
		if err != nil {
			return nil, err
		}
		postData = append(postData, "url", mediaURL)
		if isVideo {
			poster, err := p.uploadFileToReddit(ctx, accessToken, data.MediaThumbnail)
			if err != nil {
				return nil, err
			}
			postData = append(postData, "video_poster_url", poster)
		}
	}
	postData = append(postData, "text", data.Message, "sr", sr)

	res, err := p.Fetch(ctx, oauthURL+"/api/submit", integrations.Request{
		Method: http.MethodPost,
		Headers: map[string]string{
			"Authorization": "Bearer " + accessToken,
			"Content-Type":  "application/x-www-form-urlencoded",
		},
		Body: form(postData...),
	})
	if err != nil {
		return nil, err
	}
	var all struct {
		JSON *struct {
			Errors [][]any `json:"errors"`
			Data   *struct {
				ID  string `json:"id"`
				URL string `json:"url"`
			} `json:"data"`
		} `json:"json"`
	}
	if err := res.JSON(&all); err != nil {
		return nil, err
	}

	// Reddit rejects submissions with a 200 and an errors array: surface the
	// real reason instead of failing later with an unknown outcome.
	if all.JSON != nil && len(all.JSON.Errors) > 0 {
		// A rate limit is a refusal, nothing was submitted: disarm the marker
		// so the next check re-arms this subreddit and submits it again once
		// the window has passed, instead of failing the whole post.
		rateLimited := true
		reasons := make([]string, 0, len(all.JSON.Errors))
		for _, e := range all.JSON.Errors {
			if len(e) == 0 || e[0] != "RATELIMIT" {
				rateLimited = false
			}
			reason := ""
			if len(e) > 1 && truthy(e[1]) {
				reason = fmt.Sprint(e[1])
			} else if len(e) > 0 && truthy(e[0]) {
				reason = fmt.Sprint(e[0])
			}
			reasons = append(reasons, reason)
		}
		if rateLimited {
			data.Armed = nil
			return pending("pending", data)
		}
		return nil, temporalx.BadBody(identifier, res.Text(), "{}",
			fmt.Sprintf("Reddit rejected the post to r/%s: %s", sr, strings.Join(reasons, ", ")))
	}

	// Self/link posts answer with the created post directly.
	if all.JSON != nil && all.JSON.Data != nil && all.JSON.Data.ID != "" {
		releaseURL := all.JSON.Data.URL
		if releaseURL == "" {
			releaseURL = "https://www.reddit.com/r/" + sr
		}
		data.Results = append(data.Results, PendingResult{PostID: all.JSON.Data.ID, ReleaseURL: releaseURL})
		data.Cursor++
		data.Armed = nil
		if data.Cursor >= len(data.Subreddits) {
			return completedResponse(data.Results), nil
		}
		return pending("pending", data)
	}

	// Media posts only answer with a websocket url: mark the submit as
	// accepted, the next check recovers the post id from the submitted
	// listing - a held-open websocket has no place inside an activity.
	data.Armed.Submitted = true
	return pending("pending", data)
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

// Post is the old blocking behavior, kept for workflow versions before v1.0.6
// that don't know how to resolve a `pending` response - they submit every
// subreddit inside the activity like before.
func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	responses, err := p.PostPending(ctx, id, accessToken, posts, integration)
	if err != nil {
		return nil, err
	}
	response := responses[0]
	pendingData := response.PendingData
	started := time.Now()

	for {
		check, err := p.CheckPostStatus(ctx, accessToken, pendingData, integration)
		if err != nil {
			return nil, err
		}
		switch check.Status {
		case "ready":
			finalize, err := p.FinalizePost(ctx, accessToken, check.PendingData, integration)
			if err != nil {
				return nil, err
			}
			if finalize.Status == "completed" {
				return []integrations.PostResponse{{ID: response.ID, PostID: finalize.PostID, ReleaseURL: finalize.ReleaseURL, Status: "published"}}, nil
			}
			pendingData = finalize.PendingData
		case "completed":
			return []integrations.PostResponse{{ID: response.ID, PostID: check.PostID, ReleaseURL: check.ReleaseURL, Status: "published"}}, nil
		default:
			pendingData = check.PendingData
		}

		// Cap below the 10-minute activity timeout of the old workflows using
		// this method: some subreddits may already be live at this point, so
		// timing the activity out (which retries and re-submits) is far worse
		// than failing here.
		if time.Since(started) > 8*time.Minute {
			return nil, temporalx.BadBody(identifier, "{}", "{}", "Reddit took too long to answer, please check your account before posting again")
		}

		// Keeps the old 5-second spacing between subreddit submissions.
		if err := p.Sleep(ctx, submitDelay); err != nil {
			return nil, err
		}
	}
}

func (p *Provider) Comment(ctx context.Context, _, postID, _, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	commentPost := posts[0]

	// Reddit uses thing_id format like t3_xxx for posts
	thingID := postID
	if !strings.HasPrefix(postID, "t3_") {
		thingID = "t3_" + postID
	}

	res, err := p.Fetch(ctx, oauthURL+"/api/comment", integrations.Request{
		Method: http.MethodPost,
		Headers: map[string]string{
			"Authorization": "Bearer " + accessToken,
			"Content-Type":  "application/x-www-form-urlencoded",
		},
		Body: form("text", commentPost.Message, "thing_id", thingID, "api_type", "json"),
	})
	if err != nil {
		return nil, err
	}
	var out struct {
		JSON struct {
			Data struct {
				Things []struct {
					Data struct {
						ID        string `json:"id"`
						Permalink string `json:"permalink"`
					} `json:"data"`
				} `json:"things"`
			} `json:"data"`
		} `json:"json"`
	}
	if err := res.JSON(&out); err != nil {
		return nil, err
	}
	if len(out.JSON.Data.Things) == 0 {
		return nil, fmt.Errorf("reddit: comment response has no things: %s", res.Text())
	}
	thing := out.JSON.Data.Things[0].Data
	return []integrations.PostResponse{{
		PostID: thing.ID, ReleaseURL: "https://www.reddit.com" + thing.Permalink, ID: commentPost.ID, Status: "published",
	}}, nil
}

// Subreddit is one entry of the subreddits() answer.
type Subreddit struct {
	Title string `json:"title"`
	Name  string `json:"name"`
	ID    string `json:"id"`
}

func formHeaders(accessToken string) map[string]string {
	return map[string]string{
		"Authorization": "Bearer " + accessToken,
		"Content-Type":  "application/x-www-form-urlencoded",
	}
}

// escapeQuery percent-encodes what the WHATWG URL parser encodes in a query
// (fetch() received the word unencoded), keeping the rest literal.
func escapeQuery(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c <= 0x20 || c >= 0x7f || c == '"' || c == '\'' || c == '<' || c == '>' || c == '#' {
			fmt.Fprintf(&b, "%%%02X", c)
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}

var namedSubreddit = regexp.MustCompile(`(?:^|/)r/([A-Za-z0-9_]+)`)

// Subreddits is the "subreddits" @Tool: search subreddits by word.
func (p *Provider) Subreddits(ctx context.Context, accessToken string, data json.RawMessage) ([]Subreddit, error) {
	var input struct {
		Word any `json:"word"`
	}
	_ = json.Unmarshal(data, &input)
	text := ""
	if truthy(input.Word) {
		text = fmt.Sprint(input.Word)
	}

	// A pasted "r/name" or reddit.com/r/name URL: search by the name alone (the
	// full URL matches nothing) and put that exact subreddit first if it exists.
	word := "undefined"
	if input.Word != nil {
		word = fmt.Sprint(input.Word)
	}
	exact := []Subreddit{}
	if named := namedSubreddit.FindStringSubmatch(text); named != nil {
		word = named[1]
		var err error
		if exact, err = p.subredditByName(ctx, accessToken, named[1]); err != nil {
			return nil, err
		}
	}

	res, err := p.Fetch(ctx, oauthURL+"/subreddits/search?show=public&q="+escapeQuery(word)+"&sort=activity&show_users=false&limit=10", integrations.Request{
		Method: http.MethodGet, Headers: formHeaders(accessToken),
	})
	if err != nil {
		return nil, err
	}
	var search struct {
		Data struct {
			Children []struct {
				Data struct {
					SubredditType  string `json:"subreddit_type"`
					SubmissionType string `json:"submission_type"`
					Title          string `json:"title"`
					URL            string `json:"url"`
					ID             string `json:"id"`
				} `json:"data"`
			} `json:"children"`
		} `json:"data"`
	}
	if err := res.JSON(&search); err != nil {
		return nil, err
	}

	out := append([]Subreddit{}, exact...)
	for _, child := range search.Data.Children {
		d := child.Data
		if d.SubredditType != "public" || d.SubmissionType == "image" ||
			slices.ContainsFunc(exact, func(e Subreddit) bool { return e.ID == d.ID }) {
			continue
		}
		out = append(out, Subreddit{Title: d.Title, Name: d.URL, ID: d.ID})
	}
	return out, nil
}

func (p *Provider) subredditByName(ctx context.Context, accessToken, name string) ([]Subreddit, error) {
	res, err := p.Fetch(ctx, oauthURL+"/r/"+name+"/about", integrations.Request{
		Method: http.MethodGet, Headers: formHeaders(accessToken),
	})
	if err != nil {
		if t := temporalx.FailureType(err); t == temporalx.TypeRefreshToken || t == temporalx.TypeDisconnect {
			return nil, err
		}
		return []Subreddit{}, nil
	}
	var about struct {
		Kind string `json:"kind"`
		Data struct {
			SubredditType  string `json:"subreddit_type"`
			SubmissionType string `json:"submission_type"`
			Title          string `json:"title"`
			URL            string `json:"url"`
			ID             string `json:"id"`
		} `json:"data"`
	}
	if err := res.JSON(&about); err != nil {
		return []Subreddit{}, nil
	}
	if about.Kind != "t5" || about.Data.SubredditType != "public" || about.Data.SubmissionType == "image" {
		return []Subreddit{}, nil
	}
	return []Subreddit{{Title: about.Data.Title, Name: about.Data.URL, ID: about.Data.ID}}, nil
}

func getPermissions(submissionType string, allowImages bool) []string {
	permissions := []string{}
	if submissionType == "any" || submissionType == "self" {
		permissions = append(permissions, "self")
	}
	if submissionType == "any" || submissionType == "link" {
		permissions = append(permissions, "link")
	}
	if allowImages {
		permissions = append(permissions, "media")
	}
	return permissions
}

type Flair struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Restrictions struct {
	Subreddit       string   `json:"subreddit"`
	Allow           []string `json:"allow"`
	IsFlairRequired bool     `json:"is_flair_required"`
	Flairs          []Flair  `json:"flairs"`
}

// Restrictions is the "restrictions" @Tool: flairs and allowed post kinds.
func (p *Provider) Restrictions(ctx context.Context, accessToken string, data json.RawMessage) (*Restrictions, error) {
	var input struct {
		Subreddit string `json:"subreddit"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}

	res, err := p.Fetch(ctx, oauthURL+"/"+input.Subreddit+"/about", integrations.Request{
		Method: http.MethodGet, Headers: formHeaders(accessToken),
	})
	if err != nil {
		return nil, err
	}
	var about struct {
		Data struct {
			SubmissionType string `json:"submission_type"`
			AllowImages    bool   `json:"allow_images"`
		} `json:"data"`
	}
	if err := res.JSON(&about); err != nil {
		return nil, err
	}

	name := "undefined"
	if parts := strings.Split(input.Subreddit, "/r/"); len(parts) > 1 {
		name = parts[1]
	}
	res, err = p.Fetch(ctx, oauthURL+"/api/v1/"+name+"/post_requirements", integrations.Request{
		Method: http.MethodGet, Headers: formHeaders(accessToken),
	})
	if err != nil {
		return nil, err
	}
	var requirements struct {
		IsFlairRequired bool `json:"is_flair_required"`
	}
	if err := res.JSON(&requirements); err != nil {
		return nil, err
	}

	var newData []struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	}
	if res, err := p.Fetch(ctx, oauthURL+"/"+input.Subreddit+"/api/link_flair_v2", integrations.Request{
		Method: http.MethodGet, Headers: formHeaders(accessToken),
	}); err == nil {
		if json.Unmarshal(res.Body, &newData) != nil {
			newData = nil
		}
	}

	flairs := make([]Flair, 0, len(newData))
	for _, f := range newData {
		flairs = append(flairs, Flair{ID: f.ID, Name: f.Text})
	}
	return &Restrictions{
		Subreddit:       input.Subreddit,
		Allow:           getPermissions(about.Data.SubmissionType, about.Data.AllowImages),
		IsFlairRequired: requirements.IsFlairRequired && len(newData) > 0,
		Flairs:          flairs,
	}, nil
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"subreddits": func(ctx context.Context, token string, data json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return p.Subreddits(ctx, token, data)
		},
		"restrictions": func(ctx context.Context, token string, data json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return p.Restrictions(ctx, token, data)
		},
	}
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{
		{
			MethodName:  "subreddits",
			Description: "Get list of subreddits with information",
			DataSchema:  []integrations.ToolField{{Key: "word", Type: "string", Description: "Search subreddit by string"}},
		},
		{
			MethodName:  "restrictions",
			Description: "Get list of flairs and restrictions for a subreddit",
			DataSchema: []integrations.ToolField{{
				Key: "subreddit", Type: "string",
				Description: `Search flairs and restrictions by subreddit key should be "/r/[name]"`,
			}},
		},
	}
}
