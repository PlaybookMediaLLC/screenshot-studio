package x

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/upload"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// pendingData travels through the workflow history between postPending,
// checkPostStatus and finalizePost - keep it small JSON (media ids and the
// tweet content).
type pendingData struct {
	Message    string          `json:"message"`
	Settings   pendingSettings `json:"settings"`
	MediaIDs   []string        `json:"mediaIds"`
	MediaFacts []mediaFacts    `json:"mediaFacts,omitempty"`
	// Article cover selected in the settings, uploaded separately from the post
	// media (which is embedded in the article body).
	CoverMediaID string `json:"coverMediaId,omitempty"`
	// Pictures placed inside the article body, by their src.
	InlineMediaIDs map[string]string `json:"inlineMediaIds,omitempty"`
	// Media still transcoding on X's side, waiting for STATUS = succeeded.
	ProcessingIDs []string `json:"processingIds"`
	// A poll on the tweet, carried until it is created.
	Poll *integrations.PollDetails `json:"poll,omitempty"`
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
	// Write (RFC 042). Pending data from before these fields has neither.
	ShareWithFollowers *bool   `json:"share_with_followers,omitempty"`
	QuoteTweetID       *string `json:"quote_tweet_id,omitempty"`
}

func marshal(v any) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
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

// uploadStaged sends the exact inspected snapshot in bounded chunks. The
// complete selection has been validated before the first INIT request.
func (p *Provider) uploadStaged(ctx context.Context, c *client, item stagedMedia) (uploaded, error) {
	category := "tweet_image"
	if item.facts.MIME == "image/gif" {
		category = "tweet_gif"
	}
	if item.facts.MIME == "video/mp4" {
		category = "tweet_video"
	}
	var init mediaResponse
	temporalx.SetHeartbeatDetails(ctx, "x: initialize validated media")
	if err := c.postJSON(ctx, v2("media/upload/initialize"), map[string]any{"media_type": item.facts.MIME, "total_bytes": item.facts.Bytes, "media_category": category}, &init); err != nil {
		return uploaded{}, err
	}
	id := init.Data.ID
	if !socialidentity.XAccountID(id) {
		return uploaded{}, publishRejected("X did not return a valid media upload ID. No post was sent.")
	}
	for at, index := int64(0), 0; at < item.facts.Bytes; at, index = at+uploadChunkSize, index+1 {
		if err := ctx.Err(); err != nil {
			return uploaded{}, err
		}
		chunk := make([]byte, min(int64(uploadChunkSize), item.facts.Bytes-at))
		n, err := item.file.ReadAt(chunk, at)
		if err != nil || n != len(chunk) {
			return uploaded{}, publishRejected("The validated X media snapshot could not be read completely.")
		}
		temporalx.SetHeartbeatDetails(ctx, fmt.Sprintf("x: upload chunk %d", index+1))
		if err := c.appendChunk(ctx, id, index, chunk); err != nil {
			return uploaded{}, err
		}
	}
	var finalize mediaResponse
	if err := c.postJSON(ctx, v2("media/upload/"+id+"/finalize"), nil, &finalize); err != nil {
		return uploaded{}, err
	}
	if finalize.Data.ID != id {
		return uploaded{}, publishRejected("X returned a different media upload ID. No post was sent.")
	}
	processing := finalize.Data.ProcessingInfo
	if processing != nil && processing.State == "failed" {
		return uploaded{}, failedToProcess(processing)
	}
	return uploaded{mediaID: id, processing: processing != nil && processing.State != "succeeded"}, nil
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

type mediaEntry struct {
	id    string
	paths []string
	// alts are the paths' descriptions, by index; empty for none.
	alts []string
}

func entryOf(post integrations.PostDetails) mediaEntry {
	e := mediaEntry{id: post.ID}
	for _, m := range post.Media {
		e.paths = append(e.paths, m.Path)
		e.alts = append(e.alts, m.Alt)
	}
	return e
}

type mediaUpload struct {
	ids           map[string][]string
	processingIDs []string
	facts         []mediaFacts
}

func (p *Provider) uploadMediaEntries(ctx context.Context, c *client, entries []mediaEntry, article bool, caps socialidentity.XCapabilities) (mediaUpload, error) {
	result := mediaUpload{ids: map[string][]string{}}
	signer, err := upload.NewPrivateMediaSigner()
	if err != nil {
		return result, err
	}
	var staged []stagedMedia
	defer func() {
		for _, item := range staged {
			item.close()
		}
	}()
	for _, entry := range entries {
		for i, source := range entry.paths {
			signed, err := signer.SignURL(ctx, source)
			if err != nil {
				return result, err
			}
			item, err := stageMedia(ctx, signed, caps, article)
			if err != nil {
				return result, err
			}
			item.entryID = entry.id
			if i < len(entry.alts) {
				item.alt = entry.alts[i]
			}
			staged = append(staged, item)
			result.facts = append(result.facts, item.facts)
		}
	}
	if err := checkMediaFacts(caps, result.facts, article); err != nil {
		return result, err
	}
	for _, item := range staged {
		up, err := integrations.RunInConcurrent(p.Base, func() (uploaded, error) {
			return uploadWithRateLimitRetry(ctx, p, func() (uploaded, error) { return p.uploadStaged(ctx, c, item) })
		})
		if err != nil {
			return result, err
		}
		if up.mediaID == "" {
			return result, publishRejected("X did not return the selected media. No post was sent.")
		}
		if strings.TrimSpace(item.alt) != "" {
			if err := c.setAltText(ctx, up.mediaID, item.alt); err != nil {
				return result, err
			}
		}
		result.ids[item.entryID] = append(result.ids[item.entryID], up.mediaID)
		if up.processing {
			result.processingIDs = append(result.processingIDs, up.mediaID)
		}
	}
	return result, nil
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

func (p *Provider) PostPending(ctx context.Context, _, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	if len(posts) == 0 {
		return nil, publishRejected("Add an X post before publishing.")
	}
	caps, err := publishingLimits(ctx, accessToken, integration)
	if err != nil {
		return nil, err
	}
	// Validate the whole thread before uploading or creating the root post.
	for i, post := range posts {
		settings := decodeSettings(post.Settings)
		article := i == 0 && str(settings.PostType) == "article"
		message := post.Message
		if !article {
			message = toTweetText(message)
		}
		if err := checkPublishingContent(caps, message, pendingSettings{QuoteTweetID: settings.QuoteTweetID,
			ArticleTitle: settings.ArticleTitle, ArticleStatus: settings.ArticleStatus}, len(post.Media), article); err != nil {
			return nil, err
		}
	}
	c := newClient(accessToken)
	first := posts[0]
	settings := decodeSettings(first.Settings)
	isArticle := str(settings.PostType) == "article"

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
	rootMedia := entryOf(first)
	rootMedia.id = "post-media" // Internal keys must not collide with caller-supplied post IDs.
	entries := []mediaEntry{rootMedia}
	if isArticle && settings.ArticleCover != nil && str(settings.ArticleCover.Path) != "" {
		entries = append(entries, mediaEntry{id: "article-cover", paths: []string{*settings.ArticleCover.Path}, alts: []string{str(settings.ArticleCover.Alt)}})
	}
	for i, src := range inlineImages {
		entries = append(entries, mediaEntry{id: "inline-" + strconv.Itoa(i), paths: []string{src}})
	}
	uploaded, err := p.uploadMediaEntries(ctx, c, entries, isArticle, caps)
	if err != nil {
		return nil, err
	}
	coverMediaID := ""
	if ids := uploaded.ids["article-cover"]; len(ids) > 0 {
		coverMediaID = ids[0]
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
			WhoCanReplyPost:    settings.WhoCanReplyPost,
			Community:          settings.Community,
			MadeWithAI:         settings.MadeWithAI,
			PaidPartnership:    settings.PaidPartnership,
			PostType:           settings.PostType,
			ArticleTitle:       settings.ArticleTitle,
			ArticleStatus:      settings.ArticleStatus,
			ShareWithFollowers: settings.ShareWithFollowers,
			QuoteTweetID:       settings.QuoteTweetID,
		},
		MediaIDs:      uploaded.ids["post-media"],
		MediaFacts:    uploaded.facts,
		CoverMediaID:  coverMediaID,
		ProcessingIDs: uploaded.processingIDs,
		Poll:          first.Poll,
	}
	if len(inlineImages) > 0 {
		pending.InlineMediaIDs = map[string]string{}
		for i, src := range inlineImages {
			if ids := uploaded.ids["inline-"+strconv.Itoa(i)]; len(ids) > 0 {
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
	caps, err := publishingLimits(ctx, accessToken, integration)
	if err != nil {
		return nil, err
	}
	if err := checkPublishingContent(caps, pending.Message, pending.Settings, len(pending.MediaIDs), str(pending.Settings.PostType) == "article"); err != nil {
		return nil, err
	}

	expected := len(pending.MediaIDs) + len(pending.InlineMediaIDs)
	if pending.CoverMediaID != "" {
		expected++
	}
	if expected != len(pending.MediaFacts) {
		return nil, publishRejected("Prepare this X post again to verify the selected media before publishing.")
	}
	allIDs := append([]string(nil), pending.MediaIDs...)
	for _, id := range pending.InlineMediaIDs {
		allIDs = append(allIDs, id)
	}
	if pending.CoverMediaID != "" {
		allIDs = append(allIDs, pending.CoverMediaID)
	}
	for _, id := range allIDs {
		if !socialidentity.XAccountID(id) {
			return nil, publishRejected("An X media attachment is missing or invalid. Prepare the post again.")
		}
	}
	if err := checkMediaFacts(caps, pending.MediaFacts, str(pending.Settings.PostType) == "article"); err != nil {
		return nil, err
	}

	if str(pending.Settings.PostType) == "article" {
		return p.finalizeArticle(ctx, accessToken, pending, integration)
	}

	token, secret := splitToken(accessToken)
	settings := pending.Settings
	mediaIDs := nonEmpty(pending.MediaIDs)

	body := tweetBody{
		Text:            pending.Message,
		MadeWithAI:      integrations.AssetBoolean(settings.MadeWithAI),
		PaidPartnership: integrations.AssetBoolean(settings.PaidPartnership),
	}
	if who := str(settings.WhoCanReplyPost); who != "" && who != "everyone" {
		body.ReplySettings = who
	}
	if community := str(settings.Community); community != "" {
		share := true
		if settings.ShareWithFollowers != nil {
			share = *settings.ShareWithFollowers
		}
		parts := strings.Split(community, "/")
		body.ShareWithFollowers = &share
		body.CommunityID = &parts[len(parts)-1]
	}
	body.QuoteTweetID = str(settings.QuoteTweetID)
	if len(mediaIDs) > 0 {
		body.Media = &tweetMedia{MediaIDs: mediaIDs}
	}
	if poll := pending.Poll; poll != nil && len(poll.Options) >= 2 {
		// X takes the duration in minutes, from 5 minutes to 7 days.
		minutes := poll.Duration * 60
		if poll.DurationMinutes > 0 {
			minutes = poll.DurationMinutes
		}
		body.Poll = &tweetPoll{Options: poll.Options, DurationMinutes: min(max(minutes, 5), 7*24*60)}
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
	QuoteTweetID    string     `json:"quote_tweet_id,omitempty"`
	MadeWithAI      bool       `json:"made_with_ai"`
	PaidPartnership bool       `json:"paid_partnership"`
	Poll            *tweetPoll `json:"poll,omitempty"`
}

// tweetPoll is a poll on a tweet: 2 to 4 choices and how long it is open.
type tweetPoll struct {
	Options         []string `json:"options"`
	DurationMinutes int      `json:"duration_minutes"`
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
	if data.Data == nil || data.Data.ID == "" {
		return "", publishRejected("X did not return a post ID. Check the account before trying again to avoid duplicates.")
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
	if len(posts) == 0 {
		return nil, publishRejected("Add an X reply before publishing.")
	}
	caps, err := publishingLimits(ctx, accessToken, integration)
	if err != nil {
		return nil, err
	}
	token, secret := splitToken(accessToken)
	c := newClient(accessToken)
	commentPost := posts[0]
	settings := decodeSettings(commentPost.Settings)
	commentText := toTweetText(commentPost.Message)
	check := func() error {
		return checkPublishingContent(caps, commentText, pendingSettings{QuoteTweetID: settings.QuoteTweetID}, len(commentPost.Media), false)
	}
	if err := check(); err != nil {
		return nil, err
	}

	// upload media for the comment
	uploadAll, err := p.uploadMediaEntries(ctx, c, []mediaEntry{entryOf(commentPost)}, false, caps)
	if err != nil {
		return nil, err
	}
	for _, id := range uploadAll.processingIDs {
		if err := p.waitForMediaProcessing(ctx, c, id); err != nil {
			return nil, err
		}
	}
	mediaIDs := uploadAll.ids[commentPost.ID]
	if len(commentPost.Media) > 0 {
		// Media processing may take minutes, during which the grant or account
		// subscription can change. Recheck before creating the reply.
		caps, err = publishingLimits(ctx, accessToken, integration)
		if err != nil {
			return nil, err
		}
		if err := check(); err != nil {
			return nil, err
		}
		if err := checkMediaFacts(caps, uploadAll.facts, false); err != nil {
			return nil, err
		}
	}

	replyToID := lastCommentID
	if replyToID == "" {
		replyToID = postID
	}

	body := tweetBody{
		Text:            commentText,
		MadeWithAI:      integrations.AssetBoolean(settings.MadeWithAI),
		PaidPartnership: integrations.AssetBoolean(settings.PaidPartnership),
		QuoteTweetID:    str(settings.QuoteTweetID),
	}
	if who := str(settings.WhoCanReplyPost); who != "" && who != "everyone" {
		body.ReplySettings = who
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
