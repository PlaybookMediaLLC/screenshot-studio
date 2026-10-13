package x

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/upload"
)

// pendingData travels through the workflow history between postPending,
// checkPostStatus and finalizePost - keep it small JSON (media ids and the
// tweet content).
type pendingData struct {
	Message  string          `json:"message"`
	Settings pendingSettings `json:"settings"`
	MediaIDs []string        `json:"mediaIds"`
	// Article cover selected in the settings, uploaded separately from the post
	// media (which is embedded in the article body).
	CoverMediaID string `json:"coverMediaId,omitempty"`
	// Pictures placed inside the article body, by their src.
	InlineMediaIDs map[string]string `json:"inlineMediaIds,omitempty"`
	// Media still transcoding on X's side, waiting for STATUS = succeeded.
	ProcessingIDs []string `json:"processingIds"`
	// Arm -> confirm -> publish handshake (same as the Facebook story flow):
	// finalizePost arms without mutating, checkPostStatus witnesses, and only a
	// witnessed attempt runs the create - so a create that dies with an unknown
	// outcome is detected instead of run again (X has no idempotency key).
	Attempting bool `json:"attempting,omitempty"`
	Confirmed  bool `json:"confirmed,omitempty"`
}

type pendingSettings struct {
	WhoCanReplyPost *string `json:"who_can_reply_post,omitempty"`
	Community       *string `json:"community,omitempty"`
	MadeWithAI      any     `json:"made_with_ai,omitempty"`
	PaidPartnership any     `json:"paid_partnership,omitempty"`
	PostType        *string `json:"post_type,omitempty"`
	ArticleTitle    *string `json:"article_title,omitempty"`
	ArticleStatus   *string `json:"article_status,omitempty"`
}

func marshal(v any) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}

// lookup is mime-types' lookup(path) ("" for unknown extensions).
func lookup(p string) string {
	if u, err := url.Parse(p); err == nil && u.Path != "" {
		p = u.Path
	}
	t := mime.TypeByExtension(strings.ToLower(path.Ext(p)))
	t, _, _ = strings.Cut(t, ";")
	return t
}

func failedToProcess(processing *processingInfo) error {
	message := "X failed to process the uploaded video"
	if processing.Error != nil && processing.Error.Message != "" {
		message += ": " + processing.Error.Message
	}
	return temporalx.BadBody(identifier, string(marshal(processing)), "{}", message)
}

type uploaded struct {
	mediaID    string
	processing bool
}

// uploadVideoInChunks: X's v2 chunked upload requires a Buffer per APPEND
// segment, so one ranged chunk is read at a time (mediaChunk) instead of
// buffering the whole video. 1MB is the chunk size proven against X's APPEND
// limits.
func (p *Provider) uploadVideoInChunks(ctx context.Context, c *client, mediaPath string) (uploaded, error) {
	totalBytes, err := p.MediaSize(ctx, mediaPath, identifier)
	if err != nil {
		return uploaded{}, err
	}
	mediaType := lookup(mediaPath)
	if mediaType == "" {
		mediaType = "video/mp4"
	}

	// These legs record their own heartbeat details - otherwise a stall here
	// reports only the generic "x: publish" stage marker set by the activity.
	temporalx.SetHeartbeatDetails(ctx, fmt.Sprintf("x: upload initialize (%d bytes)", totalBytes))
	var init mediaResponse
	if err := c.postJSON(ctx, v2("media/upload/initialize"), map[string]any{
		"media_type":     mediaType,
		"total_bytes":    totalBytes,
		"media_category": "tweet_video",
	}, &init); err != nil {
		return uploaded{}, err
	}
	mediaID := init.Data.ID

	totalChunkCount := (totalBytes + uploadChunkSize - 1) / uploadChunkSize
	for i := int64(0); i < totalChunkCount; i++ {
		start := i * uploadChunkSize
		end := min(start+uploadChunkSize, totalBytes) - 1
		temporalx.SetHeartbeatDetails(ctx, fmt.Sprintf("x: upload append %d/%d media=%s", i+1, totalChunkCount, mediaID))
		chunk, err := p.MediaChunk(ctx, mediaPath, start, end, identifier)
		if err != nil {
			return uploaded{}, err
		}
		if err := c.appendChunk(ctx, mediaID, int(i), chunk); err != nil {
			return uploaded{}, err
		}
	}

	temporalx.SetHeartbeatDetails(ctx, "x: upload finalize media="+mediaID)
	var finalize mediaResponse
	if err := c.postJSON(ctx, v2("media/upload/"+mediaID+"/finalize"), nil, &finalize); err != nil {
		return uploaded{}, err
	}
	processing := finalize.Data.ProcessingInfo

	// An explicit rejection right at finalize: the video will never process.
	if processing != nil && processing.State == "failed" {
		return uploaded{}, failedToProcess(processing)
	}

	// A missing processing_info means the media is ready to use; anything else
	// keeps transcoding asynchronously and must reach `succeeded` before the
	// media_id can be attached to a post.
	return uploaded{mediaID: mediaID, processing: processing != nil && processing.State != "succeeded"}, nil
}

// mediaProcessingStatus is a single STATUS read, no loops and no timers - the
// polling loop lives in the post workflow (checkPostStatus) or, for the legacy
// paths, in waitForMediaProcessing.
func (p *Provider) mediaProcessingStatus(ctx context.Context, c *client, mediaID string) (*processingInfo, error) {
	temporalx.SetHeartbeatDetails(ctx, "x: media status media="+mediaID)
	return c.mediaStatus(ctx, mediaID)
}

// waitForMediaProcessing is the blocking wait used by the paths that still
// resolve everything inside one activity (comments, and post() for
// pre-v1.0.6 workflows). X drives the pace via check_after_secs; the cap is on
// accumulated wait time, never polling forever.
func (p *Provider) waitForMediaProcessing(ctx context.Context, c *client, mediaID string) error {
	waited := time.Duration(0)
	const maxWait = 7 * time.Minute
	processing, err := p.mediaProcessingStatus(ctx, c, mediaID)
	if err != nil {
		return err
	}
	for processing != nil && processing.State != "succeeded" {
		if processing.State == "failed" || waited >= maxWait {
			return failedToProcess(processing)
		}
		wait := time.Duration(max(processing.CheckAfterSecs, 1)) * time.Second
		if err := p.Sleep(ctx, wait); err != nil {
			return err
		}
		waited += wait
		if processing, err = p.mediaProcessingStatus(ctx, c, mediaID); err != nil {
			return err
		}
	}
	return nil
}

// uploadWithRateLimitRetry: with ten X activities running concurrently a user
// publishing several posts at the same minute can 429 on the upload
// endpoints, and twitter-api-v2 errors never pass through fetch's backoff, so
// they are retried here. Nothing is published at upload time, so a retried
// upload can never duplicate a post.
func uploadWithRateLimitRetry[T any](ctx context.Context, p *Provider, fn func() (T, error)) (T, error) {
	for retries := 0; ; retries++ {
		value, err := fn()
		var apiErr *apiResponseError
		if err == nil || retries > 2 || !errors.As(err, &apiErr) || !apiErr.rateLimitError() {
			return value, err
		}
		if err := p.Sleep(ctx, 5*time.Second*time.Duration(retries+1)); err != nil {
			return value, err
		}
	}
}

// uploadImage: articles reject GIF media, so the tweet pipeline (which
// converts every image to GIF) can't be reused for them - article images are
// uploaded as JPEG with the tweet_image category the article references them by.
func (p *Provider) uploadImage(ctx context.Context, c *client, mediaPath string, asArticleImage bool) (string, error) {
	data, err := p.ReadOrFetch(ctx, mediaPath)
	if err != nil {
		return "", err
	}
	if asArticleImage {
		jpeg, err := toJPEG(data)
		if err != nil {
			return "", err
		}
		return c.uploadMedia(ctx, jpeg, "image/jpeg", "tweet_image")
	}
	gif, err := toGIF(data, lookup(mediaPath) == "image/gif")
	if err != nil {
		return "", err
	}
	return c.uploadMedia(ctx, gif, "image/gif", "")
}

type mediaEntry struct {
	id    string
	paths []string
}

func entryOf(post integrations.PostDetails) mediaEntry {
	e := mediaEntry{id: post.ID}
	for _, m := range post.Media {
		e.paths = append(e.paths, m.Path)
	}
	return e
}

// uploadMediaEntries uploads sequentially on purpose: uploading everything at
// once holds every file in memory at the same time.
func (p *Provider) uploadMediaEntries(ctx context.Context, c *client, entries []mediaEntry, asArticleImage bool) (map[string][]string, []string, error) {
	mediaSigner, err := upload.NewPrivateMediaSigner()
	if err != nil {
		return nil, nil, err
	}
	media := map[string][]string{}
	processingIDs := []string{}
	for _, e := range entries {
		for _, mediaPath := range e.paths {
			mediaPath, err = mediaSigner.SignURL(ctx, mediaPath)
			if err != nil {
				return nil, nil, err
			}
			temporalx.SetHeartbeatDetails(ctx, "x: upload media "+temporalx.StripQuery(mediaPath))
			up, err := integrations.RunInConcurrent(p.Base, func() (uploaded, error) {
				if helpers.HasExtension(mediaPath, "mp4") {
					return uploadWithRateLimitRetry(ctx, p, func() (uploaded, error) {
						return p.uploadVideoInChunks(ctx, c, mediaPath)
					})
				}
				id, err := uploadWithRateLimitRetry(ctx, p, func() (string, error) {
					return p.uploadImage(ctx, c, mediaPath, asArticleImage)
				})
				return uploaded{mediaID: id}, err
			})
			if err != nil {
				return nil, nil, err
			}
			if up.mediaID == "" {
				continue
			}
			media[e.id] = append(media[e.id], up.mediaID)
			if up.processing {
				processingIDs = append(processingIDs, up.mediaID)
			}
		}
	}
	return media, processingIDs, nil
}

// uploadMedia is the legacy blocking upload (comments, and pre-v1.0.6
// workflows through post()): waits for the processing inside the activity.
func (p *Provider) uploadMedia(ctx context.Context, c *client, entries []mediaEntry) (map[string][]string, error) {
	media, processingIDs, err := p.uploadMediaEntries(ctx, c, entries, false)
	if err != nil {
		return nil, err
	}
	for _, id := range processingIDs {
		if err := p.waitForMediaProcessing(ctx, c, id); err != nil {
			return nil, err
		}
	}
	return media, nil
}

func nonEmpty(ids []string) []string {
	out := []string{}
	for _, id := range ids {
		if id != "" {
			out = append(out, id)
		}
	}
	return out
}

func (p *Provider) PostPending(ctx context.Context, _, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	c := newClient(accessToken)
	first := posts[0]
	settings := decodeSettings(first.Settings)
	isArticle := str(settings.PostType) == "article"

	// Upload the media now; the transcoding wait moves to checkPostStatus and
	// the tweet itself is only created by finalizePost, so nothing here is
	// irreversible - a failure leaves only orphaned media.
	media, processingIDs, err := p.uploadMediaEntries(ctx, c, []mediaEntry{entryOf(first)}, isArticle)
	if err != nil {
		return nil, err
	}

	// The article cover is picked in the settings, separate from the post
	// media (which is embedded in the article body).
	coverMediaID := ""
	if isArticle && settings.ArticleCover != nil && str(settings.ArticleCover.Path) != "" {
		cover, _, err := p.uploadMediaEntries(ctx, c, []mediaEntry{{id: "article-cover", paths: []string{*settings.ArticleCover.Path}}}, true)
		if err != nil {
			return nil, err
		}
		if ids := cover["article-cover"]; len(ids) > 0 {
			coverMediaID = ids[0]
		}
	}

	// Pictures placed in the article body are uploaded the same way and take
	// the place of their <img> in finalizeArticle.
	var inlineImages []string
	if isArticle {
		seen := map[string]bool{}
		for _, src := range articleImagesOf(parseFragment(first.Message)) {
			if !seen[src] {
				seen[src] = true
				inlineImages = append(inlineImages, src)
			}
		}
	}
	inlineEntries := make([]mediaEntry, len(inlineImages))
	for i, src := range inlineImages {
		inlineEntries[i] = mediaEntry{id: strconv.Itoa(i), paths: []string{src}}
	}
	inlineMedia, _, err := p.uploadMediaEntries(ctx, c, inlineEntries, true)
	if err != nil {
		return nil, err
	}

	// Articles keep the HTML (converted to Draft.js in finalizePost), tweets
	// are flattened to plain text.
	message := first.Message
	if !isArticle {
		message = toTweetText(first.Message)
	}
	pending := pendingData{
		Message: message,
		Settings: pendingSettings{
			WhoCanReplyPost: settings.WhoCanReplyPost,
			Community:       settings.Community,
			MadeWithAI:      settings.MadeWithAI,
			PaidPartnership: settings.PaidPartnership,
			PostType:        settings.PostType,
			ArticleTitle:    settings.ArticleTitle,
			ArticleStatus:   settings.ArticleStatus,
		},
		MediaIDs:      nonEmpty(media[first.ID]),
		CoverMediaID:  coverMediaID,
		ProcessingIDs: processingIDs,
	}
	if len(inlineImages) > 0 {
		pending.InlineMediaIDs = map[string]string{}
		for i, src := range inlineImages {
			if ids := inlineMedia[strconv.Itoa(i)]; len(ids) > 0 {
				pending.InlineMediaIDs[src] = ids[0]
			}
		}
	}
	return []integrations.PostResponse{{
		ID:          first.ID,
		Status:      "pending",
		PendingData: marshal(pending),
	}}, nil
}

func (p *Provider) CheckPostStatus(ctx context.Context, accessToken string, raw json.RawMessage, _ *ent.Integration) (*integrations.PendingCheckResponse, error) {
	var pending pendingData
	if err := json.Unmarshal(raw, &pending); err != nil {
		return nil, err
	}
	// A confirmed create attempt died without reporting its result: X gives no
	// cheap way to ask whether that tweet was created, so never run the create
	// again - stop with an explicit warning instead.
	if pending.Attempting && pending.Confirmed {
		return nil, temporalx.BadBody(identifier, "{}", "{}", "X may have already published this post, please check your account before posting again to avoid duplicates")
	}

	c := newClient(accessToken)

	// Check every media still transcoding; keep the ones not succeeded yet.
	stillProcessing := []string{}
	for _, mediaID := range pending.ProcessingIDs {
		processing, err := p.mediaProcessingStatus(ctx, c, mediaID)
		if err != nil {
			// twitter-api-v2 errors never pass through fetch/handleErrors:
			// classify here so revoked tokens and suspended accounts fail
			// properly instead of burning the whole check budget as "transient".
			var apiErr *apiResponseError
			body := "{}"
			if errors.As(err, &apiErr) && apiErr.Data != nil {
				body = string(marshal(apiErr.Data))
			}
			handled := handleErrors(body, 0)
			if (apiErr != nil && apiErr.Code == 401) || (handled != nil && handled.Type == "refresh-token") {
				return nil, temporalx.RefreshToken(identifier, body, "{}", "")
			}
			if handled != nil && handled.Type == "bad-body" {
				return nil, temporalx.BadBody(identifier, body, "{}", handled.Value)
			}
			// Transient status-check error: the media may finish transcoding
			// just fine, keep polling - if X stays broken the workflow exhausts
			// its checks and warns the user properly.
			return &integrations.PendingCheckResponse{Status: "pending", PendingData: raw}, nil
		}
		if processing != nil && processing.State == "failed" {
			return nil, failedToProcess(processing)
		}
		// A missing processing_info means the media is ready to use.
		if processing != nil && processing.State != "succeeded" {
			stillProcessing = append(stillProcessing, mediaID)
		}
	}

	if len(stillProcessing) > 0 {
		pending.ProcessingIDs = stillProcessing
		return &integrations.PendingCheckResponse{Status: "pending", PendingData: marshal(pending)}, nil
	}

	// witness the armed create so finalizePost knows the attempt is uniquely
	// accounted for before it mutates anything
	pending.ProcessingIDs = []string{}
	if pending.Attempting && !pending.Confirmed {
		pending.Confirmed = true
	}
	return &integrations.PendingCheckResponse{Status: "ready", PendingData: marshal(pending)}, nil
}

func (p *Provider) FinalizePost(ctx context.Context, accessToken string, raw json.RawMessage, integration *ent.Integration) (*integrations.PendingCheckResponse, error) {
	var pending pendingData
	if err := json.Unmarshal(raw, &pending); err != nil {
		return nil, err
	}
	// Create with an arm -> confirm -> publish handshake: the create only runs
	// after checkPostStatus witnessed the intent, so a run that dies mid-create
	// is detectable and the tweet is never published twice. The same
	// protection covers articles - creating a draft isn't idempotent either.
	if !pending.Attempting || !pending.Confirmed {
		pending.Attempting, pending.Confirmed = true, false
		return &integrations.PendingCheckResponse{Status: "pending", PendingData: marshal(pending)}, nil
	}

	if str(pending.Settings.PostType) == "article" {
		return p.finalizeArticle(ctx, accessToken, pending, integration)
	}

	token, secret := splitToken(accessToken)
	settings := pending.Settings
	mediaIDs := nonEmpty(pending.MediaIDs)

	text := pending.Message
	if p.StripLinks() {
		text = helpers.StripLinks(text)
	}
	body := tweetBody{
		Text:            text,
		MadeWithAI:      integrations.AssetBoolean(settings.MadeWithAI),
		PaidPartnership: integrations.AssetBoolean(settings.PaidPartnership),
	}
	if who := str(settings.WhoCanReplyPost); who != "" && who != "everyone" {
		body.ReplySettings = who
	}
	if community := str(settings.Community); community != "" {
		share := true
		parts := strings.Split(community, "/")
		body.ShareWithFollowers = &share
		body.CommunityID = &parts[len(parts)-1]
	}
	if len(mediaIDs) > 0 {
		body.Media = &tweetMedia{MediaIDs: mediaIDs}
	}
	id, err := p.createTweet(ctx, token, secret, body)
	if err != nil {
		return nil, err
	}
	return &integrations.PendingCheckResponse{
		Status:     "completed",
		PostID:     id,
		ReleaseURL: "https://twitter.com/" + jsString(integration.Profile) + "/status/" + id,
	}, nil
}

type tweetMedia struct {
	MediaIDs []string `json:"media_ids"`
}

type tweetBody struct {
	ReplySettings      string      `json:"reply_settings,omitempty"`
	ShareWithFollowers *bool       `json:"share_with_followers,omitempty"`
	CommunityID        *string     `json:"community_id,omitempty"`
	Text               string      `json:"text"`
	Media              *tweetMedia `json:"media,omitempty"`
	Reply              *struct {
		InReplyToTweetID string `json:"in_reply_to_tweet_id"`
	} `json:"reply,omitempty"`
	MadeWithAI      bool `json:"made_with_ai"`
	PaidPartnership bool `json:"paid_partnership"`
}

// createTweet is the signed raw POST https://api.x.com/2/tweets through fetch.
func (p *Provider) createTweet(ctx context.Context, token, secret string, body tweetBody) (string, error) {
	tweetURL := v2("tweets")
	res, err := p.Fetch(ctx, tweetURL, integrations.Request{
		Method: "POST",
		Headers: map[string]string{
			"Authorization": signOAuth1("POST", tweetURL, token, secret),
			"Content-Type":  "application/json",
		},
		Body: marshal(body),
	})
	if err != nil {
		return "", err
	}
	var data struct {
		Data *struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := res.JSON(&data); err != nil {
		return "", err
	}
	if data.Data == nil {
		return "", errors.New("Cannot read properties of undefined (reading 'id')")
	}
	return data.Data.ID, nil
}

func (p *Provider) finalizeArticle(ctx context.Context, accessToken string, pending pendingData, integration *ent.Integration) (*integrations.PendingCheckResponse, error) {
	token, secret := splitToken(accessToken)
	settings := pending.Settings
	// All the post media is embedded in the article body; the cover comes from
	// its own settings field.
	embeddedMediaIDs := nonEmpty(pending.MediaIDs)

	draft := articleDraft{
		Title:        settings.ArticleTitle,
		ContentState: articleContentState(pending.Message, embeddedMediaIDs, pending.InlineMediaIDs),
	}
	if pending.CoverMediaID != "" {
		// Lowercase, matching the category the upload stored.
		draft.CoverMedia = &mediaItem{MediaCategory: "tweet_image", MediaID: pending.CoverMediaID}
	}
	draftURL := apiBase + "/2/articles/draft"
	draftResponse, err := p.Fetch(ctx, draftURL, integrations.Request{
		Method: "POST",
		Headers: map[string]string{
			"Authorization": signOAuth1("POST", draftURL, token, secret),
			"Content-Type":  "application/json",
		},
		Body: marshal(draft),
	})
	if err != nil {
		return nil, err
	}
	var draftJSON struct {
		Data *struct {
			ID string `json:"id"`
		} `json:"data,omitempty"`
		Errors []any `json:"errors,omitempty"`
	}
	if err := draftResponse.JSON(&draftJSON); err != nil {
		return nil, err
	}
	// The articles endpoints can return 2xx with an errors array (e.g. a
	// rejected cover) - don't swallow it.
	if len(draftJSON.Errors) > 0 {
		log.Println("X article draft returned errors:", string(marshal(draftJSON.Errors)))
	}
	if draftJSON.Data == nil || draftJSON.Data.ID == "" {
		return nil, temporalx.BadBody(identifier, draftResponse.Text(), "{}", "X could not create the article draft")
	}

	if str(settings.ArticleStatus) != "published" {
		return &integrations.PendingCheckResponse{Status: "completed", PostID: draftJSON.Data.ID, ReleaseURL: "https://x.com/i/articles"}, nil
	}

	publishURL := apiBase + "/2/articles/" + draftJSON.Data.ID + "/publish"
	publishResponse, err := p.Fetch(ctx, publishURL, integrations.Request{
		Method: "POST",
		Headers: map[string]string{
			"Authorization": signOAuth1("POST", publishURL, token, secret),
			"Content-Type":  "application/json",
		},
	})
	if err != nil {
		return nil, err
	}
	var publishJSON struct {
		Data *struct {
			PostID string `json:"post_id"`
		} `json:"data,omitempty"`
		Errors []any `json:"errors,omitempty"`
	}
	if err := publishResponse.JSON(&publishJSON); err != nil {
		return nil, err
	}
	if len(publishJSON.Errors) > 0 {
		log.Println("X article publish returned errors:", string(marshal(publishJSON.Errors)))
	}
	if publishJSON.Data == nil || publishJSON.Data.PostID == "" {
		return nil, temporalx.BadBody(identifier, publishResponse.Text(), "{}", "X created the article draft but could not publish it, check your drafts on X")
	}
	return &integrations.PendingCheckResponse{
		Status:     "completed",
		PostID:     publishJSON.Data.PostID,
		ReleaseURL: "https://twitter.com/" + jsString(integration.Profile) + "/status/" + publishJSON.Data.PostID,
	}, nil
}

// Post is the old blocking behavior, kept for workflow versions before v1.0.6
// that still run and don't know how to resolve a `pending` response - they
// wait for the transcoding and create the tweet inside the activity.
func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	responses, err := p.PostPending(ctx, id, accessToken, posts, integration)
	if err != nil {
		return nil, err
	}
	response := responses[0]
	pending := response.PendingData
	started := time.Now()
	for {
		// Cap below the 10-minute activity timeout of the old workflows using
		// this method: failing here is safe (the tweet is only created once the
		// media is ready), timing the activity out is not - a retried activity
		// would upload and publish again.
		if time.Since(started) > 8*time.Minute {
			return nil, temporalx.BadBody(identifier, "{}", "{}", "X took too long to process the media, please try again")
		}
		check, err := p.CheckPostStatus(ctx, accessToken, pending, integration)
		if err != nil {
			return nil, err
		}
		if check.Status == "pending" {
			pending = check.PendingData
			if err := p.Sleep(ctx, 20*time.Second); err != nil {
				return nil, err
			}
			continue
		}
		result := check
		if check.Status == "ready" {
			if result, err = p.FinalizePost(ctx, accessToken, check.PendingData, integration); err != nil {
				return nil, err
			}
		}
		if result.Status == "completed" {
			return []integrations.PostResponse{{PostID: result.PostID, ID: response.ID, ReleaseURL: result.ReleaseURL, Status: "posted"}}, nil
		}
		// finalize only armed the handshake (nothing to wait for), loop
		// straight into the witnessing check
		pending = result.PendingData
	}
}

func (p *Provider) Comment(ctx context.Context, _, postID, lastCommentID, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	token, secret := splitToken(accessToken)
	c := newClient(accessToken)
	commentPost := posts[0]

	// upload media for the comment
	uploadAll, err := p.uploadMedia(ctx, c, []mediaEntry{entryOf(commentPost)})
	if err != nil {
		return nil, err
	}
	mediaIDs := nonEmpty(uploadAll[commentPost.ID])

	replyToID := lastCommentID
	if replyToID == "" {
		replyToID = postID
	}

	// Comments are always tweets - flatten the editor HTML to plain text.
	commentText := toTweetText(commentPost.Message)
	if p.StripLinks() {
		commentText = helpers.StripLinks(commentText)
	}
	settings := decodeSettings(commentPost.Settings)
	body := tweetBody{
		Text:            commentText,
		MadeWithAI:      integrations.AssetBoolean(settings.MadeWithAI),
		PaidPartnership: integrations.AssetBoolean(settings.PaidPartnership),
	}
	if len(mediaIDs) > 0 {
		body.Media = &tweetMedia{MediaIDs: mediaIDs}
	}
	body.Reply = &struct {
		InReplyToTweetID string `json:"in_reply_to_tweet_id"`
	}{replyToID}
	id, err := p.createTweet(ctx, token, secret, body)
	if err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{
		PostID:     id,
		ID:         commentPost.ID,
		ReleaseURL: "https://twitter.com/" + jsString(integration.Profile) + "/status/" + id,
		Status:     "posted",
	}}, nil
}
