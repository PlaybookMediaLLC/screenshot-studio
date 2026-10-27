package media

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	mediadto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// SubscriptionError is the backend's SubscriptionException: the backend
// renders it as 402 with body {section, action}.
type SubscriptionError struct {
	Section string `json:"section"`
	Action  string `json:"action"`
}

func (e *SubscriptionError) Error() string {
	return fmt.Sprintf("subscription required: %s %s", e.Action, e.Section)
}

// Sections and AuthorizationActions used by the media and clipping services.
const (
	SectionVideosPerMonth  = "videos_per_month"
	SectionClippingMinutes = "clipping_minutes"
	ActionCreate           = "create"
)

// OpenAI is the part of openai.Service media uses.
type OpenAI interface {
	GeneratePromptForPicture(ctx context.Context, prompt string) (string, error)
	// GenerateImage returns the base64 image.
	GenerateImage(ctx context.Context, prompt string, isVertical bool) (string, error)
}

// Subscriptions is the part of subscriptions.Service media uses.
type Subscriptions interface {
	UseCredit(ctx context.Context, org *ent.Organization, creditType string, fn func(context.Context) (any, error)) (any, error)
	CheckCredits(ctx context.Context, org *ent.Organization, creditType string) (int, error)
}

// Video is one registered video generator (VideoParams & {instance}).
type Video interface {
	Trial() bool
	ProcessAndValidate(ctx context.Context, customParams json.RawMessage) error
	// Process returns the URL of the generated video.
	Process(ctx context.Context, output string, customParams json.RawMessage) (string, error)
	// Function returns an @ExposeVideoFunction method, or nil when the
	// instance has no exposed function of that name.
	Function(name string) func(ctx context.Context, body json.RawMessage) (any, error)
}

// VideoManager is the part of videos.Manager media uses.
type VideoManager interface {
	GetAllVideos() any
	// GetVideoByName returns a nil interface for an unknown identifier.
	GetVideoByName(identifier string) Video
}

// UploadedStream is upload's UploadedStream.
type UploadedStream struct {
	Filename     string
	OriginalName string
	Path         string
	MimeType     string
}

// Storage is the part of the upload storage (UploadFactory.createStorage())
// media uses, plus uploadStreamToStorage
// bound to it: sniff the type, enforce the per-type cap, stream to storage.
type Storage interface {
	UploadSimple(ctx context.Context, path string) (string, error)
	RemoveFile(ctx context.Context, filePath string) error
	UploadStreamToStorage(ctx context.Context, body io.Reader, declaredSize int64) (*UploadedStream, error)
}

// Presigner is the optional signDownloadUrl/signUploadUrl of cloud storage.
type Presigner interface {
	SignDownloadURL(ctx context.Context, fileName string) (string, error)
	SignUploadURL(ctx context.Context, fileName, contentType string) (string, error)
}

// ProcessorStatus is MediaProcessorStatus: pending, completed (Result is the
// raw result JSON) or failed (Error).
type ProcessorStatus struct {
	Status string
	Result json.RawMessage
	Error  string
}

// Processor is IMediaProcessor (UploadFactory.createProcessor()); the job is
// sent as JSON.
type Processor interface {
	Submit(ctx context.Context, job any) (string, error)
	Status(ctx context.Context, jobID string) (*ProcessorStatus, error)
}

// VideoDto is dtos/videos VideoDto.
type VideoDto struct {
	Type         string          `json:"type"`
	Output       string          `json:"output"`
	CustomParams json.RawMessage `json:"customParams,omitempty"`
}

// What every upload is normalized to before a provider ever sees it. The
// service applies exactly these, so a platform-specific need belongs in the
// provider, not here.
var videoRules = map[string]any{
	"short_side_min": 1080,
	"short_side_max": 1080,
	"long_side_max":  1920,
	"video": map[string]any{
		"container":          "mp4",
		"video_codec":        "h264",
		"profile":            "high",
		"pixel_format":       "yuv420p",
		"fps_max":            60,
		"quality":            23,
		"audio_codec":        "aac",
		"audio_bitrate_kbps": 128,
		"audio_sample_rate":  48000,
		"faststart":          true,
	},
}

var imageRules = map[string]any{
	"short_side_min": 1,
	"short_side_max": 1080,
	"long_side_max":  1920,
	"image":          map[string]any{"jpeg_quality": 90, "keep_format": true},
}

var limits = map[string]any{
	"max_input_bytes":      1073741824,
	"max_duration_seconds": 900,
	"timeout_seconds":      1200,
}

type processable struct{ typ, ext, contentType string }

// Extension of the normalized file and the content type the presigned PUT is
// minted for; anything else (gif, avif, ...) is stored as uploaded
var processableTypes = map[string]processable{
	".mp4":  {"video", "mp4", "video/mp4"},
	".mov":  {"video", "mp4", "video/mp4"},
	".jpg":  {"image", "jpg", "image/jpeg"},
	".jpeg": {"image", "jpg", "image/jpeg"},
	".png":  {"image", "png", "image/png"},
	".webp": {"image", "webp", "image/webp"},
}

// Formats a post can carry without normalization; anything else only exists to be converted
var usableAsIs = map[string]bool{".mp4": true, ".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}

// maxUploadSize is getMaxSize('video/mp4'), the largest per-type cap.
const maxUploadSize = 1024 * 1024 * 1024

// extname is node's path.extname: a leading dot is not an extension.
func extname(name string) string {
	base := path.Base(name)
	i := strings.LastIndex(base, ".")
	if i <= 0 {
		return ""
	}
	return base[i:]
}

type Service struct {
	repo          *Repository
	openai        OpenAI
	subscriptions Subscriptions
	videos        VideoManager
	temporal      client.Client
	store         redis.Store
	storage       Storage
	processor     Processor
}

// NewService: temporal may be nil (no raw client), processor is nil when
// normalization is disabled (UploadFactory.createProcessor() returned null).
func NewService(repo *Repository, openai OpenAI, subscriptions Subscriptions, videos VideoManager, temporal client.Client,
	store redis.Store, storage Storage, processor Processor) *Service {
	return &Service{repo: repo, openai: openai, subscriptions: subscriptions, videos: videos, temporal: temporal,
		store: store, storage: storage, processor: processor}
}

func (s *Service) DeleteMedia(ctx context.Context, org, id string) (*ent.Media, error) {
	return s.repo.DeleteMedia(ctx, org, id)
}

func (s *Service) GetMediaByID(ctx context.Context, id string) (*ent.Media, error) {
	return s.repo.GetMediaByID(ctx, id)
}

// e.g. "400 Your request was rejected by the safety system, safety_violations=[sexual]"
var safetyViolations = regexp.MustCompile(`(?i)safety_violations=\[([^\]]*)\]`)

// Match genuine content-safety rejections by message, NOT by a bare 400 status:
// a 400 can just as easily be an invalid-parameter error, which must not be
// reported to the user as a safety violation.
var safetyMessage = regexp.MustCompile(`(?i)safety system|safety_violations|content[ _]policy|rejected as a result of our safety|moderation`)

// generationError normalizes errors thrown by AI
// generation providers into a clean HTTP error, surfacing the flagged
// categories of a content-safety rejection.
func generationError(err error) error {
	// Preserve errors we already raised intentionally (e.g. SubscriptionException).
	var httpErr *httpx.Error
	var subscription *SubscriptionError
	if errors.As(err, &httpErr) || errors.As(err, &subscription) {
		return err
	}
	message := err.Error()
	if safetyMessage.MatchString(message) {
		detail := ""
		if m := safetyViolations.FindStringSubmatch(message); m != nil && strings.TrimSpace(m[1]) != "" {
			detail = " Flagged categories: " + strings.TrimSpace(m[1]) + "."
		}
		return httpx.HTTPException("Your request was rejected by the AI safety system."+detail+" Please adjust your prompt and try again.", 422)
	}
	// Not a recognized safety rejection (e.g. an invalid-parameter 400) — return
	// a generic message rather than mislabeling it as a content-safety issue.
	// The real reason (a quota, a bad key, ...) is only useful to the operator, so log it
	slog.Error("AI generation failed:", "error", message)
	return httpx.HTTPException("AI generation failed, please try again later.", 500)
}

// GenerateImage returns the generated image (base64).
func (s *Service) GenerateImage(ctx context.Context, prompt string, org *ent.Organization, generatePromptFirst bool) (string, error) {
	generating, err := s.subscriptions.UseCredit(ctx, org, "ai_images", func(ctx context.Context) (any, error) {
		if generatePromptFirst {
			var err error
			if prompt, err = s.openai.GeneratePromptForPicture(ctx, prompt); err != nil {
				return nil, err
			}
			slog.Info("Prompt:", "prompt", prompt)
		}
		return s.openai.GenerateImage(ctx, prompt, false)
	})
	if err != nil {
		return "", generationError(err)
	}
	image, _ := generating.(string)
	return image, nil
}

// UploadFromURL streams the remote body straight into storage: only the
// sniffing prefix and a few upload parts are ever in memory, so a 1 GB video
// does not cost 1 GB of heap
func (s *Service) UploadFromURL(ctx context.Context, org, url string) (*SavedMedia, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, httpx.BadRequest("Failed to fetch URL")
	}
	response, err := ssrf.Client().Do(req)
	if err != nil {
		// Network-level failure (DNS, connection refused, SSRF block, etc.)
		return nil, httpx.BadRequest("Failed to fetch URL")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, httpx.BadRequest("Failed to fetch URL")
	}

	// Cheap early exit when the server declares the size; Content-Length may
	// be absent or wrong, so the stream cap below is what really enforces it.
	// The type isn't known yet (sniffed below), so this uses the largest cap
	declaredSize, _ := strconv.ParseInt(response.Header.Get("Content-Length"), 10, 64)
	if declaredSize > maxUploadSize {
		return nil, httpx.BadRequest("File is too large.")
	}

	uploaded, err := s.storage.UploadStreamToStorage(ctx, response.Body, declaredSize)
	if err != nil {
		return nil, err
	}
	return s.SaveFile(ctx, org, uploaded.OriginalName, uploaded.Path, "")
}

func (s *Service) SaveFile(ctx context.Context, org, fileName, filePath, originalName string) (*SavedMedia, error) {
	return s.repo.SaveFile(ctx, org, fileName, filePath, originalName)
}

// SaveUploadedFile saves an upload and, when a normalizer is configured, hands
// it to the processing workflow; the caller polls getMediaStatus until it is
// ready
func (s *Service) SaveUploadedFile(ctx context.Context, org, fileName, filePath, originalName string) (*SavedMedia, error) {
	media, err := s.SaveFile(ctx, org, fileName, filePath, originalName)
	if err != nil {
		return nil, err
	}
	if _, ok := processableTypes[strings.ToLower(extname(fileName))]; s.processor == nil || !ok || s.temporal == nil {
		return media, nil
	}

	if _, err := s.repo.StartProcessing(ctx, org, media.ID); err != nil {
		return nil, err
	}
	if _, err := s.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                                       "media_" + media.ID,
		TaskQueue:                                temporalx.MainQueue,
		TypedSearchAttributes:                    temporal.NewSearchAttributes(temporalx.OrganizationID.ValueSet(org)),
		WorkflowExecutionErrorWhenAlreadyStarted: true,
	}, "processMediaWorkflow", map[string]string{"mediaId": media.ID}); err != nil {
		// no workflow means nothing will ever flip the status
		return s.releaseUnprocessed(ctx, org, media.ID, media.Name)
	}

	media.Status = "processing"
	return media, nil
}

// releaseUnprocessed lets go of a media the normalizer will not touch. A
// source the platforms accept as-is (mp4, png, ...) becomes ready; one that
// only exists to be converted (mov) is failed, since nothing downstream can
// use it
func (s *Service) releaseUnprocessed(ctx context.Context, org, id, name string) (*SavedMedia, error) {
	data := FinishProcessingData{}
	if !usableAsIs[strings.ToLower(extname(name))] {
		data.Error = "No media processor is available to convert this file"
	}
	if _, err := s.repo.FinishProcessing(ctx, org, id, data); err != nil {
		return nil, err
	}
	return s.repo.GetMediaStatus(ctx, org, id)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateUploadSession is the upload widget (MCP Apps): the session id is what
// the model sees and polls, the ticket is the credential the widget uploads
// with. It is handed to the widget only, so it doesn't end up in the
// conversation
func (s *Service) CreateUploadSession(ctx context.Context, org string) (string, error) {
	sessionID := randomHex(16)
	if err := s.store.Set(ctx, "uploadSession:"+sessionID, org, time.Hour); err != nil {
		return "", err
	}
	return sessionID, nil
}

func (s *Service) checkUploadSession(ctx context.Context, org, sessionID string) error {
	value, ok, err := s.store.Get(ctx, "uploadSession:"+sessionID)
	if err != nil {
		return err
	}
	if !ok || value != org {
		return httpx.HTTPException("Upload session not found or expired", 404)
	}
	return nil
}

func (s *Service) CreateUploadTicket(ctx context.Context, org, sessionID string) (string, error) {
	if err := s.checkUploadSession(ctx, org, sessionID); err != nil {
		return "", err
	}
	ticket := randomHex(32)
	data, _ := json.Marshal(UploadTicket{Org: org, SessionID: sessionID})
	if err := s.store.Set(ctx, "uploadTicket:"+ticket, string(data), 10*time.Minute); err != nil {
		return "", err
	}
	return ticket, nil
}

type UploadTicket struct {
	Org       string `json:"org"`
	SessionID string `json:"sessionId"`
}

// GetUploadTicket returns nil for an unknown ticket. A ticket never outlives
// its session: the file is streamed to storage right after this check, so an
// expired session has to be refused here
func (s *Service) GetUploadTicket(ctx context.Context, ticket string) (*UploadTicket, error) {
	value, ok, err := s.store.Get(ctx, "uploadTicket:"+ticket)
	if err != nil || !ok {
		return nil, err
	}
	var found *UploadTicket
	if err := json.Unmarshal([]byte(value), &found); err != nil || found == nil {
		return nil, err
	}
	session, ok, err := s.store.Get(ctx, "uploadSession:"+found.SessionID)
	if err != nil || !ok || session != found.Org {
		return nil, err
	}
	return found, nil
}

func (s *Service) SaveUploadSessionFile(ctx context.Context, org, sessionID, fileName, filePath, originalName string) (*SavedMedia, error) {
	if err := s.checkUploadSession(ctx, org, sessionID); err != nil {
		return nil, err
	}
	media, err := s.SaveUploadedFile(ctx, org, fileName, filePath, originalName)
	if err != nil {
		return nil, err
	}
	if media == nil {
		return nil, nil
	}
	// a list, so parallel uploads of the same session can't overwrite each other
	if _, err := s.store.RPush(ctx, "uploadSessionMedia:"+sessionID, media.ID); err != nil {
		return nil, err
	}
	if err := s.store.Expire(ctx, "uploadSessionMedia:"+sessionID, time.Hour); err != nil {
		return nil, err
	}
	return media, nil
}

func (s *Service) GetUploadSession(ctx context.Context, org, sessionID string) ([]*SavedMedia, error) {
	if err := s.checkUploadSession(ctx, org, sessionID); err != nil {
		return nil, err
	}
	list, err := s.store.LRange(ctx, "uploadSessionMedia:"+sessionID, 0, -1)
	if err != nil {
		return nil, err
	}
	out := []*SavedMedia{}
	for _, id := range list {
		media, err := s.repo.GetMediaStatus(ctx, org, id)
		if err != nil {
			return nil, err
		}
		if media != nil {
			out = append(out, media)
		}
	}
	return out, nil
}

func (s *Service) GetMediaStatus(ctx context.Context, org, id string) (*SavedMedia, error) {
	media, err := s.repo.GetMediaStatus(ctx, org, id)
	if err != nil {
		return nil, err
	}
	if media == nil {
		return nil, httpx.HTTPException("Media not found", 404)
	}
	return media, nil
}

// normalizedName: the normalized file overwrites the original in place; only
// a container change (mov -> mp4, jpeg -> jpg) lands under a new key. Either
// way the polling side needs nothing but the media record to know where it is
func normalizedName(name string) string {
	ext := strings.ToLower(extname(name))
	return name[:len(name)-len(ext)] + "." + processableTypes[ext].ext
}

// SubmitProcessing returns the processor job id ("" for TypeScript's null);
// when this process has nothing to run the media (already marked processing
// by the upload) is released as ready, so a worker without the processor
// configured never leaves an upload hanging
func (s *Service) SubmitProcessing(ctx context.Context, mediaID string) (string, error) {
	media, err := s.repo.GetMediaByID(ctx, mediaID)
	if err != nil || media == nil {
		return "", err
	}

	p, ok := processableTypes[strings.ToLower(extname(media.Name))]
	presigner, canSign := s.storage.(Presigner)
	if s.processor == nil || !ok || !canSign {
		_, err := s.releaseUnprocessed(ctx, media.OrganizationID, media.ID, media.Name)
		return "", err
	}

	outputName := normalizedName(media.Name)
	source, err := presigner.SignDownloadURL(ctx, media.Name)
	if err != nil {
		return "", err
	}
	output, err := presigner.SignUploadURL(ctx, outputName, p.contentType)
	if err != nil {
		return "", err
	}
	rules := imageRules
	if p.typ == "video" {
		rules = videoRules
	}
	return s.processor.Submit(ctx, map[string]any{
		"version":   1,
		"type":      p.typ,
		"reference": media.ID,
		"source":    map[string]any{"url": source},
		"output":    map[string]any{"url": output, "content_type": p.contentType},
		"rules":     rules,
		"limits":    limits,
	})
}

type processorResult struct {
	Status string `json:"status"`
	Output *struct {
		Bytes int `json:"bytes"`
	} `json:"output"`
	Failure *struct {
		Code       string `json:"code"`
		Message    string `json:"message"`
		StderrTail string `json:"stderr_tail"`
	} `json:"failure"`
}

func sliceRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// CheckProcessing returns true once the record is final. A transport error
// fails so the activity retries the poll; a terminal answer from the queue or
// the service marks the media failed and keeps the original usable
func (s *Service) CheckProcessing(ctx context.Context, mediaID, jobID string) (bool, error) {
	media, err := s.repo.GetMediaByID(ctx, mediaID)
	if err != nil {
		return false, err
	}
	if media == nil {
		return true, nil
	}

	// a retried activity after the record was already finalized must not
	// derive the output key a second time from the rewritten name
	if media.Status != "processing" {
		return true, nil
	}

	org := media.OrganizationID
	if s.processor == nil {
		_, err := s.releaseUnprocessed(ctx, org, mediaID, media.Name)
		return err == nil, err
	}

	job, err := s.processor.Status(ctx, jobID)
	if err != nil {
		return false, err
	}
	if job.Status == "pending" {
		return false, nil
	}

	finish := func(data FinishProcessingData) (bool, error) {
		_, err := s.repo.FinishProcessing(ctx, org, mediaID, data)
		return err == nil, err
	}

	if job.Status == "failed" {
		return finish(FinishProcessingData{Error: job.Error})
	}

	var result *processorResult
	if len(job.Result) > 0 {
		_ = json.Unmarshal(job.Result, &result)
	}
	if result == nil || (result.Status != "completed" && result.Status != "unchanged" && result.Status != "failed") {
		raw := string(job.Result)
		if raw == "" {
			raw = "null"
		}
		return finish(FinishProcessingData{Error: "Unexpected processor result: " + sliceRunes(raw, 500)})
	}

	if result.Status == "failed" {
		// the stderr tail is the only way to know what ffmpeg objected to
		code, message, tail := "FAILED", "", ""
		if result.Failure != nil {
			if result.Failure.Code != "" {
				code = result.Failure.Code
			}
			message, tail = result.Failure.Message, result.Failure.StderrTail
		}
		parts := []string{code + ": " + message}
		if tail != "" {
			parts = append(parts, tail)
		}
		return finish(FinishProcessingData{Error: sliceRunes(strings.Join(parts, "\n"), 4000)})
	}

	if result.Status == "unchanged" {
		return finish(FinishProcessingData{})
	}

	outputName := normalizedName(media.Name)
	data := FinishProcessingData{Name: outputName, Path: media.Path[:strings.LastIndex(media.Path, "/")+1] + outputName}
	if result.Output != nil {
		data.FileSize = result.Output.Bytes
	}
	if _, err := s.repo.FinishProcessing(ctx, org, mediaID, data); err != nil {
		return false, err
	}

	// a same-key output already replaced the original; a stray object after a
	// container change is harmless, so a failed delete never fails the media
	if outputName != media.Name {
		if err := s.storage.RemoveFile(ctx, media.Name); err != nil {
			slog.Error(fmt.Sprintf("Could not remove original media %s:", media.Name), "error", err)
		}
	}
	return true, nil
}

func (s *Service) FailProcessing(ctx context.Context, mediaID, errorMessage string) (*StatusResult, error) {
	media, err := s.repo.GetMediaByID(ctx, mediaID)
	if err != nil || media == nil {
		return nil, err
	}
	return s.repo.FinishProcessing(ctx, media.OrganizationID, mediaID, FinishProcessingData{Error: errorMessage})
}

func (s *Service) GetMedia(ctx context.Context, org string, page int, search string) (*MediaPage, error) {
	return s.repo.GetMedia(ctx, org, page, search)
}

func (s *Service) SaveMediaInformation(ctx context.Context, org string, data mediadto.SaveMediaInformationDto) (*MediaInformation, error) {
	return s.repo.SaveMediaInformation(ctx, org, data)
}

func (s *Service) GetVideoOptions() any { return s.videos.GetAllVideos() }

func (s *Service) GenerateVideoAllowed(org *ent.Organization, typ string) (bool, error) {
	video := s.videos.GetVideoByName(typ)
	if video == nil {
		return false, fmt.Errorf("Video type %s not found", typ)
	}
	if !video.Trial() && org.IsTrailing {
		return false, httpx.HTTPException("This video is not available in trial mode", 406)
	}
	return true, nil
}

func (s *Service) validateVideoRequest(ctx context.Context, org *ent.Organization, body VideoDto) (Video, error) {
	totalCredits, err := s.subscriptions.CheckCredits(ctx, org, "ai_videos")
	if err != nil {
		return nil, err
	}
	if totalCredits <= 0 {
		return nil, &SubscriptionError{Action: ActionCreate, Section: SectionVideosPerMonth}
	}

	video := s.videos.GetVideoByName(body.Type)
	if video == nil {
		return nil, fmt.Errorf("Video type %s not found", body.Type)
	}
	if !video.Trial() && org.IsTrailing {
		return nil, httpx.HTTPException("This video is not available in trial mode", 406)
	}
	if err := video.ProcessAndValidate(ctx, body.CustomParams); err != nil {
		return nil, err
	}
	return video, nil
}

func (s *Service) GenerateVideo(ctx context.Context, org *ent.Organization, body VideoDto) (*SavedMedia, error) {
	video, err := s.validateVideoRequest(ctx, org, body)
	if err != nil {
		return nil, generationError(err)
	}
	result, err := s.subscriptions.UseCredit(ctx, org, "ai_videos", func(ctx context.Context) (any, error) {
		loadedData, err := video.Process(ctx, body.Output, body.CustomParams)
		if err != nil {
			return nil, err
		}
		file, err := s.storage.UploadSimple(ctx, loadedData)
		if err != nil {
			return nil, err
		}
		return s.SaveFile(ctx, org.ID, file[strings.LastIndex(file, "/")+1:], file, "")
	})
	if err != nil {
		return nil, generationError(err)
	}
	media, _ := result.(*SavedMedia)
	return media, nil
}

type VideoJob struct {
	JobID string `json:"jobId"`
}

// StartGenerateVideo: generating a video takes minutes, longer than an MCP
// request can stay open, so the generation runs in a workflow and the caller
// polls its status by job id
func (s *Service) StartGenerateVideo(ctx context.Context, org *ent.Organization, body VideoDto) (*VideoJob, error) {
	// validated here as well as in the workflow so bad input fails before a job exists
	if _, err := s.validateVideoRequest(ctx, org, body); err != nil {
		return nil, generationError(err)
	}
	if s.temporal == nil {
		return nil, httpx.HTTPException("Video generation is not available", 503)
	}

	jobID := fmt.Sprintf("video_%s_%s", org.ID, ids.Make(10))
	if _, err := s.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                                       jobID,
		TaskQueue:                                temporalx.MainQueue,
		TypedSearchAttributes:                    temporal.NewSearchAttributes(temporalx.OrganizationID.ValueSet(org.ID)),
		WorkflowExecutionErrorWhenAlreadyStarted: true,
	}, "generateVideoWorkflow", map[string]any{"organizationId": org.ID, "body": body}); err != nil {
		return nil, err
	}
	return &VideoJob{JobID: jobID}, nil
}

type VideoStatus struct {
	Status string `json:"status"` // pending | completed | failed
	ID     string `json:"id,omitempty"`
	Path   string `json:"path,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (s *Service) GetGenerateVideoStatus(ctx context.Context, org *ent.Organization, jobID string) (*VideoStatus, error) {
	// the job id carries the organization, so one org can't poll another's job
	if !strings.HasPrefix(jobID, "video_"+org.ID+"_") {
		return nil, httpx.HTTPException("Video job not found", 404)
	}
	if s.temporal == nil {
		return nil, errors.New("Temporal client is not available")
	}

	described, err := s.temporal.DescribeWorkflowExecution(ctx, jobID, "")
	if err != nil {
		return nil, httpx.HTTPException("Video job not found", 404)
	}
	if described.GetWorkflowExecutionInfo().GetStatus() == enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING {
		return &VideoStatus{Status: "pending"}, nil
	}

	var media SavedMedia
	if err := s.temporal.GetWorkflow(ctx, jobID, "").Get(ctx, &media); err != nil {
		// the workflow failure wraps the activity failure which wraps the actual error
		cause := err
		for next := errors.Unwrap(cause); next != nil && next != cause; next = errors.Unwrap(cause) {
			cause = next
		}
		message := cause.Error()
		var app *temporal.ApplicationError
		if errors.As(cause, &app) {
			message = app.Message()
		}
		return &VideoStatus{Status: "failed", Error: message}, nil
	}
	return &VideoStatus{Status: "completed", ID: media.ID, Path: media.Path}, nil
}

func (s *Service) VideoFunction(ctx context.Context, identifier, functionName string, body json.RawMessage) (any, error) {
	video := s.videos.GetVideoByName(identifier)
	if video == nil {
		return nil, fmt.Errorf("Video with identifier %s not found", identifier)
	}
	fn := video.Function(functionName)
	if fn == nil {
		return nil, httpx.HTTPException(fmt.Sprintf("Function %s not found on video instance", functionName), 400)
	}
	return fn(ctx, body)
}
