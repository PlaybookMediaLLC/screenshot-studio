package content

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strconv"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	mediadto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/media"
	videodto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/videos"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

type mediaController struct {
	media         *media.Service
	subscriptions *subscriptions.Service
	storage       Uploader
}

// RegisterMediaController registers MediaController (/media) behind the auth
// middleware.
func RegisterMediaController(r *httpx.Router, authMiddleware httpx.Middleware, mediaService *media.Service,
	subscriptionService *subscriptions.Service, storage Uploader) {
	h := &mediaController{media: mediaService, subscriptions: subscriptionService, storage: storage}
	g := r.Group("/media", authMiddleware)
	g.Delete("/:id", h.deleteMedia)
	g.Post("/generate-video", h.generateVideo)
	g.Post("/generate-image", h.generateImage)
	g.Post("/generate-image-with-prompt", h.generateImageFromText)
	g.Post("/upload-server", h.uploadServer)
	g.Post("/save-media", h.saveMedia)
	g.Post("/information", h.saveMediaInformation)
	g.Post("/upload-simple", h.uploadSimple)
	g.Post("/:endpoint", h.uploadFile, httpx.Raw())
	g.Get("/:id/status", h.getMediaStatus)
	g.Get("/", h.getMedia)
	g.Get("/video-options", h.getVideos)
	g.Post("/video/function", h.videoFunction)
	g.Get("/generate-video/:type/allowed", h.generateVideoAllowed)
}

func (h *mediaController) deleteMedia(c *httpx.Ctx) (any, error) {
	return nullable(h.media.DeleteMedia(c.R.Context(), c.Org.ID, c.Param("id")))
}

func (h *mediaController) generateVideo(c *httpx.Ctx) (any, error) {
	var body videodto.VideoDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	saved, err := h.media.GenerateVideo(c.R.Context(), c.Org, media.VideoDto{
		Type: body.Type, Output: body.Output, CustomParams: body.CustomParams,
	})
	return nullable(saved, subscriptionError(err))
}

func promptBody(c *httpx.Ctx) (string, error) {
	var body struct {
		Prompt string `json:"prompt"`
	}
	err := c.Decode(&body)
	return body.Prompt, err
}

// generate is generateImage(org, req, prompt, isPicturePrompt): "" is the
// `false` answer when the organization has no credits left.
func (h *mediaController) generate(ctx context.Context, org *ent.Organization, prompt string, isPicturePrompt bool) (string, error) {
	total, err := h.subscriptions.CheckCredits(ctx, org, "ai_images")
	if err != nil {
		return "", err
	}
	if os.Getenv("STRIPE_PUBLISHABLE_KEY") != "" && total.Credits <= 0 {
		return "", nil
	}
	image, err := h.media.GenerateImage(ctx, prompt, org, isPicturePrompt)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + image, nil
}

func (h *mediaController) generateImage(c *httpx.Ctx) (any, error) {
	prompt, err := promptBody(c)
	if err != nil {
		return nil, err
	}
	output, err := h.generate(c.R.Context(), c.Org, prompt, false)
	if err != nil || output == "" {
		return false, err
	}
	return map[string]string{"output": output}, nil
}

func (h *mediaController) generateImageFromText(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	prompt, err := promptBody(c)
	if err != nil {
		return nil, err
	}
	output, err := h.generate(ctx, c.Org, prompt, true)
	if err != nil || output == "" {
		return false, err
	}

	file, err := h.storage.UploadSimple(ctx, output)
	if err != nil {
		return nil, err
	}
	return nullable(h.media.SaveFile(ctx, c.Org.ID, lastSegment(file), file, ""))
}

// receiveFile is @UseInterceptors(FileInterceptor('file', ...)) +
// @UploadedFile() with the "No file provided" check.
func receiveFile(c *httpx.Ctx, storage Uploader) (*UploadedFile, map[string]string, error) {
	file, fields, err := storage.ReceiveFile(c.R.Context(), c.R, "file")
	if err != nil {
		return nil, nil, err
	}
	if file == nil {
		return nil, nil, httpx.BadRequest("No file provided")
	}
	return file, fields, nil
}

func (h *mediaController) uploadServer(c *httpx.Ctx) (any, error) {
	file, _, err := receiveFile(c, h.storage)
	if err != nil {
		return nil, err
	}
	return nullable(h.media.SaveFile(c.R.Context(), c.Org.ID, file.Filename, file.Path, file.Originalname))
}

func (h *mediaController) saveMedia(c *httpx.Ctx) (any, error) {
	var body struct {
		Name         string `json:"name"`
		OriginalName string `json:"originalName"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	if body.Name == "" {
		return false, nil
	}
	return nullable(h.media.SaveFile(c.R.Context(), c.Org.ID, body.Name, os.Getenv("CLOUDFLARE_BUCKET_URL")+"/"+body.Name, body.OriginalName))
}

func (h *mediaController) saveMediaInformation(c *httpx.Ctx) (any, error) {
	var body mediadto.SaveMediaInformationDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return nullable(h.media.SaveMediaInformation(c.R.Context(), c.Org.ID, body))
}

func (h *mediaController) uploadSimple(c *httpx.Ctx) (any, error) {
	file, fields, err := receiveFile(c, h.storage)
	if err != nil {
		return nil, err
	}
	if fields["preventSave"] == "true" {
		return map[string]string{"path": file.Path}, nil
	}
	return nullable(h.media.SaveFile(c.R.Context(), c.Org.ID, file.Filename, file.Path, file.Originalname))
}

func (h *mediaController) uploadFile(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	endpoint := c.Param("endpoint")
	upload, err := h.storage.HandleR2Upload(ctx, c, endpoint)
	if err != nil {
		return nil, err
	}
	// a rejected or failed completion has already answered with its own status
	if endpoint != "complete-multipart-upload" || c.Written() {
		return nil, nil
	}

	location, ok := upload["Location"].(string)
	if !ok {
		return nil, errors.New("TypeError: Cannot read properties of undefined (reading 'split')")
	}
	var body struct {
		File struct {
			Name string `json:"name"`
		} `json:"file"`
	}
	_ = c.Decode(&body)

	saved, err := h.media.SaveUploadedFile(ctx, c.Org.ID, lastSegment(location), location, body.File.Name)
	if err != nil {
		return nil, err
	}

	out := make(map[string]any, len(upload)+1)
	for k, v := range upload {
		out[k] = v
	}
	out["saved"] = saved
	c.JSON(http.StatusOK, out)
	return nil, nil
}

func (h *mediaController) getMediaStatus(c *httpx.Ctx) (any, error) {
	return nullable(h.media.GetMediaStatus(c.R.Context(), c.Org.ID, c.Param("id")))
}

// queryPage is `@Query('page') page: number`: a non-numeric value is NaN,
// which the services read as the first page like a missing one.
func queryPage(c *httpx.Ctx) int {
	page, _ := strconv.ParseFloat(c.Query("page"), 64)
	return int(page)
}

func (h *mediaController) getMedia(c *httpx.Ctx) (any, error) {
	return nullable(h.media.GetMedia(c.R.Context(), c.Org.ID, queryPage(c), c.Query("search")))
}

func (h *mediaController) getVideos(c *httpx.Ctx) (any, error) {
	return h.media.GetVideoOptions(), nil
}

func (h *mediaController) videoFunction(c *httpx.Ctx) (any, error) {
	var body videodto.VideoFunctionDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	return h.media.VideoFunction(c.R.Context(), *body.Identifier, *body.FunctionName, body.Params)
}

func (h *mediaController) generateVideoAllowed(c *httpx.Ctx) (any, error) {
	return h.media.GenerateVideoAllowed(c.Org, c.Param("type"))
}

// uploadTickets adapts media.Service to the auth package's ticket lookup.
type uploadTickets struct{ media *media.Service }

func (t uploadTickets) GetUploadTicket(ctx context.Context, ticket string) (*auth.UploadTicket, error) {
	found, err := t.media.GetUploadTicket(ctx, ticket)
	if err != nil || found == nil {
		return nil, err
	}
	return &auth.UploadTicket{Org: found.Org, SessionID: found.SessionID}, nil
}

type mediaWidgetController struct {
	media   *media.Service
	storage Uploader
}

// RegisterMediaWidgetController registers MediaWidgetController
// (/media-widget) behind UploadWidgetAuthMiddleware.
func RegisterMediaWidgetController(r *httpx.Router, mediaService *media.Service, storage Uploader) {
	h := &mediaWidgetController{media: mediaService, storage: storage}
	g := r.Group("/media-widget", auth.UploadWidgetAuthMiddleware(uploadTickets{mediaService}))
	g.Post("/upload", h.upload)
	g.Get("/status", h.status)
}

func (h *mediaWidgetController) upload(c *httpx.Ctx) (any, error) {
	file, _, err := receiveFile(c, h.storage)
	if err != nil {
		return nil, err
	}
	return nullable(h.media.SaveUploadSessionFile(c.R.Context(), c.Org.ID, auth.UploadSession(c), file.Filename, file.Path, file.Originalname))
}

func (h *mediaWidgetController) status(c *httpx.Ctx) (any, error) {
	return h.media.GetUploadSession(c.R.Context(), c.Org.ID, auth.UploadSession(c))
}
