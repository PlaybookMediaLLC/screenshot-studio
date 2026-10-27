package content

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
)

// fakeUploader stores nothing: it reads the multipart form with the stdlib
// and reports a fixed storage location.
type fakeUploader struct{}

func (fakeUploader) UploadSimple(context.Context, string) (string, error) {
	return "https://cdn.example/generated.png", nil
}

func (fakeUploader) ReceiveFile(_ context.Context, r *http.Request, field string) (*UploadedFile, map[string]string, error) {
	fields := map[string]string{}
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		if errors.Is(err, http.ErrNotMultipart) {
			return nil, fields, nil
		}
		return nil, nil, err
	}
	for k, v := range r.MultipartForm.Value {
		fields[k] = v[0]
	}
	files := r.MultipartForm.File[field]
	if len(files) == 0 {
		return nil, fields, nil
	}
	return &UploadedFile{Filename: "stored.png", Path: "https://cdn.example/stored.png", Mimetype: "image/png", Originalname: files[0].Filename}, fields, nil
}

func (fakeUploader) HandleR2Upload(_ context.Context, c *httpx.Ctx, endpoint string) (map[string]any, error) {
	if endpoint != "complete-multipart-upload" {
		c.JSON(http.StatusOK, map[string]string{"uploadId": "u"})
		return nil, nil
	}
	return map[string]any{"Location": "https://cdn.example/folder/video.mp4", "Key": "video.mp4"}, nil
}

func multipartRequest(t *testing.T, target string, fields map[string]string, file string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	if file != "" {
		part, _ := w.CreateFormFile("file", file)
		_, _ = part.Write([]byte("\x89PNG\r\n\x1a\n"))
	}
	_ = w.Close()
	req := httptest.NewRequest(http.MethodPost, target, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

func TestMediaUploadMultipart(t *testing.T) {
	ctx := context.Background()
	c := dbtest.Open(t)
	org := c.Organization.Create().SetName("Org").SaveX(ctx)
	svc := media.NewService(media.NewRepository(c), nil, nil, nil, nil, redis.NewMemory(), nil, nil)
	r := httpx.NewRouter()
	RegisterMediaController(r, as(&ent.User{ID: "u"}, org), svc, nil, fakeUploader{})

	res := do(t, r, multipartRequest(t, "/media/upload-server", nil, "photo.png"))
	if res.status != 201 {
		t.Fatalf("%d %s", res.status, res.body)
	}
	saved := res.json(t)
	if saved["name"] != "stored.png" || saved["path"] != "https://cdn.example/stored.png" || saved["originalName"] != "photo.png" {
		t.Fatalf("saved %s", res.body)
	}
	if n := c.Media.Query().CountX(ctx); n != 1 {
		t.Fatalf("media rows %d", n)
	}

	res = do(t, r, multipartRequest(t, "/media/upload-simple", map[string]string{"preventSave": "true"}, "photo.png"))
	if res.status != 201 || res.body != `{"path":"https://cdn.example/stored.png"}` {
		t.Fatalf("preventSave: %d %s", res.status, res.body)
	}

	res = do(t, r, multipartRequest(t, "/media/upload-simple", nil, ""))
	if res.status != 400 || res.body != `{"message":"No file provided","error":"Bad Request","statusCode":400}` {
		t.Fatalf("no file: %d %s", res.status, res.body)
	}

	res = do(t, r, jsonRequest(http.MethodPost, "/media/complete-multipart-upload", `{"file":{"name":"clip.mp4"}}`))
	if res.status != 200 {
		t.Fatalf("complete: %d %s", res.status, res.body)
	}
	var completed struct {
		Location string         `json:"Location"`
		Saved    map[string]any `json:"saved"`
	}
	_ = json.Unmarshal([]byte(res.body), &completed)
	if completed.Location == "" || completed.Saved["name"] != "video.mp4" || completed.Saved["originalName"] != "clip.mp4" {
		t.Fatalf("complete body %s", res.body)
	}

	if res := do(t, r, jsonRequest(http.MethodPost, "/media/create-multipart-upload", `{}`)); res.status != 200 || res.body != `{"uploadId":"u"}` {
		t.Fatalf("passthrough: %d %s", res.status, res.body)
	}

	// the widget authenticates with a ticket and saves into the upload session
	session, _ := svc.CreateUploadSession(ctx, org.ID)
	ticket, _ := svc.CreateUploadTicket(ctx, org.ID, session)
	w := httpx.NewRouter()
	RegisterMediaWidgetController(w, svc, fakeUploader{})
	if res := do(t, w, multipartRequest(t, "/media-widget/upload?ticket=nope", nil, "a.png")); res.status != 401 {
		t.Fatalf("widget ticket: %d %s", res.status, res.body)
	}
	if res := do(t, w, multipartRequest(t, "/media-widget/upload?ticket="+ticket, nil, "a.png")); res.status != 201 {
		t.Fatalf("widget upload: %d %s", res.status, res.body)
	}
	res = do(t, w, httptest.NewRequest(http.MethodGet, "/media-widget/status?ticket="+ticket, nil))
	var list []map[string]any
	if err := json.Unmarshal([]byte(res.body), &list); err != nil || len(list) != 1 || list[0]["originalName"] != "a.png" {
		t.Fatalf("widget status: %d %s", res.status, res.body)
	}
}

type noCredits struct{}

func (noCredits) UseCredit(context.Context, *ent.Organization, string, func(context.Context) (any, error)) (any, error) {
	return nil, errors.New("unexpected")
}
func (noCredits) CheckCredits(context.Context, *ent.Organization, string) (int, error) { return 0, nil }

func TestGenerateVideoSubscriptionRequired(t *testing.T) {
	t.Setenv("EVOLINK_API_KEY", "k")
	t.Setenv("FRONTEND_URL", "https://app.example")
	svc := media.NewService(media.NewRepository(nil), nil, noCredits{}, nil, nil, redis.NewMemory(), nil, nil)
	r := httpx.NewRouter()
	RegisterMediaController(r, as(&ent.User{ID: "u"}, &ent.Organization{ID: "org"}), svc, nil, fakeUploader{})

	res := do(t, r, jsonRequest(http.MethodPost, "/media/generate-video", `{"type":"seedance","output":"vertical"}`))
	want := `{"statusCode":402,"message":"You have reached the maximum number of generated videos for your subscription. Please upgrade your subscription to generate more videos.","url":"https://app.example/billing"}`
	if res.status != 402 || res.body != want {
		t.Fatalf("%d %s", res.status, res.body)
	}

	res = do(t, r, jsonRequest(http.MethodPost, "/media/generate-video", `{"type":"seedance","output":"square"}`))
	if res.status != 400 {
		t.Fatalf("validation: %d %s", res.status, res.body)
	}
}
