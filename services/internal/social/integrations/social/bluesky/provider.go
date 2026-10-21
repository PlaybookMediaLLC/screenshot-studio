// Package bluesky is the Bluesky provider. The
// @atproto/api agent is replaced by direct XRPC calls (agent.go) and
// RichText.detectFacets by richtext.go.
package bluesky

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"golang.org/x/image/draw"
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
}

var (
	_ integrations.Provider         = (*Provider)(nil)
	_ integrations.PendingPoster    = (*Provider)(nil)
	_ integrations.Commenter        = (*Provider)(nil)
	_ integrations.CustomFielder    = (*Provider)(nil)
	_ integrations.MentionFormatter = (*Provider)(nil)
)

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, nil)}
}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier: identifier,
		Name:       "Bluesky",
		Editor:     "normal",
		Scopes:     []string{"write:statuses", "profile", "write:media"},
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
			if strings.Contains(media.Path, "mp4") {
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
		{
			Key: "service", Label: "Service", DefaultValue: "https://bsky.social", Type: "text",
			Validation: `/^(https?:\/\/)?((([a-zA-Z0-9\-_]{1,256}\.[a-zA-Z]{2,6})|(([0-9]{1,3}\.){3}[0-9]{1,3}))(:[0-9]{1,5})?)(\/[^\s]*)?$/`,
		},
		{Key: "identifier", Label: "Identifier", Validation: `/^.+$/`, Type: "text"},
		{Key: "password", Label: "Password", Validation: `/^.{3,}$/`, Type: "password"},
	}
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(10), State: state}, nil
}

type credentials struct {
	Service    string `json:"service"`
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	data, err := base64.StdEncoding.DecodeString(params.Code)
	if err != nil {
		if data, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(params.Code, "=")); err != nil {
			return nil, err
		}
	}
	var body credentials
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, err
	}

	// The service URL is user-supplied: validate it here - the connection
	// chokepoint - so an internal/private address can never be saved as an
	// integration. Opt-out matches the SSRF-safe client's env.
	if !ssrf.Disabled() && !ssrf.IsSafePublicHTTPSURL(ctx, body.Service) {
		return nil, integrations.AuthMessage("Invalid service URL: must be a public HTTPS address")
	}

	invalid := integrations.AuthMessage("Invalid credentials")
	a, err := newAgent(body.Service)
	if err != nil {
		return nil, invalid
	}
	if err := a.login(ctx, body.Identifier, body.Password); err != nil {
		return nil, invalid
	}
	profile, err := a.getProfile(ctx, a.session.Did)
	if err != nil || profile.Did != a.session.Did {
		return nil, invalid
	}
	now := time.Now()
	return &integrations.AuthTokenDetails{
		RefreshToken: a.session.RefreshJwt,
		ExpiresIn:    now.AddDate(100, 0, 0).Unix() - now.Unix(),
		AccessToken:  a.session.AccessJwt,
		ID:           a.session.Did,
		Name:         profile.DisplayName,
		Picture:      profile.Avatar,
		Username:     profile.Handle,
	}, nil
}

// loginAgent logs in with the credentials stored on the integration.
func loginAgent(ctx context.Context, integration *ent.Integration) (*agent, error) {
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
	a, err := newAgent(body.Service)
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
	a, err := loginAgent(ctx, integration)
	var xrpcErr *XRPCError
	// Only a definite 4xx (bad password, account taken down) means the
	// credentials are broken. A 5xx or network error is Bluesky being
	// unavailable: let it propagate as a transient failure instead of marking
	// the channel as disconnected.
	if errors.As(err, &xrpcErr) && xrpcErr.Status >= 400 && xrpcErr.Status < 500 && xrpcErr.Status != 429 {
		data, _ := json.Marshal(xrpcErr)
		return nil, temporalx.RefreshToken(identifier, string(data), "{}", "")
	}
	return a, err
}

// reduceImageBySize shrinks the image by 10% steps until it is under maxSizeKB.
func (p *Provider) reduceImageBySize(ctx context.Context, url string, maxSizeKB float64) (width, height int, buffer []byte, err error) {
	buffer, err = p.ReadOrFetch(ctx, url)
	if err != nil {
		return 0, 0, nil, err
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(buffer))
	if err != nil {
		return 0, 0, nil, err
	}
	width, height = cfg.Width, cfg.Height

	// Resize iteratively until the size is below the threshold
	for float64(len(buffer))/1024 > maxSizeKB {
		width = int(math.Floor(float64(width) * 0.9)) // Reduce dimensions by 10%
		height = int(math.Floor(float64(height) * 0.9))
		if buffer, err = resize(buffer, format, width, height); err != nil {
			return 0, 0, nil, err
		}
		if width < 10 || height < 10 {
			break // Prevent overly small dimensions
		}
	}
	return width, height, buffer, nil
}

// resize re-encodes in the source format like sharp does; Go has no WebP
// encoder, so WebP becomes JPEG (sharp's default quality 80).
func resize(data []byte, format string, width, height int) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	dst := image.NewRGBA(image.Rect(0, 0, max(width, 1), max(height, 1)))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	var out bytes.Buffer
	switch format {
	case "png":
		err = png.Encode(&out, dst)
	case "gif":
		err = gif.Encode(&out, dst, nil)
	default:
		err = jpeg.Encode(&out, dst, &jpeg.Options{Quality: 80})
	}
	return out.Bytes(), err
}

func statusText(res *http.Response) string {
	return strings.TrimPrefix(res.Status, strconv.Itoa(res.StatusCode)+" ")
}

// startVideoUpload streams the video bytes to the Bluesky video service and
// returns the job status - it does NOT wait for the processing. The blob only
// exists once the job completes; callers re-read it from getVideoJobStatus.
func startVideoUpload(ctx context.Context, a *agent, videoPath string) (*jobStatus, error) {
	did, err := a.accountDid()
	if err != nil {
		return nil, err
	}
	var serviceAuth struct {
		Token string `json:"token"`
	}
	if err := a.call(ctx, xrpcRequest{nsid: "com.atproto.server.getServiceAuth", params: url.Values{
		"aud": {"did:web:" + a.dispatchURL().Host},
		"lxm": {"com.atproto.repo.uploadBlob"},
		"exp": {strconv.FormatInt(time.Now().Unix()+60*30, 10)}, // 30 minutes
	}}, &serviceAuth); err != nil {
		return nil, err
	}

	// The video is never buffered in memory: the size comes from a HEAD
	// request and the bytes are streamed straight from the source into the
	// upload.
	temporalx.SetHeartbeatDetails(ctx, "bluesky: video size")
	head, err := http.NewRequestWithContext(ctx, http.MethodHead, videoPath, nil)
	if err != nil {
		return nil, err
	}
	// identity encoding so content-length matches the bytes the GET streams
	head.Header.Set("Accept-Encoding", "identity")
	headRes, err := ssrf.Client().Do(head)
	if err != nil {
		return nil, err
	}
	headRes.Body.Close()
	videoSize, _ := strconv.ParseInt(headRes.Header.Get("Content-Length"), 10, 64)
	if headRes.StatusCode < 200 || headRes.StatusCode > 299 || videoSize <= 0 {
		return nil, temporalx.BadBody(identifier, "{}", "{}", "Could not determine the video size for Bluesky upload")
	}

	temporalx.SetHeartbeatDetails(ctx, "bluesky: read video")
	get, err := http.NewRequestWithContext(ctx, http.MethodGet, videoPath, nil)
	if err != nil {
		return nil, err
	}
	get.Header.Set("Accept-Encoding", "identity")
	videoRes, err := ssrf.Client().Do(get)
	if err != nil {
		return nil, err
	}
	defer videoRes.Body.Close()
	if videoRes.StatusCode < 200 || videoRes.StatusCode > 299 {
		return nil, fmt.Errorf("Failed to fetch video: %s", statusText(videoRes))
	}

	parts := strings.Split(videoPath, "/")
	uploadURL := videoServiceURL + "/xrpc/app.bsky.video.uploadVideo?" + url.Values{"did": {did}, "name": {parts[len(parts)-1]}}.Encode()
	temporalx.SetHeartbeatDetails(ctx, "bluesky: upload video")
	upload, err := http.NewRequestWithContext(ctx, http.MethodPost, uploadURL, videoRes.Body)
	if err != nil {
		return nil, err
	}
	upload.ContentLength = videoSize
	upload.Header.Set("Authorization", "Bearer "+serviceAuth.Token)
	upload.Header.Set("Content-Type", "video/mp4")
	uploadRes, err := http.DefaultClient.Do(upload)
	if err != nil {
		return nil, err
	}
	defer uploadRes.Body.Close()
	data, err := io.ReadAll(uploadRes.Body)
	if err != nil {
		return nil, err
	}
	var job jobStatus
	if err := json.Unmarshal(data, &job); err != nil {
		return nil, err
	}
	if job.State == "JOB_STATE_FAILED" {
		return nil, temporalx.BadBody(identifier, "{}", "{}", "Could not upload video, job failed")
	}
	return &job, nil
}

// getVideoJobStatus is a single read of the processing job - the endpoint is
// public (no login), so status checks never spend Bluesky's strict
// createSession rate limits.
func getVideoJobStatus(ctx context.Context, jobID string) (*jobStatus, error) {
	a, err := newAgent(videoServiceURL)
	if err != nil {
		return nil, err
	}
	a.client = http.DefaultClient
	var out struct {
		JobStatus jobStatus `json:"jobStatus"`
	}
	if err := a.call(ctx, xrpcRequest{nsid: "app.bsky.video.getJobStatus", params: url.Values{"jobId": {jobID}}}, &out); err != nil {
		return nil, err
	}
	return &out.JobStatus, nil
}

func hasBlob(blob json.RawMessage) bool { return len(blob) > 0 && string(blob) != "null" }

type videoEmbed struct {
	Type  string          `json:"$type"`
	Video json.RawMessage `json:"video"`
}

// uploadVideo is the blocking upload+wait, used by the paths that still
// resolve everything inside one activity (comments, and Post for pre-v1.0.6
// workflows).
func (p *Provider) uploadVideo(ctx context.Context, a *agent, videoPath string) (*videoEmbed, error) {
	job, err := startVideoUpload(ctx, a, videoPath)
	if err != nil {
		return nil, err
	}
	blob := job.Blob

	const maxAttempts = 18 // ~9 minutes at 30s interval
	for attempts := 0; !hasBlob(blob); attempts++ {
		if attempts >= maxAttempts {
			return nil, temporalx.BadBody(identifier, "{}", "{}", "Video upload timed out, job did not complete")
		}
		status, err := getVideoJobStatus(ctx, job.JobID)
		if err != nil {
			return nil, err
		}
		if hasBlob(status.Blob) {
			blob = status.Blob
		}
		if status.State == "JOB_STATE_FAILED" {
			return nil, temporalx.BadBody(identifier, "{}", "{}", "Could not upload video, job failed")
		}
		if err := p.Sleep(ctx, videoPollInterval); err != nil {
			return nil, err
		}
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

// uploadMediaForPost uploads the images and the first video; the embed is
// nil when there is no media.
func (p *Provider) uploadMediaForPost(ctx context.Context, a *agent, media []integrations.MediaContent) (any, error) {
	var imageMedia, videoMedia []integrations.MediaContent
	for _, m := range media {
		if helpers.HasExtension(m.Path, "mp4") {
			videoMedia = append(videoMedia, m)
		} else {
			imageMedia = append(imageMedia, m)
		}
	}

	var images []embedImage
	for _, m := range imageMedia {
		width, height, buffer, err := p.reduceImageBySize(ctx, m.Path, 976)
		if err != nil {
			return nil, err
		}
		temporalx.SetHeartbeatDetails(ctx, "bluesky: upload blob")
		blob, err := a.uploadBlob(ctx, buffer)
		if err != nil {
			return nil, err
		}
		images = append(images, embedImage{Alt: m.Alt, Image: blob, AspectRatio: aspectRatio{Width: width, Height: height}})
	}

	// Upload videos (only one video per post is supported by Bluesky)
	if len(videoMedia) > 0 {
		return p.uploadVideo(ctx, a, videoMedia[0].Path)
	}
	if len(images) > 0 {
		return &imagesEmbed{Type: "app.bsky.embed.images", Images: images}, nil
	}
	return nil, nil
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
	JobID   string         `json:"jobId"` // empty for image-only posts (no asynchronous processing)
	Message string         `json:"message"`
	Media   []PendingMedia `json:"media"`
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
	firstPost := posts[0]

	// Only the video has an asynchronous processing step: start its upload
	// job now, the wait moves to CheckPostStatus. Images are uploaded by
	// FinalizePost (their blob refs can't travel through the workflow
	// history). Nothing here is irreversible - an unused video job leaves no
	// post behind.
	jobID := ""
	for _, m := range firstPost.Media {
		if !helpers.HasExtension(m.Path, "mp4") {
			continue
		}
		a, err := p.getAgent(ctx, integration)
		if err != nil {
			return nil, err
		}
		job, err := startVideoUpload(ctx, a, m.Path)
		if err != nil {
			return nil, err
		}
		jobID = job.JobID
		break
	}

	pending := PendingData{JobID: jobID, Message: firstPost.Message, Media: []PendingMedia{}}
	for _, m := range firstPost.Media {
		pending.Media = append(pending.Media, PendingMedia{Path: m.Path, Alt: m.Alt})
	}
	return []integrations.PostResponse{{ID: firstPost.ID, Status: "pending", PendingData: pending.raw()}}, nil
}

func (p *Provider) CheckPostStatus(ctx context.Context, _ string, raw json.RawMessage, _ *ent.Integration) (*integrations.PendingCheckResponse, error) {
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

	status, err := getVideoJobStatus(ctx, pending.JobID)
	if err != nil {
		if temporalx.FailureType(err) == temporalx.TypeRefreshToken {
			return nil, err
		}
		// Transient status-check error: the job may finish processing just
		// fine, keep polling - if the video service stays broken the workflow
		// exhausts its checks and warns the user properly.
		return &integrations.PendingCheckResponse{Status: "pending", PendingData: raw}, nil
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
			status, err := getVideoJobStatus(ctx, pending.JobID)
			if err != nil {
				return nil, err
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
			embed = &videoEmbed{Type: "app.bsky.embed.video", Video: status.Blob}
		} else {
			media := make([]integrations.MediaContent, 0, len(pending.Media))
			for _, m := range pending.Media {
				media = append(media, integrations.MediaContent{Path: m.Path, Alt: m.Alt})
			}
			if embed, err = p.uploadMediaForPost(ctx, a, media); err != nil {
				return nil, err
			}
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
	a, err := p.getAgent(ctx, integration)
	if err != nil {
		return nil, err
	}
	commentPost := posts[0]
	embed, err := p.uploadMediaForPost(ctx, a, commentPost.Media)
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
	a, err := loginAgent(ctx, integration)
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
	a, err := loginAgent(ctx, integration)
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
	a, err := loginAgent(ctx, integration)
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
