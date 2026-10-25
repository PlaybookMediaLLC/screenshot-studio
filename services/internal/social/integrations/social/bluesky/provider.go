// Package bluesky is the Bluesky provider. The
// @atproto/api agent is replaced by direct XRPC calls (agent.go) and
// RichText.detectFacets by richtext.go.
package bluesky

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

const identifier = "bluesky"

var errAccountMismatch = temporalx.Disconnect(identifier, "{}", "{}", "Bluesky returned a different account; reconnect the original account")
var errAccountInactive = temporalx.Disconnect(identifier, "{}", "{}", "Bluesky account is inactive; restore access and reconnect the original account")

// videoServiceURL is Bluesky's video service, overridden by tests.
var videoServiceURL = "https://video.bsky.app"

// Waits, shortened by tests.
var (
	pollInterval      = 20 * time.Second
	pollTimeout       = 8 * time.Minute
	videoPollInterval = 30 * time.Second
	plugDelay         = 2 * time.Second
)

type Provider struct {
	*integrations.Base
	connectionClient *http.Client
}

var (
	_ integrations.Provider             = (*Provider)(nil)
	_ integrations.PendingPoster        = (*Provider)(nil)
	_ integrations.Commenter            = (*Provider)(nil)
	_ integrations.CustomFielder        = (*Provider)(nil)
	_ integrations.MentionFormatter     = (*Provider)(nil)
	_ integrations.IntegrationRefresher = (*Provider)(nil)
)

func New() *Provider { return newProvider(ssrf.PublicClient()) }

func newProvider(client *http.Client) *Provider {
	return &Provider{Base: integrations.NewBase(identifier, nil), connectionClient: client}
}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier: identifier,
		Name:       "Bluesky",
		Editor:     "normal",
		Scopes:     []string{"com.atproto.appPass"},
		ToolTip:    "Use a dedicated Bluesky app password. Keep your main account password private.",
		// Bluesky limits are per account and per IP
		MaxConcurrentJob: 6,
		Rules:            "Bluesky can have maximum 1 video or 4 pictures in one post, it can also be without attachments",
	}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 300 }

func (p *Provider) CheckValidity(_ context.Context, posts [][]integrations.ValidityMedia, _ json.RawMessage, _ []integrations.AdditionalSetting) (string, error) {
	for _, post := range posts {
		hasVideo := false
		for _, media := range post {
			if helpers.HasExtension(media.Path, "mp4") {
				hasVideo = true
			}
		}
		if hasVideo && len(post) > 1 {
			return "You can only upload one video per post.", nil
		}
	}
	for _, post := range posts {
		if len(post) > 4 {
			return "There can be maximum 4 pictures in a post.", nil
		}
	}
	return "", nil
}

func (p *Provider) CustomFields() []integrations.CustomField {
	return []integrations.CustomField{
		{Key: "identifier", Label: "Handle", Validation: `/^@?[a-zA-Z0-9.-]+\.[a-zA-Z][a-zA-Z0-9-]*$/`, Type: "text"},
		{Key: "password", Label: "App password", Validation: `/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/`, Type: "password"},
	}
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	// A token alone cannot establish the account's authorized PDS destination.
	return nil, errConnection
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(32)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(64), State: state}, nil
}

type credentials struct {
	Version    int    `json:"version,omitempty"`
	ServerDID  string `json:"serverDid,omitempty"`
	Service    string `json:"service"`
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	return p.authenticateAppPassword(ctx, params)
}

// loginAgent logs in with the credentials stored on the integration.
func (p *Provider) loginAgent(ctx context.Context, integration *ent.Integration) (*agent, error) {
	if integration == nil || integration.CustomInstanceDetails == nil {
		return nil, errors.New("missing custom instance details")
	}
	decrypted, err := helpers.FixedDecryption(*integration.CustomInstanceDetails)
	if err != nil {
		return nil, err
	}
	var body credentials
	if err := json.Unmarshal([]byte(decrypted), &body); err != nil {
		return nil, err
	}
	var a *agent
	if body.Version == 1 {
		if body.Identifier != integration.InternalID {
			return nil, errAccountMismatch
		}
		a, err = p.credentialAgent(body, "")
	} else if body.Version == 0 {
		// Existing encrypted records retain their legacy adapter behavior until
		// reconnect. New authentication never creates this unverified format.
		a, err = newAgent(body.Service)
	} else {
		return nil, errConnection
	}
	if err != nil {
		return nil, err
	}
	if err := a.login(ctx, body.Identifier, body.Password); err != nil {
		return nil, err
	}
	// Handles can change owners. A new login must still represent the immutable
	// DID saved when this integration connected, before any publishing call.
	if integration.InternalID == "" || a.session.Did != integration.InternalID {
		return nil, errAccountMismatch
	}
	return a, nil
}

func (p *Provider) getAgent(ctx context.Context, integration *ent.Integration) (*agent, error) {
	a, err := p.loginAgent(ctx, integration)
	var xrpcErr *XRPCError
	// Only a definite 4xx (bad password, account taken down) means the
	// credentials are broken. A 5xx or network error is Bluesky being
	// unavailable: let it propagate as a transient failure instead of marking
	// the channel as disconnected.
	if errors.As(err, &xrpcErr) && xrpcErr.Status >= 400 && xrpcErr.Status < 500 && xrpcErr.Status != 429 {
		data, _ := json.Marshal(xrpcErr)
		return nil, temporalx.RefreshToken(identifier, string(data), "{}", "")
	}
	if err != nil {
		return nil, err
	}
	limits, err := publishingLimits(integration)
	if err != nil {
		return nil, err
	}
	a.limits = limits
	return a, nil
}

// getVideoJobStatus is a single read of the processing job - the endpoint is
// public (no login), so status checks never spend Bluesky's strict
// createSession rate limits.
func (p *Provider) getVideoJobStatus(ctx context.Context, jobID string) (*jobStatus, error) {
	var out struct {
		JobStatus jobStatus `json:"jobStatus"`
	}
	if err := p.videoCall(ctx, "app.bsky.video.getJobStatus", "", url.Values{"jobId": {jobID}}, &out); err != nil {
		return nil, err
	}
	if out.JobStatus.JobID != jobID {
		return nil, contentFailure("Bluesky returned a different video processing job")
	}
	return &out.JobStatus, nil
}

func hasBlob(blob json.RawMessage) bool { return len(blob) > 0 && string(blob) != "null" }

type videoEmbed struct {
	Type  string          `json:"$type"`
	Video json.RawMessage `json:"video"`
	Alt   string          `json:"alt,omitempty"`
}

// uploadVideo is the blocking upload+wait, used by the paths that still
// resolve everything inside one activity (comments, and Post for pre-v1.0.6
// workflows).
func (p *Provider) uploadVideo(ctx context.Context, a *agent, videoPath string) (*videoEmbed, error) {
	job, err := p.startVideoUpload(ctx, a, videoPath)
	if err != nil {
		return nil, err
	}
	blob := job.Blob

	const maxAttempts = 18 // ~9 minutes at 30s interval
	for attempts := 0; !hasBlob(blob); attempts++ {
		if attempts >= maxAttempts {
			return nil, temporalx.BadBody(identifier, "{}", "{}", "Video upload timed out, job did not complete")
		}
		status, err := p.getVideoJobStatus(ctx, job.JobID)
		if err != nil {
			return nil, err
		}
		if hasBlob(status.Blob) {
			blob = status.Blob
		}
		if a.session == nil || status.Did != a.session.Did {
			return nil, contentFailure("Bluesky returned a video for another account")
		}
		if status.State == "JOB_STATE_FAILED" {
			return nil, temporalx.BadBody(identifier, "{}", "{}", "Could not upload video, job failed")
		}
		if err := p.Sleep(ctx, videoPollInterval); err != nil {
			return nil, err
		}
	}
	if err := checkBlob(blob, "video/mp4", a.limits.VideoMaxBytes, a.limits); err != nil {
		return nil, err
	}
	return &videoEmbed{Type: "app.bsky.embed.video", Video: blob}, nil
}

type aspectRatio struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type embedImage struct {
	Alt         string          `json:"alt"`
	Image       json.RawMessage `json:"image"`
	AspectRatio aspectRatio     `json:"aspectRatio"`
}

type imagesEmbed struct {
	Type   string       `json:"$type"`
	Images []embedImage `json:"images"`
}

func nowISO() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

type replyRefs struct {
	Root   refOrUndefined `json:"root"`
	Parent refOrUndefined `json:"parent"`
}

// refOrUndefined is a strong ref whose fields may be undefined.
type refOrUndefined struct {
	URI string `json:"uri,omitempty"`
	CID string `json:"cid,omitempty"`
}

// createPost is agent.post({ text, facets, createdAt, embed?, reply? }).
func createPost(ctx context.Context, a *agent, text string, facets []Facet, embed any, reply *replyRefs) (*createdRecord, error) {
	if err := socialidentity.CheckBlueskyText(text); err != nil {
		return nil, contentFailure(err.Error())
	}
	record := map[string]any{"text": text, "createdAt": nowISO()}
	if facets != nil {
		record["facets"] = facets
	}
	if embed != nil {
		record["embed"] = embed
	}
	if reply != nil {
		record["reply"] = reply
	}
	return a.createRecord(ctx, "app.bsky.feed.post", record)
}

func rkey(uri string) string {
	parts := strings.Split(uri, "/")
	return parts[len(parts)-1]
}

// PendingData travels through the workflow history between PostPending,
// CheckPostStatus and FinalizePost - keep it small JSON: the video job id and
// the post content, never a blob ref.
type PendingData struct {
	LinkPreview *postoptions.LinkPreview `json:"linkPreview,omitempty"`
	QuoteURI    string                   `json:"quoteUri,omitempty"`
	JobID       string                   `json:"jobId"` // empty for image-only posts (no asynchronous processing)
	Message     string                   `json:"message"`
	Media       []PendingMedia           `json:"media"`
	// Arm -> confirm -> publish handshake (same as the Facebook story flow):
	// FinalizePost arms without mutating, CheckPostStatus witnesses, and only
	// a witnessed attempt runs the create - so a create that dies with an
	// unknown outcome is detected instead of run again.
	Attempting bool `json:"attempting,omitempty"`
	Confirmed  bool `json:"confirmed,omitempty"`
	// Consecutive finalize preparation failures (login, image upload):
	// bounded so a dead integration fails with an accurate error instead of
	// burning the whole check budget and ending in a misleading "couldn't
	// confirm" warning.
	PrepFailures int `json:"prepFailures,omitempty"`
}

type PendingMedia struct {
	Path string `json:"path"`
	Alt  string `json:"alt"`
	Type string `json:"type,omitempty"`
}

func (d PendingData) raw() json.RawMessage {
	data, _ := json.Marshal(d)
	return data
}

func decodePending(raw json.RawMessage) (PendingData, error) {
	var d PendingData
	err := json.Unmarshal(raw, &d)
	return d, err
}

func (p *Provider) PostPending(ctx context.Context, _, _ string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	if len(posts) == 0 {
		return nil, contentFailure("Choose a Bluesky post to publish")
	}
	for _, post := range posts {
		if err := checkPostContent(post); err != nil {
			return nil, err
		}
	}
	if _, err := publishingLimits(integration); err != nil {
		return nil, err
	}
	firstPost := posts[0]
	card, err := linkPreview(firstPost.Settings)
	if err != nil {
		return nil, err
	}
	quote, err := quoteURI(firstPost.Settings)
	if err != nil {
		return nil, err
	}

	// Only the video has an asynchronous processing step: start its upload
	// job now, the wait moves to CheckPostStatus. Images are uploaded by
	// FinalizePost (their blob refs can't travel through the workflow
	// history). Nothing here is irreversible - an unused video job leaves no
	// post behind.
	jobID := ""
	for _, m := range firstPost.Media {
		if mediaKind(m) != "video" {
			continue
		}
		a, err := p.getAgent(ctx, integration)
		if err != nil {
			return nil, err
		}
		job, err := p.startVideoUpload(ctx, a, m.Path)
		if err != nil {
			return nil, err
		}
		jobID = job.JobID
		break
	}

	pending := PendingData{LinkPreview: card, QuoteURI: quote, JobID: jobID, Message: firstPost.Message, Media: []PendingMedia{}}
	for _, m := range firstPost.Media {
		pending.Media = append(pending.Media, PendingMedia{Path: m.Path, Alt: m.Alt, Type: m.Type})
	}
	return []integrations.PostResponse{{ID: firstPost.ID, Status: "pending", PendingData: pending.raw()}}, nil
}

func (p *Provider) CheckPostStatus(ctx context.Context, _ string, raw json.RawMessage, integration *ent.Integration) (*integrations.PendingCheckResponse, error) {
	pending, err := decodePending(raw)
	if err != nil {
		return nil, err
	}
	// A confirmed create attempt died without reporting its result: never
	// run the create again - stop with an explicit warning instead.
	if pending.Attempting && pending.Confirmed {
		return nil, temporalx.BadBody(identifier, "{}", "{}", "Bluesky may have already published this post, please check your account before posting again to avoid duplicates")
	}

	// witness the armed create so FinalizePost knows the attempt is uniquely
	// accounted for before it mutates anything
	witness := func() *integrations.PendingCheckResponse {
		if pending.Attempting && !pending.Confirmed {
			pending.Confirmed = true
			return &integrations.PendingCheckResponse{Status: "ready", PendingData: pending.raw()}
		}
		return &integrations.PendingCheckResponse{Status: "ready", PendingData: raw}
	}

	// Image-only posts have no asynchronous processing step.
	if pending.JobID == "" {
		return witness(), nil
	}

	status, err := p.getVideoJobStatus(ctx, pending.JobID)
	if err != nil {
		if temporalx.FailureType(err) == temporalx.TypeRefreshToken || temporalx.FailureType(err) == temporalx.TypeBadBody || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		// Transient status-check error: the job may finish processing just
		// fine, keep polling - if the video service stays broken the workflow
		// exhausts its checks and warns the user properly.
		return &integrations.PendingCheckResponse{Status: "pending", PendingData: raw}, nil
	}
	if integration == nil || status.Did != integration.InternalID {
		return nil, contentFailure("Bluesky returned a video for another account")
	}
	if status.State == "JOB_STATE_FAILED" {
		data, _ := json.Marshal(status)
		return nil, temporalx.BadBody(identifier, string(data), "{}", "Could not upload video, job failed")
	}
	if hasBlob(status.Blob) {
		return witness(), nil
	}
	return &integrations.PendingCheckResponse{Status: "pending", PendingData: raw}, nil
}

func (p *Provider) FinalizePost(ctx context.Context, _ string, raw json.RawMessage, integration *ent.Integration) (*integrations.PendingCheckResponse, error) {
	pending, err := decodePending(raw)
	if err != nil {
		return nil, err
	}
	if err := checkPostContent(pending.post()); err != nil {
		return nil, err
	}
	if _, err := publishingLimits(integration); err != nil {
		return nil, err
	}
	// Create with an arm -> confirm -> publish handshake: the create only
	// runs after CheckPostStatus witnessed the intent, so a run that dies
	// mid-create is detectable and the post is never published twice.
	if !pending.Attempting || !pending.Confirmed {
		pending.Attempting, pending.Confirmed = true, false
		return &integrations.PendingCheckResponse{Status: "pending", PendingData: pending.raw()}, nil
	}

	// Everything up to the create itself is preparation: none of it mutates
	// the account, so a failure here must NOT leave the confirmed handshake
	// armed - the next check would report a false "may already be published"
	// warning. Disarm and hand back to the workflow to try again instead; the
	// only unknown-outcome window left is the create below.
	var (
		a      *agent
		embed  any
		facets []Facet
	)
	prepare := func() (*integrations.PendingCheckResponse, error) {
		var err error
		if a, err = p.getAgent(ctx, integration); err != nil {
			return nil, err
		}
		if pending.JobID != "" {
			// Re-read the blob from the job (a blob ref never travels through
			// the workflow history).
			status, err := p.getVideoJobStatus(ctx, pending.JobID)
			if err != nil {
				return nil, err
			}
			if integration == nil || status.Did != integration.InternalID {
				return nil, contentFailure("Bluesky returned a video for another account")
			}
			if status.State == "JOB_STATE_FAILED" {
				data, _ := json.Marshal(status)
				return nil, temporalx.BadBody(identifier, string(data), "{}", "Could not upload video, job failed")
			}
			if !hasBlob(status.Blob) {
				// The blob disappeared between the check and now (or the
				// check was skipped): hand back to the workflow to keep
				// polling.
				pending.Attempting, pending.Confirmed = false, false
				return &integrations.PendingCheckResponse{Status: "pending", PendingData: pending.raw()}, nil
			}
			if err := checkBlob(status.Blob, "video/mp4", a.limits.VideoMaxBytes, a.limits); err != nil {
				return nil, err
			}
			embed = &videoEmbed{Type: "app.bsky.embed.video", Video: status.Blob}
			if len(pending.Media) == 1 {
				embed = &videoEmbed{Type: "app.bsky.embed.video", Video: status.Blob, Alt: pending.Media[0].Alt}
			}
		} else {
			media := make([]integrations.MediaContent, 0, len(pending.Media))
			for _, m := range pending.Media {
				media = append(media, integrations.MediaContent{Path: m.Path, Alt: m.Alt, Type: m.Type})
			}
			if embed, err = p.uploadMediaForPost(ctx, a, media); err != nil {
				return nil, err
			}
		}
		embed, err = p.linkEmbed(ctx, a, pending.LinkPreview, embed)
		if err != nil {
			return nil, err
		}
		embed, err = a.quoteEmbed(ctx, pending.QuoteURI, embed)
		if err != nil {
			return nil, err
		}
		facets = a.detectFacets(ctx, pending.Message)
		return nil, nil
	}
	early, err := prepare()
	if err != nil {
		// Explicit verdicts keep their meaning: a failed video job fails the
		// post, an invalid login refreshes, and identity loss requires reconnect.
		if kind := temporalx.FailureType(err); kind == temporalx.TypeBadBody || kind == temporalx.TypeRefreshToken || kind == temporalx.TypeDisconnect {
			return nil, err
		}
		// Repeated preparation failures mean the integration is broken, not
		// flaky: fail with an accurate message - nothing was ever created, so
		// this is safe and beats exhausting the check budget into a
		// misleading "check your account" warning.
		if pending.PrepFailures >= 4 {
			reason := err.Error()
			data, _ := json.Marshal(map[string]string{"message": reason})
			return nil, temporalx.BadBody(identifier, string(data), "{}", "Could not prepare the post for Bluesky, nothing was published: "+reason)
		}
		// Transient preparation error, nothing was created: disarm so the
		// workflow keeps polling and a later cycle re-arms.
		pending.Attempting, pending.Confirmed = false, false
		pending.PrepFailures++
		return &integrations.PendingCheckResponse{Status: "pending", PendingData: pending.raw()}, nil
	}
	if early != nil {
		return early, nil
	}

	temporalx.SetHeartbeatDetails(ctx, "bluesky: create post")
	created, err := createPost(ctx, a, pending.Message, facets, embed, nil)
	if err != nil {
		// A definite 4xx rejection (invalid record, payload too large) means
		// the post was NOT created: fail it properly instead of leaving the
		// armed handshake to report a false "may already be published"
		// warning. Ambiguous answers (network errors, 5xx, 429) stay on the
		// conservative unknown-outcome path. No 408 exclusion: statuses the
		// xrpc client does not know - including 408 - map to 400.
		var xrpcErr *XRPCError
		if errors.As(err, &xrpcErr) && xrpcErr.Status >= 400 && xrpcErr.Status < 500 && xrpcErr.Status != 429 {
			detail := any(map[string]any{})
			if xrpcErr.Name != "" {
				detail = xrpcErr.Name
			} else if xrpcErr.Message != "" {
				detail = xrpcErr.Message
			}
			data, _ := json.Marshal(detail)
			return nil, temporalx.BadBody(identifier, string(data), "{}", "Bluesky rejected the post, nothing was published, please check the content and try again")
		}
		return nil, err
	}

	return &integrations.PendingCheckResponse{
		Status:     "completed",
		PostID:     created.URI,
		ReleaseURL: fmt.Sprintf("https://bsky.app/profile/%s/post/%s", integration.InternalID, rkey(created.URI)),
	}, nil
}

// Post is the old blocking behavior, kept for workflow versions before v1.0.6
// that don't know how to resolve a `pending` response - they wait for the
// processing and create the post inside the activity like before.
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
		// this method: failing here is safe (the post is only created once
		// the video is processed), timing the activity out is not - a retried
		// activity would upload and publish again.
		if time.Since(started) > pollTimeout {
			return nil, temporalx.BadBody(identifier, "{}", "{}", "Video upload timed out, job did not complete")
		}

		check, err := p.CheckPostStatus(ctx, accessToken, pending, integration)
		if err != nil {
			return nil, err
		}
		if check.Status == "pending" {
			pending = check.PendingData
			if err := p.Sleep(ctx, pollInterval); err != nil {
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
			return []integrations.PostResponse{{ID: response.ID, PostID: result.PostID, Status: "completed", ReleaseURL: result.ReleaseURL}}, nil
		}
		pending = result.PendingData

		// An armed pending just loops into the witnessing check; a de-armed
		// one is a transient preparation failure (login, image upload) - back
		// off before retrying instead of hammering the login endpoint.
		if decoded, _ := decodePending(pending); !decoded.Attempting {
			if err := p.Sleep(ctx, pollInterval); err != nil {
				return nil, err
			}
		}
	}
}

func (p *Provider) Comment(ctx context.Context, id, postID, lastCommentID, _ string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	if len(posts) == 0 {
		return nil, contentFailure("Choose a Bluesky reply to publish")
	}
	if err := checkPostContent(posts[0]); err != nil {
		return nil, err
	}
	a, err := p.getAgent(ctx, integration)
	if err != nil {
		return nil, err
	}
	commentPost := posts[0]
	embed, err := p.uploadMediaForPost(ctx, a, commentPost.Media)
	if err != nil {
		return nil, err
	}
	card, err := linkPreview(commentPost.Settings)
	if err != nil {
		return nil, err
	}
	embed, err = p.linkEmbed(ctx, a, card, embed)
	if err != nil {
		return nil, err
	}
	quote, err := quoteURI(commentPost.Settings)
	if err != nil {
		return nil, err
	}
	embed, err = a.quoteEmbed(ctx, quote, embed)
	if err != nil {
		return nil, err
	}
	facets := a.detectFacets(ctx, commentPost.Message)

	// Fetch the parent post to get its CID
	parentURI := lastCommentID
	if parentURI == "" {
		parentURI = postID
	}
	parent, err := a.getPostThread(ctx, parentURI)
	if err != nil {
		return nil, err
	}
	var parentCID, rootURI, rootCID string
	if parent != nil {
		parentCID = parent.CID
		rootURI, rootCID = parent.replyRoot()
	}
	if rootURI == "" {
		rootURI = postID
	}
	if rootCID == "" {
		rootCID = parentCID
	}

	temporalx.SetHeartbeatDetails(ctx, "bluesky: create post")
	created, err := createPost(ctx, a, commentPost.Message, facets, embed, &replyRefs{
		Root:   refOrUndefined{URI: rootURI, CID: rootCID},
		Parent: refOrUndefined{URI: parentURI, CID: parentCID},
	})
	if err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{
		ID:         commentPost.ID,
		PostID:     created.URI,
		Status:     "completed",
		ReleaseURL: fmt.Sprintf("https://bsky.app/profile/%s/post/%s", id, rkey(created.URI)),
	}}, nil
}

// jsNumber is JavaScript's unary plus on a string; ok is false for NaN.
func jsNumber(s string) (float64, bool) {
	t := strings.TrimSpace(s)
	if t == "" {
		return 0, true
	}
	n, err := strconv.ParseFloat(t, 64)
	return n, err == nil && !math.IsNaN(n)
}

// likedThread returns the thread post when it reached likesAmount likes.
func likedThread(ctx context.Context, a *agent, id, likesAmount string) (*threadPost, error) {
	thread, err := a.getPostThread(ctx, id)
	if err != nil {
		return nil, err
	}
	likes, ok := jsNumber(likesAmount)
	if thread == nil || thread.LikeCount == nil || !ok || *thread.LikeCount < likes {
		return nil, nil
	}
	return thread, nil
}

func (p *Provider) autoRepostPost(ctx context.Context, integration *ent.Integration, id string, fields map[string]string) (bool, error) {
	a, err := p.loginAgent(ctx, integration)
	if err != nil {
		return false, err
	}
	thread, err := likedThread(ctx, a, id, fields["likesAmount"])
	if err != nil || thread == nil {
		return err == nil, err
	}
	if err := p.Sleep(ctx, plugDelay); err != nil {
		return false, err
	}
	if _, err := a.repost(ctx, thread.URI, thread.CID); err != nil {
		return false, err
	}
	return true, nil
}

func (p *Provider) autoPlugPost(ctx context.Context, integration *ent.Integration, id string, fields map[string]string) (bool, error) {
	a, err := p.loginAgent(ctx, integration)
	if err != nil {
		return false, err
	}
	thread, err := likedThread(ctx, a, id, fields["likesAmount"])
	if err != nil || thread == nil {
		return err == nil, err
	}
	if err := p.Sleep(ctx, plugDelay); err != nil {
		return false, err
	}
	text := helpers.StripHTMLValidation("normal", fields["post"], helpers.StripOptions{ReplaceBold: true})
	ref := refOrUndefined{URI: thread.URI, CID: thread.CID}
	if _, err := createPost(ctx, a, text, nil, nil, &replyRefs{Root: ref, Parent: ref}); err != nil {
		return false, err
	}
	return true, nil
}

var likesAmountField = integrations.PlugField{
	Name:        "likesAmount",
	Type:        "number",
	Placeholder: "Amount of likes",
	Description: "The amount of likes to trigger the repost",
	Validation:  `/^\d+$/`,
}

func (p *Provider) Plugs() []integrations.Plug {
	return []integrations.Plug{
		{
			MethodName:           "autoRepostPost",
			Identifier:           "bluesky-autoRepostPost",
			Title:                "Auto Repost Posts",
			Description:          "When a post reached a certain number of likes, repost it to increase engagement (1 week old posts)",
			RunEveryMilliseconds: 21600000,
			TotalRuns:            3,
			Fields:               []integrations.PlugField{likesAmountField},
			Run:                  p.autoRepostPost,
		},
		{
			MethodName:           "autoPlugPost",
			Identifier:           "bluesky-autoPlugPost",
			Title:                "Auto plug post",
			Description:          "When a post reached a certain number of likes, add another post to it so you followers get a notification about your promotion",
			RunEveryMilliseconds: 21600000,
			TotalRuns:            3,
			Fields: []integrations.PlugField{
				likesAmountField,
				{
					Name:        "post",
					Type:        "richtext",
					Placeholder: "Post to plug",
					Description: "Message content to plug",
					Validation:  `/^[\s\S]{3,}$/g`,
				},
			},
			Run: p.autoPlugPost,
		},
	}
}

func (p *Provider) Mention(ctx context.Context, _, query, _ string, integration *ent.Integration) ([]integrations.MentionResult, bool, error) {
	a, err := p.loginAgent(ctx, integration)
	if err != nil {
		return nil, false, err
	}
	actors, err := a.searchActors(ctx, query)
	if err != nil {
		return nil, false, err
	}
	out := make([]integrations.MentionResult, 0, len(actors))
	for _, actor := range actors {
		out = append(out, integrations.MentionResult{Label: actor.DisplayName, ID: actor.Handle, Image: actor.Avatar})
	}
	return out, false, nil
}

func (p *Provider) MentionFormat(idOrHandle, _ string) string { return "@" + idOrHandle }
