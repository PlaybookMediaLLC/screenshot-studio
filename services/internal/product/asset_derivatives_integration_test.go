package product

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"io"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type derivativeObjects struct {
	recordingAssetObjects
	files map[string][]byte
	puts  int
}

func (o *derivativeObjects) Put(_ context.Context, key, _ string, reader io.Reader) error {
	body, err := io.ReadAll(reader)
	o.files[key] = body
	o.puts++
	return err
}
func (o *derivativeObjects) Read(_ context.Context, key string) ([]byte, error) {
	return o.files[key], nil
}

func TestScheduledImageDerivativeRetainsOriginalDescriptionAndRetryIdentity(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	objects := &derivativeObjects{recordingAssetObjects: recordingAssetObjects{exists: true}, files: map[string][]byte{}}
	w.repo.WithObjectStore(objects).WithMonthlyMeter(&recordingMonthlyMeter{})
	var source bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&source, image.NewNRGBA(image.Rect(0, 0, 1600, 1200))); err != nil {
		t.Fatal(err)
	}
	if source.Len() <= 5_000_000 {
		t.Fatal("fixture must require an X derivative")
	}
	upload, err := w.repo.SignAssetUpload(w.ctx, w.owner, AssetUploadInput{Bytes: source.Len(), ContentType: "image/png", FileName: "original.png"})
	if err != nil {
		t.Fatal(err)
	}
	objects.files[upload.Asset.ObjectKey] = append([]byte(nil), source.Bytes()...)
	if _, err = w.repo.CompleteAssetUpload(w.ctx, w.owner, upload.Asset.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = w.repo.SetAssetAltText(w.ctx, w.owner, upload.Asset.ID, "Transparent original"); err != nil {
		t.Fatal(err)
	}
	// A creator can choose a derivative-looking name and parent for unrelated
	// bytes through both public asset APIs. Neither may populate the cache.
	var unrelated bytes.Buffer
	if err = png.Encode(&unrelated, image.NewNRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	spoof, err := w.repo.SignAssetUpload(w.ctx, w.owner, AssetUploadInput{
		Bytes: unrelated.Len(), ContentType: "image/png", Classification: "derived",
		FileName: "provider-image-v2-x-5000000-4096.png", ParentAssetID: upload.Asset.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	objects.files[spoof.Asset.ObjectKey] = unrelated.Bytes()
	if _, err = w.repo.CompleteAssetUpload(w.ctx, w.owner, spoof.Asset.ID, nil); err != nil {
		t.Fatal(err)
	}
	generatedSpoof, err := w.repo.StoreGeneratedAsset(w.ctx, w.owner, GeneratedAssetInput{
		Body: unrelated.Bytes(), ContentType: "image/png", Classification: "derived",
		FileName: "provider-image-v2-x-5000000-4096.png", ParentAssetID: upload.Asset.ID, Width: 1, Height: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	initialPuts := objects.puts
	credential := socialCredentialFixture(t, w.ctx, w.db.SQL, w.org)
	credential("x-"+w.id, "x")
	connection, err := w.repo.auth.CreateConnection(w.ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, Type: "USER"}, publishing.CreateConnectionInput{ExternalAccountID: "x-" + w.id, Platform: "x", ProviderSettings: map[string]any{}, SecretReference: "SOCIAL_API_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{AssetIDs: []string{upload.Asset.ID}, Title: "Large image"})
	if err != nil {
		t.Fatal(err)
	}
	targets := []ContentDraftScheduleTarget{{AssetIDs: []string{upload.Asset.ID}, Caption: "A large image", ChannelConnectionID: connection.ID}}
	input := ScheduleContentDraftInput{Version: draft.Version, ScheduledFor: time.Now().Add(2 * time.Hour), Targets: targets}
	scheduled, err := w.repo.ScheduleContentDraft(w.ctx, w.owner, draft.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if targets[0].AssetIDs[0] != upload.Asset.ID {
		t.Fatal("scheduling mutated caller selection")
	}
	derivative, err := w.db.Client.Asset.Query().Where(asset.ParentAssetID(upload.Asset.ID), asset.ObjectKeyHasPrefix(providerImagePrefix(w.org))).Only(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if derivative.Bytes > 5_000_000 || derivative.AltText == nil || *derivative.AltText != "Transparent original" || derivative.Width == nil || *derivative.Width != 1600 {
		t.Fatalf("invalid derivative: %+v", derivative)
	}
	post := w.db.Client.ScheduledPost.GetX(w.ctx, scheduled.Posts[0].ID)
	if post.AssetIds[0] == spoof.Asset.ID || post.AssetIds[0] == generatedSpoof.ID {
		t.Fatal("caller-supplied bytes were substituted for the approved source")
	}
	if len(post.AssetIds) != 1 || post.AssetIds[0] != derivative.ID {
		t.Fatalf("schedule did not pin derivative: %+v", post.AssetIds)
	}
	if !bytes.Equal(objects.files[upload.Asset.ObjectKey], source.Bytes()) {
		t.Fatal("source image overwritten")
	}
	replay, err := w.repo.ScheduleContentDraft(w.ctx, w.owner, draft.ID, input)
	if err != nil || replay.Created || replay.Posts[0].ID != scheduled.Posts[0].ID || objects.puts != initialPuts+1 {
		t.Fatalf("retry duplicated work: %+v %v puts=%d", replay, err, objects.puts)
	}
	if _, err = w.repo.SetAssetAltText(w.ctx, w.owner, upload.Asset.ID, ""); err != nil {
		t.Fatal(err)
	}
	if err = w.repo.prepareDraftImages(w.ctx, w.owner, targets, nil); err != nil {
		t.Fatal(err)
	}
	if w.db.Client.Asset.GetX(w.ctx, derivative.ID).AltText != nil || objects.puts != initialPuts+1 {
		t.Fatal("cached derivative retained stale description or was uploaded twice")
	}
	other := newTestWorkspace(t)
	subscribe(t, other.ctx, other.repo, other.org, "pro")
	other.repo.WithObjectStore(objects)
	if _, err = other.repo.SignAssetUpload(other.ctx, other.owner, AssetUploadInput{ParentAssetID: upload.Asset.ID, Bytes: 10, ContentType: "image/png", FileName: "foreign.png"}); err == nil {
		t.Fatal("foreign source lineage accepted")
	}
}

func TestSmallWideImageStillGetsDurableProviderDerivative(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	objects := &derivativeObjects{recordingAssetObjects: recordingAssetObjects{exists: true}, files: map[string][]byte{}}
	w.repo.WithObjectStore(objects).WithMonthlyMeter(&recordingMonthlyMeter{})
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewNRGBA(image.Rect(0, 0, 5000, 1000))); err != nil {
		t.Fatal(err)
	}
	if source.Len() > 5_000_000 {
		t.Fatal("fixture must fit the byte ceiling")
	}
	upload, err := w.repo.SignAssetUpload(w.ctx, w.owner, AssetUploadInput{Bytes: source.Len(), ContentType: "image/png", FileName: "wide.png"})
	if err != nil {
		t.Fatal(err)
	}
	objects.files[upload.Asset.ObjectKey] = source.Bytes()
	if _, err = w.repo.CompleteAssetUpload(w.ctx, w.owner, upload.Asset.ID, nil); err != nil {
		t.Fatal(err)
	}
	credential := socialCredentialFixture(t, w.ctx, w.db.SQL, w.org)
	credential("x-"+w.id, "x")
	connection, err := w.repo.auth.CreateConnection(w.ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, Type: "USER"}, publishing.CreateConnectionInput{ExternalAccountID: "x-" + w.id, Platform: "x", ProviderSettings: map[string]any{}, SecretReference: "SOCIAL_API_KEY"})
	if err != nil {
		t.Fatal(err)
	}
	targets := []ContentDraftScheduleTarget{{ChannelConnectionID: connection.ID, AssetIDs: []string{upload.Asset.ID}}}
	if err = w.repo.prepareDraftImages(w.ctx, w.owner, targets, nil); err != nil {
		t.Fatal(err)
	}
	if targets[0].AssetIDs[0] == upload.Asset.ID {
		t.Fatal("dimension-only processing was skipped")
	}
	derived := w.db.Client.Asset.GetX(w.ctx, targets[0].AssetIDs[0])
	if derived.Width == nil || *derived.Width != 4096 || derived.Height == nil || *derived.Height != 819 || derived.ParentAssetID == nil || *derived.ParentAssetID != upload.Asset.ID {
		t.Fatalf("bad derivative dimensions or lineage: %+v", derived)
	}
	if !bytes.Equal(objects.files[upload.Asset.ObjectKey], source.Bytes()) {
		t.Fatal("source changed")
	}
}
