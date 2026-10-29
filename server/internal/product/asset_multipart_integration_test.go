package product

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3mem"
)

// A large video goes to storage in parts through the real S3 client and
// protocol: the browser sends parts, resumes after losing its place, and the
// server joins them only once every part is whole and each part's digest
// matches what the browser read.
func TestLargeUploadsGoInParts(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	bucket := httptest.NewServer(gofakes3.New(s3mem.New(), gofakes3.WithAutoBucket(true)).Server())
	t.Cleanup(bucket.Close)
	store, err := media.NewS3Store(bucket.URL, bucket.URL, "us-east-1", "tenant-assets", "test-key", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	repo := w.repo.WithObjectStore(store)

	// A real movie followed by a free box, to make it two parts long.
	movie, err := os.ReadFile("../mediavideo/testdata/faststart.mp4")
	if err != nil {
		t.Fatal(err)
	}
	padding := make([]byte, uploadPartBytes+1000)
	binary.BigEndian.PutUint32(padding, uint32(len(padding)))
	copy(padding[4:], "free")
	video := append(movie, padding...)
	digests := []string{fmt.Sprintf("%x", sha256.Sum256(video[:uploadPartBytes])), fmt.Sprintf("%x", sha256.Sum256(video[uploadPartBytes:]))}

	reserve := func(t *testing.T, name string) *AssetUploadResult {
		t.Helper()
		upload, err := repo.SignAssetUpload(w.ctx, w.owner, AssetUploadInput{Bytes: len(video), ContentType: "video/mp4", FileName: name, Multipart: true})
		if err != nil {
			t.Fatal(err)
		}
		if upload.UploadURL != "" || upload.Multipart == nil || *upload.Multipart != (AssetMultipart{PartBytes: uploadPartBytes, Parts: 2}) {
			t.Fatalf("upload = %+v", upload)
		}
		return upload
	}
	send := func(t *testing.T, id string, number int, body []byte) []int {
		t.Helper()
		parts, err := repo.SignAssetUploadParts(w.ctx, w.owner, id, []int{number})
		if err != nil {
			t.Fatal(err)
		}
		request, _ := http.NewRequest(http.MethodPut, parts.URLs[0].URL, bytes.NewReader(body))
		response, err := http.DefaultClient.Do(request)
		if err != nil || response.StatusCode != http.StatusOK {
			t.Fatalf("part %d: %v %v", number, response, err)
		}
		response.Body.Close()
		return parts.Uploaded
	}

	t.Run("a resumed upload completes once every part is whole", func(t *testing.T) {
		upload := reserve(t, "clip.mp4")
		id := upload.Asset.ID
		if uploaded := send(t, id, 1, video[:uploadPartBytes]); len(uploaded) != 0 {
			t.Fatalf("uploaded before sending = %v", uploaded)
		}
		// A reload loses the browser's place; storage still knows part 1.
		state, err := repo.SignAssetUploadParts(w.ctx, w.owner, id, nil)
		if err != nil || len(state.Uploaded) != 1 || state.Uploaded[0] != 1 || len(state.URLs) != 0 {
			t.Fatalf("state = %+v, %v", state, err)
		}
		if _, err := repo.CompleteAssetUpload(w.ctx, w.owner, id, nil, digests...); err == nil || !strings.Contains(err.Error(), "1 of 2 parts") {
			t.Fatalf("completion with a part missing: %v", err)
		}
		// A part cut short is not counted as stored.
		send(t, id, 2, video[uploadPartBytes:len(video)-1])
		if _, err := repo.CompleteAssetUpload(w.ctx, w.owner, id, nil, digests...); err == nil || !strings.Contains(err.Error(), "1 of 2 parts") {
			t.Fatalf("completion with a short part: %v", err)
		}
		send(t, id, 2, video[uploadPartBytes:])
		if _, err := repo.CompleteAssetUpload(w.ctx, w.owner, id, nil, digests[0]); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("one digest for two parts: %v", err)
		}
		// Recovery without the browser's digests cannot skip the part check.
		if _, err := repo.CompleteAssetUpload(w.ctx, w.owner, id, nil); err == nil || !strings.Contains(err.Error(), "checksum of each part") {
			t.Fatalf("completion without part digests: %v", err)
		}
		record, err := repo.CompleteAssetUpload(w.ctx, w.owner, id, nil, digests...)
		if err != nil || record.Status != "UPLOADED" {
			t.Fatalf("record = %+v, %v", record, err)
		}
		row := w.db.Client.Asset.GetX(w.ctx, id)
		if row.UploadID != nil || row.DurationMs == nil || *row.DurationMs == 0 || row.Sha256 == nil || *row.Sha256 != fmt.Sprintf("%x", sha256.Sum256(video)) {
			t.Fatalf("row = %+v", row)
		}
		// A replay is answered from the record; the parts are gone.
		if again, err := repo.CompleteAssetUpload(w.ctx, w.owner, id, nil, digests...); err != nil || again.Status != "UPLOADED" {
			t.Fatalf("replay = %+v, %v", again, err)
		}
		if _, err := repo.SignAssetUploadParts(w.ctx, w.owner, id, []int{1}); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("signing a part of a finished upload: %v", err)
		}
	})

	t.Run("a part that differs from what the browser read fails the upload", func(t *testing.T) {
		id := reserve(t, "changed.mp4").Asset.ID
		send(t, id, 1, video[:uploadPartBytes])
		changed := append([]byte{}, video[uploadPartBytes:]...)
		changed[len(changed)-1] ^= 1
		send(t, id, 2, changed)
		if _, err := repo.CompleteAssetUpload(w.ctx, w.owner, id, nil, digests...); err == nil || !strings.Contains(err.Error(), "Part 2") {
			t.Fatalf("completion = %v", err)
		}
		if row := w.db.Client.Asset.GetX(w.ctx, id); row.Status != asset.StatusFAILED {
			t.Fatalf("status = %s", row.Status)
		}
	})

	t.Run("parts stay private to their workspace and their range", func(t *testing.T) {
		id := reserve(t, "scoped.mp4").Asset.ID
		if _, err := repo.SignAssetUploadParts(w.ctx, w.owner, id, []int{3}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("part 3 of 2: %v", err)
		}
		other := newTestWorkspace(t)
		subscribe(t, other.ctx, other.repo, other.org, "pro")
		if _, err := other.repo.WithObjectStore(store).SignAssetUploadParts(other.ctx, other.owner, id, []int{1}); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("another workspace signed a part: %v", err)
		}
		// A file of one part, or a caller that does not ask, keeps the single signed PUT.
		small, err := repo.SignAssetUpload(w.ctx, w.owner, AssetUploadInput{Bytes: len(movie), ContentType: "video/mp4", FileName: "small.mp4", Multipart: true})
		if err != nil || small.UploadURL == "" || small.Multipart != nil {
			t.Fatalf("small = %+v, %v", small, err)
		}
		if _, err := repo.SignAssetUploadParts(w.ctx, w.owner, small.Asset.ID, nil); err == nil || !strings.Contains(err.Error(), "not sent in parts") {
			t.Fatalf("parts of a single upload: %v", err)
		}
	})
}
