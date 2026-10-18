package clipping

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/media"
	clippingdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/clipping"
	mediadto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// ClippingStopType is the application failure type of ClippingStop.
const ClippingStopType = "clipping_stop"

// ClippingStop is a reason retrying can't change (private video, no minutes
// left, no speech): the workflow stops and the message is what the customer
// reads
func ClippingStop(message string) error {
	return temporal.NewNonRetryableApplicationError(temporalx.Truncate(message, 2000), ClippingStopType, nil)
}

// Answer of a job poll. "retry" is a failure the media service marked as
// retryable (or a crashed job), so the workflow submits the job again
const (
	StatePending = "pending"
	StateRetry   = "retry"
	StateDone    = "done"
	StateFailed  = "failed"
)

// JobCheck is a job poll answer; Transcribe is only set by CheckAnalyse.
type JobCheck struct {
	State      string `json:"state"`
	Transcribe *bool  `json:"transcribe,omitempty"`
}

const creditsType = "clipping_minutes"

const (
	// Oxylabs only cuts on whole seconds, so the window is fetched a little wider
	// and the clip job makes the exact cut inside it
	windowPadding  = 2
	minClipSeconds = 10
	maxClipSeconds = 90
	// Longer than this no plan pays for, and the transcript stops fitting one prompt
	maxSourceMinutes = 180
	// Every clipping costs real money before its minutes are charged, so an
	// organization runs one at a time and only so many a day
	maxRunning      = 1
	maxStartsPerDay = 20
	// A workflow that died (terminated, a database outage outliving its retries)
	// leaves its record running forever; after this long it is closed and refunded
	staleHours = 4
	// What the customer reads when the real reason is not theirs to fix. The reason
	// itself (a provider's answer, a stack) is only logged
	somethingWentWrong = "Something went wrong while clipping this video, the clipping minutes were given back."
)

// Word, Segment and Transcript are the clipping transcript types.
type Word struct {
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

type Segment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

type Transcript struct {
	Version   int       `json:"version"`
	Language  string    `json:"language"`
	Origin    string    `json:"origin"`
	WordLevel bool      `json:"word_level"`
	Segments  []Segment `json:"segments"`
	Words     []Word    `json:"words"`
}

type ProcessorFailure struct {
	Code       string  `json:"code"`
	Message    string  `json:"message"`
	Retryable  bool    `json:"retryable"`
	StderrTail *string `json:"stderr_tail,omitempty"`
}

// PickedClip is one clip openai.pickClips answered: a range of transcript lines.
type PickedClip struct {
	Title   string  `json:"title"`
	Content string  `json:"content"`
	From    float64 `json:"from"`
	To      float64 `json:"to"`
}

// Subscriptions is the part of subscriptions.Service clipping uses.
type Subscriptions interface {
	CheckCredits(ctx context.Context, org *ent.Organization, creditType string) (int, error)
	// ChargeCredits returns the id of the charge.
	ChargeCredits(ctx context.Context, id, organizationID, creditType string, credits int) (string, error)
	RefundCredits(ctx context.Context, organizationID, id string) error
}

// Organizations is the part of organizations.Service clipping uses.
type Organizations interface {
	GetOrgByIDWithSubscription(ctx context.Context, id string) (*ent.Organization, error)
}

// Integrations is the part of integration.Service clipping uses.
type Integrations interface {
	GetIntegrationByID(ctx context.Context, orgID, id string) (*ent.Integration, error)
}

// CreatePostBody is the CreatePostDto createDrafts sends.
type CreatePostBody struct {
	Date      string          `json:"date"`
	Order     string          `json:"order"`
	ShortLink bool            `json:"shortLink"`
	Type      string          `json:"type"`
	Tags      []any           `json:"tags"`
	Posts     []CreatePostOne `json:"posts"`
}

type CreatePostOne struct {
	Settings    map[string]any `json:"settings"`
	Group       string         `json:"group"`
	Integration struct {
		ID string `json:"id"`
	} `json:"integration"`
	Value []CreatePostValue `json:"value"`
}

type CreatePostValue struct {
	ID      string              `json:"id"`
	Delay   int                 `json:"delay"`
	Content string              `json:"content"`
	Image   []mediadto.MediaDto `json:"image"`
}

// Posts is the part of posts.Service clipping uses.
type Posts interface {
	// FindFreeDateTime returns "YYYY-MM-DDTHH:mm:00" (UTC).
	FindFreeDateTime(ctx context.Context, orgID, integrationID string) (string, error)
	CreatePost(ctx context.Context, orgID string, body CreatePostBody, creationMethod string) error
}

// Media is the part of media.Service clipping uses.
type Media interface {
	SaveFile(ctx context.Context, org, fileName, filePath, originalName string) (*media.SavedMedia, error)
	SaveMediaInformation(ctx context.Context, org string, data mediadto.SaveMediaInformationDto) (*media.MediaInformation, error)
}

// OpenAI is the part of openai.Service clipping uses.
type OpenAI interface {
	PickClips(ctx context.Context, title, language string, segments []Segment, maxClips int) ([]PickedClip, error)
}

// Deepgram is deepgram.Service.
type Deepgram interface {
	TranscribeURL(ctx context.Context, url string) (*Transcript, error)
}

// Storage is the part of the upload storage clipping always needs.
type Storage interface {
	RemoveFile(ctx context.Context, filePath string) error
}

// CloudStorage is the optional part of the upload storage only cloud storage
// has (presigned URLs, public URLs, small files under a known key).
type CloudStorage interface {
	SignDownloadURL(ctx context.Context, fileName string) (string, error)
	SignUploadURL(ctx context.Context, fileName, contentType string) (string, error)
	PublicURL(fileName string) string
	ReadFile(ctx context.Context, fileName string) (string, error)
	WriteFile(ctx context.Context, fileName, body, contentType string) error
}

type Service struct {
	repo          *Repository
	subscriptions Subscriptions
	organizations Organizations
	integrations  Integrations
	posts         Posts
	media         Media
	openai        OpenAI
	deepgram      Deepgram
	temporal      client.Client
	store         redis.Store
	storage       Storage
	cloud         CloudStorage
	ingest        media.Processor
	clipper       media.Processor
}

// NewService: ingest and clipper are nil when clipping is disabled
// (UploadFactory.createIngestProcessor/createClipProcessor returned null);
// temporal may be nil.
func NewService(repo *Repository, subscriptions Subscriptions, organizations Organizations, integrations Integrations,
	posts Posts, mediaService Media, openai OpenAI, deepgram Deepgram, temporal client.Client, store redis.Store,
	storage Storage, ingest, clipper media.Processor) *Service {
	cloud, _ := storage.(CloudStorage)
	return &Service{repo: repo, subscriptions: subscriptions, organizations: organizations, integrations: integrations,
		posts: posts, media: mediaService, openai: openai, deepgram: deepgram, temporal: temporal, store: store,
		storage: storage, cloud: cloud, ingest: ingest, clipper: clipper}
}

type keys struct{ transcript, audio string }

// Every intermediate file is a flat key, because removeFile only keeps the
// last part of a path
func clippingKeys(clippingID string) keys {
	return keys{transcript: "clipping-" + clippingID + "-transcript.json", audio: "clipping-" + clippingID + "-audio.ogg"}
}

type clipFiles struct{ source, words, output, thumbnail string }

func clipKeys(clipID string) clipFiles {
	return clipFiles{
		source:    "clip-" + clipID + "-source.mp4",
		words:     "clip-" + clipID + "-words.json",
		output:    "clip-" + clipID + ".mp4",
		thumbnail: "clip-" + clipID + ".jpg",
	}
}

func (k clipFiles) all() []string { return []string{k.source, k.words, k.output, k.thumbnail} }

func (s *Service) putJSON(ctx context.Context, key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.cloud.WriteFile(ctx, key, string(data), "application/json")
}

func (s *Service) getJSON(ctx context.Context, key string, v any) error {
	data, err := s.cloud.ReadFile(ctx, key)
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(data), v)
}

func (s *Service) removeFiles(ctx context.Context, keys []string) {
	for _, key := range keys {
		if err := s.storage.RemoveFile(ctx, key); err != nil {
			slog.Error(fmt.Sprintf("Could not remove clipping file %s:", key), "error", err)
		}
	}
}

var urlPattern = regexp.MustCompile(`https?://[^\s"'\\]+`)

func failureMessage(failure *ProcessorFailure) string {
	code := ""
	if failure != nil {
		code = failure.Code
	}
	switch code {
	case "SOURCE_UNAVAILABLE":
		return "This video is private, removed, or restricted by age or region, so it cannot be clipped."
	case "UNSUPPORTED_INPUT":
		return "This link is not a video that can be clipped. Live streams are not supported."
	}
	// the message and the stderr tail can carry presigned urls, which are
	// as good as a key to the file for as long as they live
	data, _ := json.Marshal(failure)
	slog.Error("Clipping job failed:", "failure", urlPattern.ReplaceAllString(string(data), "[url]"))
	if code == "" {
		code = "FAILED"
	}
	return fmt.Sprintf("The video could not be processed (%s).", code)
}

var youtubeHost = regexp.MustCompile(`(?i)(^|\.)(youtube\.com|youtu\.be)$`)

// isYoutubeURL: the media service only fetches from YouTube; anything else
// would cost a job to be told so
func isYoutubeURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && youtubeHost.MatchString(u.Hostname())
}

// balance is the minutes the organization can still spend. An install
// without billing has no plans to meter against, the same way image
// generation treats it
func (s *Service) balance(ctx context.Context, organizationID string) (int, error) {
	if os.Getenv("STRIPE_PUBLISHABLE_KEY") == "" {
		return maxSourceMinutes, nil
	}
	// loaded here and not taken from the caller: the MCP organization comes
	// without the subscription dates the billing window is computed from
	org, err := s.organizations.GetOrgByIDWithSubscription(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	return s.subscriptions.CheckCredits(ctx, org, creditsType)
}

func isStale(status string, createdAt time.Time) bool {
	return status != "completed" && status != "failed" && createdAt.Before(time.Now().Add(-staleHours*time.Hour))
}

func sliceRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

type IDResult struct {
	ID string `json:"id"`
}

func (s *Service) StartClipping(ctx context.Context, org *ent.Organization, body clippingdto.ClippingDto) (*IDResult, error) {
	if s.ingest == nil || s.clipper == nil || s.cloud == nil {
		return nil, httpx.HTTPException("Clipping is not available", 503)
	}
	if !isYoutubeURL(body.URL) {
		return nil, httpx.HTTPException("Only YouTube videos can be clipped", 400)
	}
	if org.IsTrailing {
		return nil, httpx.HTTPException("Clipping is not available in trial mode", 406)
	}
	balance, err := s.balance(ctx, org.ID)
	if err != nil {
		return nil, err
	}
	if balance <= 0 {
		return nil, &media.SubscriptionError{Action: media.ActionCreate, Section: media.SectionClippingMinutes}
	}

	integrations := body.Integrations
	if integrations == nil {
		integrations = []string{}
	}
	for _, integration := range integrations {
		found, err := s.integrations.GetIntegrationByID(ctx, org.ID, integration)
		if err != nil {
			return nil, err
		}
		if found == nil {
			return nil, httpx.HTTPException(fmt.Sprintf("Channel %s not found", integration), 400)
		}
	}

	if s.temporal == nil {
		return nil, httpx.HTTPException("Clipping is not available", 503)
	}

	// two starts at the same moment would both see nothing running
	key := "clippingStart:" + org.ID
	acquired, err := s.store.SetNX(ctx, key, "1", 15*time.Second)
	if err != nil {
		return nil, err
	}
	if !acquired {
		return nil, httpx.HTTPException("Another clipping is being started", 429)
	}
	defer s.store.Del(context.WithoutCancel(ctx), key)

	return s.createClipping(ctx, org.ID, body, integrations)
}

func (s *Service) createClipping(ctx context.Context, org string, body clippingdto.ClippingDto, integrations []string) (*IDResult, error) {
	running, err := s.repo.GetRunningClippings(ctx, org)
	if err != nil {
		return nil, err
	}
	live := 0
	for _, c := range running {
		if isStale(c.Status, c.CreatedAt) {
			if err := s.FailClipping(ctx, c.ID, "The clipping never finished", true); err != nil {
				return nil, err
			}
			continue
		}
		live++
	}
	if live >= maxRunning {
		return nil, httpx.HTTPException("A clipping is already running, wait for it to finish", 429)
	}

	started, err := s.repo.CountClippingsSince(ctx, org, time.Now().AddDate(0, 0, -1))
	if err != nil {
		return nil, err
	}
	if started >= maxStartsPerDay {
		return nil, httpx.HTTPException("Too many clippings were started today, try again tomorrow", 429)
	}

	maxClips := 5
	if body.Clips != nil && *body.Clips != 0 {
		maxClips = *body.Clips
	}
	fit := body.Fit
	if fit == "" {
		fit = "blur"
	}
	clipping, err := s.repo.CreateClipping(ctx, org, body.URL, maxClips, fit, integrations)
	if err != nil {
		return nil, err
	}

	if _, err := s.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                                       "clipping_" + clipping.ID,
		TaskQueue:                                temporalx.MainQueue,
		TypedSearchAttributes:                    temporal.NewSearchAttributes(temporalx.OrganizationID.ValueSet(org)),
		WorkflowExecutionErrorWhenAlreadyStarted: true,
	}, "clippingWorkflow", map[string]string{"clippingId": clipping.ID}); err != nil {
		// no workflow means nothing will ever flip the status
		if _, err := s.repo.UpdateClipping(ctx, org, clipping.ID, func(u *ent.ClippingUpdateOne) {
			u.SetStatus("failed").SetError("Could not start clipping")
		}); err != nil {
			return nil, err
		}
		return nil, httpx.HTTPException("Clipping is not available", 503)
	}

	return &IDResult{ID: clipping.ID}, nil
}

func (s *Service) GetClipping(ctx context.Context, org, id string) (*ClippingDetails, error) {
	clipping, err := s.repo.GetClipping(ctx, org, id)
	if err != nil {
		return nil, err
	}
	if clipping == nil {
		return nil, httpx.HTTPException("Clipping not found", 404)
	}
	if isStale(clipping.Status, time.Time(clipping.CreatedAt)) {
		if err := s.FailClipping(ctx, id, "The clipping never finished", true); err != nil {
			return nil, err
		}
		return s.repo.GetClipping(ctx, org, id)
	}
	return clipping, nil
}

// pollEvery is the pause between two looks of WaitForClipping (timer(3000)).
var pollEvery = 3 * time.Second

// WaitForClipping: a chat client can't wait between two status calls, so the
// waiting happens here: the answer is held until something changed (the step,
// a finished clip) or the time is up. It stays far below the 100 seconds a
// proxy in front of the MCP allows a request
func (s *Service) WaitForClipping(ctx context.Context, org, id string, seconds int) (*ClippingDetails, error) {
	progress := func(c *ClippingDetails) string {
		done := 0
		for _, clip := range c.Clips {
			if clip.Status != "pending" {
				done++
			}
		}
		return c.Status + strconv.Itoa(done)
	}

	first, err := s.GetClipping(ctx, org, id)
	if err != nil {
		return nil, err
	}
	current := first
	for waited := 0; waited < seconds && current.Status != "completed" && current.Status != "failed" &&
		progress(current) == progress(first); waited += 3 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(pollEvery):
		}
		if current, err = s.GetClipping(ctx, org, id); err != nil {
			return nil, err
		}
	}
	return current, nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// WidgetTicket is what a clipping ticket opens.
type WidgetTicket struct {
	Org string `json:"org"`
	ID  string `json:"id"`
}

// CreateWidgetTicket: the MCP widget runs in the host's sandboxed iframe (a
// foreign origin without our cookies), so it reads the status with a
// short-lived ticket that only opens this one clipping
func (s *Service) CreateWidgetTicket(ctx context.Context, org, id string) (string, error) {
	if _, err := s.GetClipping(ctx, org, id); err != nil {
		return "", err
	}
	ticket := randomHex(32)
	data, _ := json.Marshal(WidgetTicket{Org: org, ID: id})
	if err := s.store.Set(ctx, "clippingTicket:"+ticket, string(data), 10*time.Minute); err != nil {
		return "", err
	}
	return ticket, nil
}

type WidgetProgress struct {
	ClippingProgress
	Report bool `json:"report"`
}

// GetWidgetProgress is what the widget polls. Several widgets can watch one
// clipping (a reopened conversation mounts a new one), and each would tell the
// conversation that the clips are ready: "report" is true for exactly one of
// them, and only for one that saw the clipping running
func (s *Service) GetWidgetProgress(ctx context.Context, org, id string, sawRunning bool) (*WidgetProgress, error) {
	clipping, err := s.repo.GetClippingProgress(ctx, org, id)
	if err != nil {
		return nil, err
	}
	if clipping == nil {
		return nil, httpx.HTTPException("Clipping not found", 404)
	}
	report := false
	if sawRunning && (clipping.Status == "completed" || clipping.Status == "failed") {
		if report, err = s.store.SetNX(ctx, "clippingReported:"+id, "1", 24*time.Hour); err != nil {
			return nil, err
		}
	}
	return &WidgetProgress{ClippingProgress: *clipping, Report: report}, nil
}

// GetWidgetTicket returns nil for an unknown or expired ticket.
func (s *Service) GetWidgetTicket(ctx context.Context, ticket string) (*WidgetTicket, error) {
	value, ok, err := s.store.Get(ctx, "clippingTicket:"+ticket)
	if err != nil || !ok {
		return nil, err
	}
	var out *WidgetTicket
	if err := json.Unmarshal([]byte(value), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) GetClippings(ctx context.Context, org string, page int) (*ClippingsPage, error) {
	return s.repo.GetClippings(ctx, org, page)
}

func (s *Service) clippingByID(ctx context.Context, clippingID string) (*ent.Clipping, error) {
	clipping, err := s.repo.GetClippingByID(ctx, clippingID)
	if err != nil {
		return nil, err
	}
	if clipping == nil {
		return nil, ClippingStop("Clipping not found")
	}
	return clipping, nil
}

// SubmitAnalyse submits one job for the whole video: the captions when the
// video has them, the audio only when it does not, so most videos are
// analysed without a download. The remaining minutes are the duration limit,
// so a video that does not fit is refused before anything is paid for
func (s *Service) SubmitAnalyse(ctx context.Context, clippingID string) (string, error) {
	clipping, err := s.clippingByID(ctx, clippingID)
	if err != nil {
		return "", err
	}

	balance, err := s.balance(ctx, clipping.OrganizationID)
	if err != nil {
		return "", err
	}
	minutes := min(balance, maxSourceMinutes)
	if minutes <= 0 {
		return "", ClippingStop("No clipping minutes are left on this account for this month.")
	}

	// the first answer had no captions that can be trusted (see checkAnalyse),
	// so this time only the audio is asked for
	audioOnly := clipping.Status == "transcribing"
	k := clippingKeys(clippingID)
	job := map[string]any{
		"version":   1,
		"type":      "ingest",
		"reference": clippingID,
		"source":    map[string]any{"url": clipping.URL, "via": "oxylabs"},
	}
	if !audioOnly {
		transcriptURL, err := s.cloud.SignUploadURL(ctx, k.transcript, "application/json")
		if err != nil {
			return "", err
		}
		job["transcript"] = map[string]any{"url": transcriptURL, "languages": []string{"en"}}
	}
	audioURL, err := s.cloud.SignUploadURL(ctx, k.audio, "audio/ogg")
	if err != nil {
		return "", err
	}
	job["audio"] = map[string]any{"url": audioURL, "unless_transcript": !audioOnly}
	job["limits"] = map[string]any{"max_duration_seconds": minutes * 60}
	return s.ingest.Submit(ctx, job)
}

type ingestResult struct {
	Status string `json:"status"`
	Source *struct {
		Title           *string  `json:"title"`
		ThumbnailURL    *string  `json:"thumbnail_url"`
		DurationSeconds *float64 `json:"duration_seconds"`
		Trim            *struct {
			StartSeconds *float64 `json:"start_seconds"`
		} `json:"trim"`
	} `json:"source"`
	Video      json.RawMessage `json:"video"`
	Audio      json.RawMessage `json:"audio"`
	Transcript *struct {
		Origin string `json:"origin"`
	} `json:"transcript"`
	Failure *ProcessorFailure `json:"failure"`
}

func present(raw json.RawMessage) bool { return len(raw) > 0 && string(raw) != "null" }

func decodeResult[T any](raw json.RawMessage) *T {
	var out *T
	if present(raw) {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func boolPtr(v bool) *bool { return &v }

// CheckAnalyse: a video that can't be analysed stops the whole clipping, so
// this fails where the clip polls answer "failed". The minutes are charged
// here, as soon as the real duration is known and before any media is paid
// for; "transcribe" says the video had no captions and only the audio was
// stored
func (s *Service) CheckAnalyse(ctx context.Context, clippingID, jobID string) (*JobCheck, error) {
	clipping, err := s.clippingByID(ctx, clippingID)
	if err != nil {
		return nil, err
	}

	job, err := s.ingest.Status(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if job.Status == "pending" {
		return &JobCheck{State: StatePending}, nil
	}
	if job.Status == "failed" {
		return &JobCheck{State: StateRetry}, nil
	}

	result := decodeResult[ingestResult](job.Result)
	if result != nil && result.Status == "failed" {
		if result.Failure != nil && result.Failure.Retryable {
			return &JobCheck{State: StateRetry}, nil
		}
		if result.Failure != nil && result.Failure.Code == "DURATION_TOO_LONG" {
			seconds := 0.0
			if result.Source != nil && result.Source.DurationSeconds != nil {
				seconds = *result.Source.DurationSeconds
			}
			return nil, ClippingStop(fmt.Sprintf("This video is %d minutes long. It has to fit the clipping minutes left on this account for this month, and %d minutes at most.",
				int(math.Ceil(seconds/60)), maxSourceMinutes))
		}
		return nil, ClippingStop(failureMessage(result.Failure))
	}

	var duration float64
	if result != nil && result.Source != nil && result.Source.DurationSeconds != nil {
		duration = *result.Source.DurationSeconds
	}
	if result == nil || result.Status != "completed" || duration == 0 {
		slog.Error("Unexpected analyse result:", "result", string(job.Result))
		return nil, ClippingStop(somethingWentWrong)
	}

	if result.Transcript == nil && !present(result.Audio) {
		return nil, ClippingStop("This video has no captions and no audio.")
	}

	// Only YouTube's own captions are in the language that is spoken. An
	// uploaded track can be a translation (English subtitles on a Spanish talk)
	// and nothing in the answer tells the two apart, so the job is submitted
	// again for the audio and the transcriber finds the language itself
	if result.Transcript != nil && result.Transcript.Origin != "auto_generated" {
		if _, err := s.repo.UpdateClipping(ctx, clipping.OrganizationID, clippingID, func(u *ent.ClippingUpdateOne) {
			u.SetStatus("transcribing")
		}); err != nil {
			return nil, err
		}
		return &JobCheck{State: StateRetry}, nil
	}

	// Charged first and checked after: the clipping id is the id of the charge,
	// so a retried poll charges once and reads the same balance, and two
	// clippings racing each other are both counted before either is let through
	minutes := int(math.Ceil(duration / 60))
	credits, err := s.subscriptions.ChargeCredits(ctx, clippingID, clipping.OrganizationID, creditsType, minutes)
	if err != nil {
		return nil, err
	}

	balance, err := s.balance(ctx, clipping.OrganizationID)
	if err != nil {
		return nil, err
	}
	if balance < 0 {
		return nil, ClippingStop(fmt.Sprintf("This video is %d minutes long, more than the clipping minutes left on this account for this month.", minutes))
	}

	title := clipping.URL
	if result.Source.Title != nil && *result.Source.Title != "" {
		title = *result.Source.Title
	}
	if _, err := s.repo.UpdateClipping(ctx, clipping.OrganizationID, clippingID, func(u *ent.ClippingUpdateOne) {
		u.SetTitle(title)
		if result.Source.ThumbnailURL != nil && *result.Source.ThumbnailURL != "" {
			u.SetThumbnail(*result.Source.ThumbnailURL)
		}
		// rounded up, the window of the last clip must reach the real end
		u.SetDuration(int(math.Ceil(duration)))
		u.SetCreditsID(credits)
	}); err != nil {
		return nil, err
	}

	return &JobCheck{State: StateDone, Transcribe: boolPtr(result.Transcript == nil)}, nil
}

// Transcribe: the video has no captions, so the transcriber fetches the audio
// itself and the answer is stored in the shape of the captions file
func (s *Service) Transcribe(ctx context.Context, clippingID string) error {
	clipping, err := s.clippingByID(ctx, clippingID)
	if err != nil {
		return err
	}
	if _, err := s.repo.UpdateClipping(ctx, clipping.OrganizationID, clippingID, func(u *ent.ClippingUpdateOne) {
		u.SetStatus("transcribing")
	}); err != nil {
		return err
	}

	k := clippingKeys(clippingID)
	audioURL, err := s.cloud.SignDownloadURL(ctx, k.audio)
	if err != nil {
		return err
	}
	transcript, err := s.deepgram.TranscribeURL(ctx, audioURL)
	if err != nil {
		return err
	}
	return s.putJSON(ctx, k.transcript, transcript)
}

// PickClips returns the ids of the clips to render. A retry after the clips
// were stored returns the same ones instead of asking the model again
func (s *Service) PickClips(ctx context.Context, clippingID string) ([]string, error) {
	clipping, err := s.clippingByID(ctx, clippingID)
	if err != nil {
		return nil, err
	}
	if len(clipping.Edges.Clips) > 0 {
		out := make([]string, 0, len(clipping.Edges.Clips))
		for _, clip := range clipping.Edges.Clips {
			out = append(out, clip.ID)
		}
		return out, nil
	}

	if _, err := s.repo.UpdateClipping(ctx, clipping.OrganizationID, clippingID, func(u *ent.ClippingUpdateOne) {
		u.SetStatus("picking")
	}); err != nil {
		return nil, err
	}

	var transcript Transcript
	if err := s.getJSON(ctx, clippingKeys(clippingID).transcript, &transcript); err != nil {
		return nil, err
	}
	segments := transcript.Segments
	if len(segments) == 0 {
		return nil, ClippingStop("No speech was found in this video.")
	}

	title := ""
	if clipping.Title != nil {
		title = *clipping.Title
	}
	picked, err := s.openai.PickClips(ctx, title, transcript.Language, segments, clipping.MaxClips)
	if err != nil {
		return nil, err
	}

	clips := []NewClip{}
	for _, clip := range picked {
		if clip.From != math.Trunc(clip.From) || clip.To != math.Trunc(clip.To) ||
			clip.From < 0 || int(clip.To) >= len(segments) || clip.From > clip.To {
			continue
		}
		from, to := int(clip.From), int(clip.To)
		// the model does not always keep to the length it was given: a clip that
		// runs over ends on the last line that still fits instead of being lost
		for to > from && segments[to].End-segments[from].Start > maxClipSeconds {
			to--
		}
		next := NewClip{Title: clip.Title, Content: clip.Content, Start: segments[from].Start, End: segments[to].End}
		if length := next.End - next.Start; length < minClipSeconds || length > maxClipSeconds {
			continue
		}
		if slices.ContainsFunc(clips, func(p NewClip) bool { return next.Start < p.End && p.Start < next.End }) {
			continue
		}
		clips = append(clips, next)
	}
	if len(clips) > clipping.MaxClips {
		clips = clips[:max(clipping.MaxClips, 0)]
	}

	if len(clips) == 0 {
		return nil, ClippingStop("No part of this video works as a short clip.")
	}

	created, err := s.repo.CreateClips(ctx, clippingID, clips)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.UpdateClipping(ctx, clipping.OrganizationID, clippingID, func(u *ent.ClippingUpdateOne) {
		u.SetStatus("rendering")
	}); err != nil {
		return nil, err
	}
	return created, nil
}

func (s *Service) clipByID(ctx context.Context, clipID string) (*ent.ClippingClip, error) {
	clip, err := s.repo.GetClipByID(ctx, clipID)
	if err != nil {
		return nil, err
	}
	if clip == nil {
		return nil, ClippingStop("Clip not found")
	}
	return clip, nil
}

// SubmitClipFetch downloads only the window of the clip, never the whole video
func (s *Service) SubmitClipFetch(ctx context.Context, clipID string) (string, error) {
	clip, err := s.clipByID(ctx, clipID)
	if err != nil {
		return "", err
	}
	clipping := clip.Edges.Clipping

	end := int(math.Ceil(clip.End)) + windowPadding
	endSeconds := end
	if clipping.Duration != nil && *clipping.Duration != 0 {
		endSeconds = min(*clipping.Duration, end)
	}
	// a crop keeps about a third of the width, so it needs the taller rendition to
	// stay sharp; the whole picture scaled down does not
	maxHeight := 720
	if clipping.Fit == "crop" {
		maxHeight = 1080
	}
	videoURL, err := s.cloud.SignUploadURL(ctx, clipKeys(clipID).source, "video/mp4")
	if err != nil {
		return "", err
	}
	return s.ingest.Submit(ctx, map[string]any{
		"version":   1,
		"type":      "ingest",
		"reference": clipID,
		"source": map[string]any{
			"url":           clipping.URL,
			"via":           "oxylabs",
			"max_height":    maxHeight,
			"start_seconds": max(0, int(math.Floor(clip.Start))-windowPadding),
			"end_seconds":   endSeconds,
		},
		"video": map[string]any{"url": videoURL},
	})
}

// CheckClipFetch: a clip that can't be fetched is recorded as failed and
// never fails, the other clips of the video go on
func (s *Service) CheckClipFetch(ctx context.Context, clipID, jobID string) (*JobCheck, error) {
	clip, err := s.repo.GetClipByID(ctx, clipID)
	if err != nil {
		return nil, err
	}
	if clip == nil {
		return &JobCheck{State: StateFailed}, nil
	}

	job, err := s.ingest.Status(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if job.Status == "pending" {
		return &JobCheck{State: StatePending}, nil
	}
	if job.Status == "failed" {
		return &JobCheck{State: StateRetry}, nil
	}

	result := decodeResult[ingestResult](job.Result)
	if result != nil && result.Status == "failed" && result.Failure != nil && result.Failure.Retryable {
		return &JobCheck{State: StateRetry}, nil
	}

	if result == nil || result.Status != "completed" || !present(result.Video) {
		message := "The clip could not be downloaded"
		if result != nil && result.Failure != nil {
			message = failureMessage(result.Failure)
		} else {
			slog.Error("Unexpected fetch result:", "result", string(job.Result))
		}
		if err := s.FailClip(ctx, clipID, message, true); err != nil {
			return nil, err
		}
		return &JobCheck{State: StateFailed}, nil
	}

	// every time of the fetched file is relative to the start of the window
	trimStart := max(0, int(math.Floor(clip.Start))-windowPadding)
	if result.Source != nil && result.Source.Trim != nil && result.Source.Trim.StartSeconds != nil {
		trimStart = int(*result.Source.Trim.StartSeconds)
	}
	if _, err := s.repo.UpdateClip(ctx, clipID, func(u *ent.ClippingClipUpdateOne) { u.SetTrimStart(trimStart) }); err != nil {
		return nil, err
	}
	return &JobCheck{State: StateDone}, nil
}

func trimStartOf(clip *ent.ClippingClip) float64 {
	if clip.TrimStart == nil {
		return 0
	}
	return float64(*clip.TrimStart)
}

// CaptionClip stores the words of the captions on the timeline of the fetched
// window. Captions that only time whole lines can't highlight words, so the
// short window is transcribed instead
func (s *Service) CaptionClip(ctx context.Context, clipID string) error {
	clip, err := s.clipByID(ctx, clipID)
	if err != nil {
		return err
	}
	k := clipKeys(clipID)
	trimStart := trimStartOf(clip)
	var transcript Transcript
	if err := s.getJSON(ctx, clippingKeys(clip.ClippingID).transcript, &transcript); err != nil {
		return err
	}

	words := []Word{}
	if transcript.WordLevel {
		for _, word := range transcript.Words {
			if word.End > clip.Start && word.Start < clip.End {
				words = append(words, Word{Text: word.Text, Start: math.Max(0, word.Start-trimStart), End: math.Max(0, word.End-trimStart)})
			}
		}
	} else {
		sourceURL, err := s.cloud.SignDownloadURL(ctx, k.source)
		if err != nil {
			return err
		}
		transcribed, err := s.deepgram.TranscribeURL(ctx, sourceURL)
		if err != nil {
			return err
		}
		if transcribed.Words != nil {
			words = transcribed.Words
		}
	}
	return s.putJSON(ctx, k.words, words)
}

func (s *Service) SubmitClipRender(ctx context.Context, clipID string) (string, error) {
	clip, err := s.clipByID(ctx, clipID)
	if err != nil {
		return "", err
	}
	k := clipKeys(clipID)
	trimStart := trimStartOf(clip)
	var words []Word
	if err := s.getJSON(ctx, k.words, &words); err != nil {
		return "", err
	}

	sourceURL, err := s.cloud.SignDownloadURL(ctx, k.source)
	if err != nil {
		return "", err
	}
	outputURL, err := s.cloud.SignUploadURL(ctx, k.output, "video/mp4")
	if err != nil {
		return "", err
	}
	thumbnailURL, err := s.cloud.SignUploadURL(ctx, k.thumbnail, "image/jpeg")
	if err != nil {
		return "", err
	}
	// without face tracking a centre crop can cut the speaker out, the whole
	// picture over a blurred copy of itself never does, so blur is the default
	fit := "blur"
	if clip.Edges.Clipping.Fit == "crop" {
		fit = "crop"
	}
	job := map[string]any{
		"version":   1,
		"type":      "clip",
		"reference": clipID,
		"source":    map[string]any{"url": sourceURL},
		"clips": []any{map[string]any{
			"reference":     clipID,
			"start_seconds": math.Max(0, clip.Start-trimStart),
			"end_seconds":   clip.End - trimStart,
			"output":        map[string]any{"url": outputURL},
			"thumbnail":     map[string]any{"url": thumbnailURL, "timestamp_seconds": 0},
		}},
		"frame": map[string]any{"width": 1080, "height": 1920, "fit": fit},
	}
	if len(words) > 0 {
		job["captions"] = map[string]any{"words": words}
	}
	return s.clipper.Submit(ctx, job)
}

type clipResult struct {
	Clips []struct {
		Status    string            `json:"status"`
		Thumbnail json.RawMessage   `json:"thumbnail"`
		Failure   *ProcessorFailure `json:"failure"`
	} `json:"clips"`
	Failure *ProcessorFailure `json:"failure"`
}

func (s *Service) CheckClipRender(ctx context.Context, clipID, jobID string) (*JobCheck, error) {
	clip, err := s.repo.GetClipByID(ctx, clipID)
	if err != nil {
		return nil, err
	}
	if clip == nil {
		return &JobCheck{State: StateFailed}, nil
	}

	// a retried poll after the media was saved must not save it twice
	if clip.Status == "completed" {
		return &JobCheck{State: StateDone}, nil
	}

	job, err := s.clipper.Status(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if job.Status == "pending" {
		return &JobCheck{State: StatePending}, nil
	}
	if job.Status == "failed" {
		return &JobCheck{State: StateRetry}, nil
	}

	result := decodeResult[clipResult](job.Result)
	renderedStatus, renderedThumbnail := "", false
	var failure *ProcessorFailure
	if result != nil {
		if len(result.Clips) > 0 {
			renderedStatus = result.Clips[0].Status
			renderedThumbnail = present(result.Clips[0].Thumbnail)
			failure = result.Clips[0].Failure
		}
		if failure == nil {
			failure = result.Failure
		}
	}
	if renderedStatus != "completed" && failure != nil && failure.Retryable {
		return &JobCheck{State: StateRetry}, nil
	}

	if renderedStatus != "completed" {
		message := "The clip could not be rendered"
		if failure != nil {
			message = failureMessage(failure)
		} else {
			slog.Error("Unexpected render result:", "result", string(job.Result))
		}
		if err := s.FailClip(ctx, clipID, message, true); err != nil {
			return nil, err
		}
		return &JobCheck{State: StateFailed}, nil
	}

	k := clipKeys(clipID)
	org := clip.Edges.Clipping.OrganizationID
	path := s.cloud.PublicURL(k.output)
	thumbnail := ""
	if renderedThumbnail {
		thumbnail = s.cloud.PublicURL(k.thumbnail)
	}

	// the media id is stored before anything else can fail, so a retried poll
	// finishes the same media instead of saving the file a second time
	mediaID := ""
	if clip.MediaID != nil {
		mediaID = *clip.MediaID
	}
	if mediaID == "" {
		saved, err := s.media.SaveFile(ctx, org, k.output, path, clip.Title+".mp4")
		if err != nil {
			return nil, err
		}
		mediaID = saved.ID
		if _, err := s.repo.UpdateClip(ctx, clipID, func(u *ent.ClippingClipUpdateOne) { u.SetMediaID(mediaID) }); err != nil {
			return nil, err
		}
	}

	if thumbnail != "" {
		zero := 0
		if _, err := s.media.SaveMediaInformation(ctx, org, mediadto.SaveMediaInformationDto{
			ID: mediaID, Alt: clip.Title, Thumbnail: &thumbnail, ThumbnailTimestamp: &zero,
		}); err != nil {
			return nil, err
		}
	}

	if _, err := s.repo.UpdateClip(ctx, clipID, func(u *ent.ClippingClipUpdateOne) {
		u.SetStatus("completed").ClearError().SetPath(path)
		if thumbnail != "" {
			u.SetThumbnail(thumbnail)
		}
	}); err != nil {
		return nil, err
	}

	s.removeFiles(ctx, []string{k.source, k.words})
	return &JobCheck{State: StateDone}, nil
}

// FailClip: "customer" says the reason was written for the customer; anything
// else (a provider's answer, a timeout, a stack) is logged and replaced
func (s *Service) FailClip(ctx context.Context, clipID, message string, customer bool) error {
	clip, err := s.repo.GetClipByID(ctx, clipID)
	if err != nil {
		return err
	}
	// the first reason is the specific one (what the media service answered)
	if clip == nil || clip.Status != "pending" {
		return nil
	}

	if !customer {
		slog.Error(fmt.Sprintf("Clip %s failed:", clipID), "error", message)
	}

	s.removeFiles(ctx, clipKeys(clipID).all())
	stored := "The clip could not be rendered"
	if customer {
		stored = sliceRunes(message, 4000)
	}
	_, err = s.repo.UpdateClip(ctx, clipID, func(u *ent.ClippingClipUpdateOne) { u.SetStatus("failed").SetError(stored) })
	return err
}

// removeUnfinishedClipFiles: a clip that did not make it can still have files
// behind it: its workflow died before failClip, or the render uploaded and the
// media was never saved
func (s *Service) removeUnfinishedClipFiles(ctx context.Context, clips []*ent.ClippingClip) {
	for _, clip := range clips {
		if clip.Status != "completed" {
			s.removeFiles(ctx, clipKeys(clip.ID).all())
		}
	}
}

// CreateDrafts turns every rendered clip into a draft on the next free slots
// of the chosen channels; nothing is scheduled without the customer looking
// at it
func (s *Service) CreateDrafts(ctx context.Context, clippingID string) error {
	clipping, err := s.repo.GetClippingByID(ctx, clippingID)
	if err != nil || clipping == nil {
		return err
	}

	var channelIDs []string
	if err := json.Unmarshal([]byte(clipping.Integrations), &channelIDs); err != nil {
		return err
	}
	var channels []*ent.Integration
	for _, id := range channelIDs {
		integration, err := s.integrations.GetIntegrationByID(ctx, clipping.OrganizationID, id)
		if err != nil {
			return err
		}
		if integration != nil && integration.DeletedAt == nil && !integration.Disabled {
			channels = append(channels, integration)
		}
	}
	if len(channels) == 0 {
		return nil
	}

	for _, clip := range clipping.Edges.Clips {
		if clip.Status != "completed" || clip.DraftedAt != nil || clip.Path == nil || *clip.Path == "" {
			continue
		}

		nextTime, err := s.posts.FindFreeDateTime(ctx, clipping.OrganizationID, "")
		if err != nil {
			return err
		}

		// Claimed before any draft exists and never given back: a retry, or an
		// attempt that timed out and is still running, skips the clip. Giving the
		// claim back after a failure would draft again the channels that already
		// got theirs, and a missing draft costs less than a double one: the clip
		// is in the media library either way
		claimed, err := s.repo.ClaimClipDraft(ctx, clip.ID)
		if err != nil {
			return err
		}
		if !claimed {
			continue
		}

		// one channel at a time, so a channel that fails does not take the rest along
		for _, integration := range channels {
			imageID := ids.Make(10)
			if clip.MediaID != nil && *clip.MediaID != "" {
				imageID = *clip.MediaID
			}
			image := mediadto.MediaDto{ID: imageID, Path: *clip.Path}
			if clip.Thumbnail != nil && *clip.Thumbnail != "" {
				image.Thumbnail = *clip.Thumbnail
			}
			entry := CreatePostOne{
				Settings: map[string]any{"__type": integration.ProviderIdentifier},
				Group:    ids.Make(10),
				Value: []CreatePostValue{{
					ID: ids.Make(10), Delay: 0, Content: clip.Content, Image: []mediadto.MediaDto{image},
				}},
			}
			entry.Integration.ID = integration.ID
			if err := s.posts.CreatePost(ctx, clipping.OrganizationID, CreatePostBody{
				Date: nextTime + "Z", Order: ids.Make(10), ShortLink: false, Type: "draft", Tags: []any{},
				Posts: []CreatePostOne{entry},
			}, "UNKNOWN"); err != nil {
				slog.Error(fmt.Sprintf("Could not draft clip %s on channel %s:", clip.ID, integration.ID), "error", err)
			}
		}
	}
	return nil
}

func (s *Service) FinishClipping(ctx context.Context, clippingID string) error {
	clipping, err := s.repo.GetClippingByID(ctx, clippingID)
	if err != nil || clipping == nil {
		return err
	}

	if !slices.ContainsFunc(clipping.Edges.Clips, func(c *ent.ClippingClip) bool { return c.Status == "completed" }) {
		return s.FailClipping(ctx, clippingID, "No clip could be rendered", true)
	}

	if err := s.repo.FailUnfinishedClips(ctx, clippingID, "The clip could not be rendered"); err != nil {
		return err
	}

	k := clippingKeys(clippingID)
	s.removeFiles(ctx, []string{k.transcript, k.audio})
	s.removeUnfinishedClipFiles(ctx, clipping.Edges.Clips)
	_, err = s.repo.UpdateClipping(ctx, clipping.OrganizationID, clippingID, func(u *ent.ClippingUpdateOne) {
		u.SetStatus("completed").ClearError()
	})
	return err
}

// FailClipping gives the minutes back only when the customer got nothing for
// them
func (s *Service) FailClipping(ctx context.Context, clippingID, message string, customer bool) error {
	clipping, err := s.repo.GetClippingByID(ctx, clippingID)
	if err != nil || clipping == nil {
		return err
	}

	if !customer {
		slog.Error(fmt.Sprintf("Clipping %s failed:", clippingID), "error", message)
	}

	k := clippingKeys(clippingID)
	s.removeFiles(ctx, []string{k.transcript, k.audio})
	s.removeUnfinishedClipFiles(ctx, clipping.Edges.Clips)

	if err := s.repo.FailUnfinishedClips(ctx, clippingID, "The clip could not be rendered"); err != nil {
		return err
	}

	rendered := slices.ContainsFunc(clipping.Edges.Clips, func(c *ent.ClippingClip) bool { return c.Status == "completed" })
	// the charge carries the id of the clipping, so it is found even when the
	// poll that made it died before it could store creditsId
	if !rendered {
		if err := s.subscriptions.RefundCredits(ctx, clipping.OrganizationID, clippingID); err != nil {
			return err
		}
	}

	stored := somethingWentWrong
	switch {
	case customer:
		stored = sliceRunes(message, 4000)
	case rendered:
		stored = "Something went wrong after the clips were made."
	}
	_, err = s.repo.UpdateClipping(ctx, clipping.OrganizationID, clippingID, func(u *ent.ClippingUpdateOne) {
		u.SetError(stored)
		if rendered {
			u.SetStatus("completed")
		} else {
			u.SetStatus("failed").ClearCreditsID()
		}
	})
	return err
}
