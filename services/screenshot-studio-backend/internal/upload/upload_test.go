package upload

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

var pngHeader = []byte("\x89PNG\r\n\x1A\n\x00\x00\x00\rIHDR")

func message(t *testing.T, err error) string {
	t.Helper()
	var httpErr *httpx.Error
	if !errors.As(err, &httpErr) || httpErr.Status != 400 {
		t.Fatalf("want a 400, got %v", err)
	}
	return httpErr.Message()
}

func TestDetectFileType(t *testing.T) {
	ftyp := func(brand string) []byte {
		return append([]byte("\x00\x00\x00\x18ftyp"), []byte(brand+"\x00\x00\x00\x00")...)
	}
	cases := map[string][]byte{
		"image/jpeg":      []byte("\xFF\xD8\xFF\xE0"),
		"image/png":       pngHeader,
		"image/gif":       []byte("GIF89a"),
		"image/webp":      []byte("RIFF\x00\x00\x00\x00WEBPVP8 "),
		"audio/wav":       []byte("RIFF\x00\x00\x00\x00WAVEfmt "),
		"video/mp4":       ftyp("isom"),
		"video/quicktime": ftyp("qt  "),
		"image/avif":      ftyp("avif"),
		"audio/mpeg":      []byte("ID3\x04\x00"),
	}
	for want, data := range cases {
		if got := DetectFileType(data); got == nil || got.Mime != want {
			t.Errorf("%s: got %+v", want, got)
		}
	}
	if got := DetectFileType([]byte("<svg xmlns=")); got != nil {
		t.Errorf("svg must not be detected, got %+v", got)
	}
}

func TestGetMaxSize(t *testing.T) {
	if n, _ := GetMaxSize("image/png"); n != 10<<20 {
		t.Errorf("image cap %d", n)
	}
	if n, _ := GetMaxSize("video/mp4"); n != 1<<30 {
		t.Errorf("video cap %d", n)
	}
	_, err := GetMaxSize("audio/mpeg")
	if got := message(t, err); got != "Unsupported file type." {
		t.Errorf("got %q", got)
	}
}

type memStorage struct {
	stored  []byte
	removed []string
}

func (m *memStorage) UploadSimple(context.Context, string) (string, error) { return "", nil }
func (m *memStorage) UploadFile(context.Context, File) (*UploadedStream, error) {
	return nil, nil
}
func (m *memStorage) UploadStream(_ context.Context, body io.Reader, mimetype, ext string) (*UploadedStream, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return nil, errors.New("wrapped by the storage client")
	}
	m.stored = data
	return &UploadedStream{Filename: "key." + ext, Path: "https://cdn/key." + ext, Mimetype: mimetype, Originalname: "key." + ext}, nil
}
func (m *memStorage) RemoveFile(_ context.Context, path string) error {
	m.removed = append(m.removed, path)
	return nil
}

func TestUploadStreamToStorage(t *testing.T) {
	ctx := context.Background()
	storage := &memStorage{}

	body := append(append([]byte{}, pngHeader...), bytes.Repeat([]byte{1}, 5000)...)
	uploaded, err := UploadStreamToStorage(ctx, storage, bytes.NewReader(body), 0)
	if err != nil || uploaded.Ext != "png" || !bytes.Equal(storage.stored, body) {
		t.Fatalf("png upload: %+v %v", uploaded, err)
	}

	_, err = UploadStreamToStorage(ctx, storage, strings.NewReader("<html>"), 0)
	if got := message(t, err); got != "Unsupported file type." {
		t.Errorf("html: %q", got)
	}
	_, err = UploadStreamToStorage(ctx, storage, bytes.NewReader([]byte("ID3\x04\x00")), 0)
	if got := message(t, err); got != "Unsupported file type." {
		t.Errorf("audio is not allowed in the media library: %q", got)
	}
	_, err = UploadStreamToStorage(ctx, storage, bytes.NewReader(pngHeader), 11<<20)
	if got := message(t, err); got != "File is too large." {
		t.Errorf("declared size: %q", got)
	}
	// a lying Content-Length is caught by the stream cap, whatever the storage wraps it in
	big := io.MultiReader(bytes.NewReader(pngHeader), io.LimitReader(zeros{}, 10<<20))
	_, err = UploadStreamToStorage(ctx, storage, big, 0)
	if got := message(t, err); got != "File is too large." {
		t.Errorf("stream cap: %q", got)
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestParseDataURL(t *testing.T) {
	data, mime, ok := ParseDataURL("data:image/png;base64,aGVsbG8")
	if !ok || mime != "image/png" || string(data) != "hello" {
		t.Errorf("base64: %q %q %v", data, mime, ok)
	}
	data, mime, ok = ParseDataURL("data:,a%20b")
	if !ok || mime != "application/octet-stream" || string(data) != "a b" {
		t.Errorf("plain: %q %q %v", data, mime, ok)
	}
	if _, _, ok := ParseDataURL("https://x"); ok {
		t.Error("not a data url")
	}
}

func TestLocalStorageRejectsUnsafeContent(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FRONTEND_URL", "https://app")
	s := NewLocalStorage(dir)
	ctx := context.Background()

	if _, err := s.UploadSimple(ctx, "data:image/png;base64,PHN2Zz4="); err == nil || err.Error() != "Unsupported file type." {
		t.Errorf("svg disguised as png: %v", err)
	}
	if _, err := s.UploadSimple(ctx, "http://127.0.0.1/x.png"); err == nil || err.Error() != "Unsafe URL" {
		t.Errorf("private url: %v", err)
	}

	url, err := s.UploadSimple(ctx, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==")
	if err != nil || !strings.HasPrefix(url, "https://app/uploads/") || !strings.HasSuffix(url, ".png") {
		t.Fatalf("png: %q %v", url, err)
	}
	local := dir + strings.TrimPrefix(url, "https://app/uploads")
	if _, err := os.Stat(local); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveFile(ctx, url); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Clean(local)); !os.IsNotExist(err) {
		t.Errorf("file not removed: %v", err)
	}
}

func TestReceiveFile(t *testing.T) {
	build := func(fill func(w *multipart.Writer)) *bytes.Buffer {
		var body bytes.Buffer
		w := multipart.NewWriter(&body)
		fill(w)
		w.Close()
		return &body
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_ = w.WriteField("preventSave", "true")
	part, _ := w.CreateFormFile("file", "dir/My photo.final.PNG")
	part.Write(pngHeader)
	w.Close()
	req := httptest.NewRequest("POST", "/media/upload-simple", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())

	storage := &memStorage{}
	file, fields, err := ReceiveFile(context.Background(), storage, req, "file")
	if err != nil || file == nil {
		t.Fatalf("%v %v", file, err)
	}
	if file.Originalname != "My photo.final.png" || file.Path != "https://cdn/key.png" || fields["preventSave"] != "true" {
		t.Errorf("got %+v %v", file, fields)
	}

	other := build(func(w *multipart.Writer) {
		p, _ := w.CreateFormFile("file", "a.png")
		p.Write(pngHeader)
		p, _ = w.CreateFormFile("file", "b.png")
		p.Write(pngHeader)
	})
	req = httptest.NewRequest("POST", "/", other)
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundaryOf(other))
	storage = &memStorage{}
	_, _, err = ReceiveFile(context.Background(), storage, req, "file")
	if got := message(t, err); got != "Unexpected field" || len(storage.removed) != 1 {
		t.Errorf("second file: %q removed=%v", got, storage.removed)
	}

	req = httptest.NewRequest("POST", "/", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	if file, _, err := ReceiveFile(context.Background(), storage, req, "file"); file != nil || err != nil {
		t.Errorf("not multipart: %v %v", file, err)
	}
}

func boundaryOf(body *bytes.Buffer) string {
	line, _, _ := strings.Cut(body.String(), "\r\n")
	return strings.TrimPrefix(line, "--")
}

func TestSafeOriginalName(t *testing.T) {
	if got := safeOriginalName("", "mp4"); got != "upload.mp4" {
		t.Error(got)
	}
	if got := safeOriginalName(".png", "png"); got != "upload.png" {
		t.Error(got)
	}
	if got := safeOriginalName(strings.Repeat("a", 150)+".jpg", "jpg"); got != strings.Repeat("a", 100)+".jpg" {
		t.Error(got)
	}
}

func TestNormalizeExtension(t *testing.T) {
	t.Setenv("STORAGE_PROVIDER", "local")
	if normalizeExtension("clip.MOV") != "" || normalizeExtension("a.JPG") != ".jpg" || normalizeExtension(".png") != "" {
		t.Error("extension rules")
	}
	t.Setenv("STORAGE_PROVIDER", "cloudflare")
	t.Setenv("RUNPOD_API_KEY", "k")
	t.Setenv("RUNPOD_ENDPOINT_ID", "e")
	if normalizeExtension("clip.MOV") != ".mov" {
		t.Error(".mov is allowed with the normalizer")
	}
}

func TestRunPodMediaProcessor(t *testing.T) {
	var gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		switch r.URL.Path {
		case "/ep/run":
			data, _ := io.ReadAll(r.Body)
			gotBody = string(data)
			w.Write([]byte(`{"id":"job-1"}`))
		case "/ep/status/job-1":
			w.Write([]byte(`{"status":"COMPLETED","output":{"version":1,"reference":"r","status":"completed","actions":["transcode"]}}`))
		case "/ep/status/job-2":
			w.Write([]byte(`{"status":"TIMED_OUT"}`))
		default:
			w.WriteHeader(500)
			w.Write([]byte("boom"))
		}
	}))
	defer srv.Close()
	old := runpodBaseURL
	runpodBaseURL = srv.URL + "/"
	defer func() { runpodBaseURL = old }()

	p := NewRunPodMediaProcessor[MediaProcessorJob, MediaProcessorResult]("key", "ep")
	ctx := context.Background()
	id, err := p.Submit(ctx, MediaProcessorJob{Version: 1, Type: "video", Reference: "r"})
	if err != nil || id != "job-1" || gotAuth != "Bearer key" || !strings.HasPrefix(gotBody, `{"input":{"version":1,"type":"video"`) {
		t.Fatalf("submit: %q %v %q %q", id, err, gotAuth, gotBody)
	}
	status, err := p.Status(ctx, "job-1")
	if err != nil || status.Status != "completed" || status.Result.Actions[0] != "transcode" {
		t.Fatalf("status: %+v %v", status, err)
	}
	if status, _ := p.Status(ctx, "job-2"); status.Status != "failed" || status.Error != "TIMED_OUT" {
		t.Errorf("failed: %+v", status)
	}
	if _, err := p.Status(ctx, "job-3"); err == nil || err.Error() != "RunPod 500: boom" {
		t.Errorf("error: %v", err)
	}
}

func TestHandleR2UploadRejections(t *testing.T) {
	router := httpx.NewRouter()
	router.Group("/media").Post("/:endpoint", func(c *httpx.Ctx) (any, error) {
		return HandleR2Upload(c.R.Context(), c, c.Param("endpoint"))
	})

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/media/create-multipart-upload", strings.NewReader(`{"file":{"name":"x.svg"}}`)))
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "Unsupported file type.") {
		t.Errorf("svg: %d %s", rec.Code, rec.Body)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("POST", "/media/nope", strings.NewReader(`{}`)))
	if rec.Code != 404 || rec.Body.Len() != 0 {
		t.Errorf("unknown endpoint: %d %s", rec.Code, rec.Body)
	}
}
