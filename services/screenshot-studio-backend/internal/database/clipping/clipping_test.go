package clipping

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/media"
	clippingdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
	"go.temporal.io/sdk/temporal"
)

type cloud struct {
	files   map[string]string
	removed []string
}

func (c *cloud) RemoveFile(_ context.Context, key string) error {
	c.removed = append(c.removed, key)
	delete(c.files, key)
	return nil
}
func (c *cloud) SignDownloadURL(_ context.Context, key string) (string, error) {
	return "https://get/" + key, nil
}
func (c *cloud) SignUploadURL(_ context.Context, key, _ string) (string, error) {
	return "https://put/" + key, nil
}
func (c *cloud) PublicURL(key string) string { return "https://cdn/" + key }
func (c *cloud) ReadFile(_ context.Context, key string) (string, error) {
	data, ok := c.files[key]
	if !ok {
		return "", errors.New("missing " + key)
	}
	return data, nil
}
func (c *cloud) WriteFile(_ context.Context, key, body, _ string) error {
	c.files[key] = body
	return nil
}

type processor struct {
	jobs   []map[string]any
	status media.ProcessorStatus
}

func (p *processor) Submit(_ context.Context, job any) (string, error) {
	p.jobs = append(p.jobs, job.(map[string]any))
	return "job", nil
}
func (p *processor) Status(context.Context, string) (*media.ProcessorStatus, error) {
	return &p.status, nil
}

func (p *processor) answer(result string) {
	p.status = media.ProcessorStatus{Status: "completed", Result: json.RawMessage(result)}
}

type credits struct {
	charged  map[string]int
	refunded []string
}

func (c *credits) CheckCredits(context.Context, *ent.Organization, string) (int, error) {
	return 100, nil
}
func (c *credits) ChargeCredits(_ context.Context, id, _, _ string, n int) (string, error) {
	c.charged[id] = n
	return id, nil
}
func (c *credits) RefundCredits(_ context.Context, _, id string) error {
	c.refunded = append(c.refunded, id)
	return nil
}

type channels struct{ client *ent.Client }

func (c channels) GetIntegrationByID(ctx context.Context, org, id string) (*ent.Integration, error) {
	i, err := c.client.Integration.Get(ctx, id)
	if ent.IsNotFound(err) || (i != nil && i.OrganizationID != org) {
		return nil, nil
	}
	return i, err
}

type posts struct{ created []CreatePostBody }

func (p *posts) FindFreeDateTime(context.Context, string, string) (string, error) {
	return "2026-02-01T10:00:00", nil
}
func (p *posts) CreatePost(_ context.Context, _ string, body CreatePostBody, _ string) error {
	p.created = append(p.created, body)
	return nil
}

type picker struct{}

func (picker) PickClips(_ context.Context, _, _ string, _ []Segment, _ int) ([]PickedClip, error) {
	return []PickedClip{
		{Title: "Hook", Content: "first", From: 0, To: 1},    // 0-30s
		{Title: "Overlap", Content: "x", From: 1, To: 2},     // overlaps the first
		{Title: "Short", Content: "x", From: 3, To: 3},       // 5 seconds
		{Title: "Out", Content: "x", From: 2, To: 9},         // past the transcript
		{Title: "Fraction", Content: "x", From: 0.5, To: 2},  // not a line number
		{Title: "Second", Content: "second", From: 2, To: 4}, // 30-60s
	}, nil
}

type transcriber struct{}

func (transcriber) TranscribeURL(context.Context, string) (*Transcript, error) {
	return &Transcript{Version: 1, Language: "en", Origin: "transcribed", WordLevel: true,
		Segments: []Segment{{0, 15, "a"}, {15, 30, "b"}, {30, 45, "c"}, {45, 50, "d"}, {50, 60, "e"}},
		Words:    []Word{{"hello", 1, 2}, {"later", 40, 41}}}, nil
}

func TestClippingLifecycle(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	storage := &cloud{files: map[string]string{}}
	ingest, clipper := &processor{}, &processor{}
	charges := &credits{charged: map[string]int{}}
	drafts := &posts{}
	mediaService := media.NewService(media.NewRepository(client), nil, nil, nil, nil, redis.NewMemory(), nil, nil)
	s := NewService(NewRepository(client), charges, nil, channels{client}, drafts, mediaService, picker{}, transcriber{},
		nil, redis.NewMemory(), storage, ingest, clipper)

	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	channel := client.Integration.Create().SetOrganizationID(org.ID).SetInternalID("1").SetName("X").
		SetProviderIdentifier("x").SetType("social").SetToken("t").SaveX(ctx)

	var httpErr *httpx.Error
	if _, err := s.StartClipping(ctx, org, clippingdto.ClippingDto{URL: "https://vimeo.com/1"}); !errors.As(err, &httpErr) || httpErr.Status != 400 {
		t.Errorf("non youtube: %v", err)
	}
	if _, err := s.StartClipping(ctx, &ent.Organization{ID: org.ID, IsTrailing: true}, clippingdto.ClippingDto{URL: "https://youtu.be/1"}); !errors.As(err, &httpErr) || httpErr.Status != 406 {
		t.Errorf("trial: %v", err)
	}

	created, err := s.repo.CreateClipping(ctx, org.ID, "https://youtu.be/abc", 5, "crop", []string{channel.ID})
	if err != nil || created.Status != "analysing" {
		t.Fatalf("create: %+v %v", created, err)
	}
	id := created.ID

	// captions uploaded by the channel are not trusted: the audio is asked for
	if _, err := s.SubmitAnalyse(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, ok := ingest.jobs[0]["transcript"]; !ok {
		t.Errorf("first analyse without transcript: %+v", ingest.jobs[0])
	}
	ingest.answer(`{"status":"completed","source":{"duration_seconds":125},"transcript":{"origin":"uploader_provided"}}`)
	if check, err := s.CheckAnalyse(ctx, id, "job"); err != nil || check.State != StateRetry {
		t.Fatalf("translated captions: %+v %v", check, err)
	}
	if _, err := s.SubmitAnalyse(ctx, id); err != nil {
		t.Fatal(err)
	}
	if _, ok := ingest.jobs[1]["transcript"]; ok || ingest.jobs[1]["audio"].(map[string]any)["unless_transcript"] != false {
		t.Errorf("audio-only analyse: %+v", ingest.jobs[1])
	}
	ingest.answer(`{"status":"completed","source":{"title":"Talk","duration_seconds":125},"audio":{"bytes":10}}`)
	check, err := s.CheckAnalyse(ctx, id, "job")
	if err != nil || check.State != StateDone || check.Transcribe == nil || !*check.Transcribe {
		t.Fatalf("analyse: %+v %v", check, err)
	}
	if charges.charged[id] != 3 {
		t.Errorf("charged %d minutes", charges.charged[id])
	}
	if c := client.Clipping.GetX(ctx, id); *c.Duration != 125 || *c.CreditsID != id || *c.Title != "Talk" {
		t.Errorf("analysed clipping: %+v", c)
	}

	// a failure retrying can't fix stops the clipping
	ingest.answer(`{"status":"failed","failure":{"code":"SOURCE_UNAVAILABLE","retryable":false}}`)
	var app *temporal.ApplicationError
	if _, err := s.CheckAnalyse(ctx, id, "job"); !errors.As(err, &app) || app.Type() != ClippingStopType || !app.NonRetryable() {
		t.Errorf("stop: %v", err)
	}

	if err := s.Transcribe(ctx, id); err != nil {
		t.Fatal(err)
	}
	clipIDs, err := s.PickClips(ctx, id)
	if err != nil || len(clipIDs) != 2 {
		t.Fatalf("pick: %v %v", clipIDs, err)
	}
	if again, _ := s.PickClips(ctx, id); len(again) != 2 {
		t.Errorf("a retry asked the model again: %v", again)
	}
	clipping, _ := s.repo.GetClippingByID(ctx, id)
	if clipping.Status != "rendering" || clipping.Edges.Clips[0].Title != "Hook" || clipping.Edges.Clips[1].End != 60 {
		t.Fatalf("picked: %+v", clipping.Edges.Clips)
	}
	first, second := clipping.Edges.Clips[0].ID, clipping.Edges.Clips[1].ID

	// fetch the window, caption it, render it
	if _, err := s.SubmitClipFetch(ctx, first); err != nil {
		t.Fatal(err)
	}
	source := ingest.jobs[len(ingest.jobs)-1]["source"].(map[string]any)
	if source["max_height"] != 1080 || source["start_seconds"] != 0 || source["end_seconds"] != 32 {
		t.Errorf("fetch window: %+v", source)
	}
	ingest.answer(`{"status":"completed","video":{"bytes":1},"source":{"trim":{"start_seconds":0}}}`)
	if check, err := s.CheckClipFetch(ctx, first, "job"); err != nil || check.State != StateDone {
		t.Fatalf("fetch: %+v %v", check, err)
	}
	if err := s.CaptionClip(ctx, first); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitClipRender(ctx, first); err != nil {
		t.Fatal(err)
	}
	if captions, ok := clipper.jobs[0]["captions"].(map[string]any); !ok || len(captions["words"].([]Word)) != 1 {
		t.Errorf("render captions: %+v", clipper.jobs[0])
	}
	clipper.answer(`{"status":"completed","clips":[{"reference":"x","status":"completed","thumbnail":{"bytes":3}}]}`)
	if check, err := s.CheckClipRender(ctx, first, "job"); err != nil || check.State != StateDone {
		t.Fatalf("render: %+v %v", check, err)
	}
	done := client.ClippingClip.GetX(ctx, first)
	if done.Status != "completed" || *done.Path != "https://cdn/clip-"+first+".mp4" || done.MediaID == nil {
		t.Fatalf("rendered clip: %+v", done)
	}
	saved := client.Media.GetX(ctx, *done.MediaID)
	if *saved.Thumbnail != "https://cdn/clip-"+first+".jpg" || *saved.OriginalName != "Hook.mp4" || *saved.ThumbnailTimestamp != 0 {
		t.Errorf("saved media: %+v", saved)
	}
	if check, _ := s.CheckClipRender(ctx, first, "job"); check.State != StateDone || client.Media.Query().CountX(ctx) != 1 {
		t.Errorf("a retried poll saved the media twice")
	}

	// the second clip never renders; the clipping still completes
	if err := s.FinishClipping(ctx, id); err != nil {
		t.Fatal(err)
	}
	if c := client.ClippingClip.GetX(ctx, second); c.Status != "failed" || *c.Error != "The clip could not be rendered" {
		t.Errorf("unfinished clip: %+v", c)
	}
	if c := client.Clipping.GetX(ctx, id); c.Status != "completed" || c.Error != nil {
		t.Errorf("finished clipping: %+v", c)
	}

	for range 2 {
		if err := s.CreateDrafts(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	if len(drafts.created) != 1 || drafts.created[0].Date != "2026-02-01T10:00:00Z" || drafts.created[0].Posts[0].Integration.ID != channel.ID ||
		drafts.created[0].Posts[0].Value[0].Image[0].ID != *done.MediaID {
		t.Errorf("drafts: %+v", drafts.created)
	}

	// the widget reports once
	progress, err := s.GetWidgetProgress(ctx, org.ID, id, true)
	if err != nil || !progress.Report || len(progress.Clips) != 2 {
		t.Fatalf("progress: %+v %v", progress, err)
	}
	if again, _ := s.GetWidgetProgress(ctx, org.ID, id, true); again.Report {
		t.Errorf("reported twice")
	}
}

func TestFailClippingRefunds(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	charges := &credits{charged: map[string]int{}}
	s := NewService(NewRepository(client), charges, nil, nil, nil, nil, nil, nil, nil, redis.NewMemory(), &cloud{files: map[string]string{}}, nil, nil)
	org := client.Organization.Create().SetName("Acme").SaveX(ctx)
	c := client.Clipping.Create().SetOrganizationID(org.ID).SetURL("https://youtu.be/x").SetIntegrations("[]").
		SetCreditsID("charge").SetStatus("rendering").SetCreatedAt(time.Now().Add(-5 * time.Hour)).SaveX(ctx)
	client.ClippingClip.Create().SetClippingID(c.ID).SetTitle("t").SetContent("c").SetStart(0).SetEnd(20).SaveX(ctx)

	// a stale clipping is closed and refunded when it is looked at
	got, err := s.GetClipping(ctx, org.ID, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "failed" || *got.Error != "The clipping never finished" || got.Clips[0].Status != "failed" {
		t.Errorf("stale clipping: %+v", got)
	}
	if len(charges.refunded) != 1 || client.Clipping.GetX(ctx, c.ID).CreditsID != nil {
		t.Errorf("not refunded: %v", charges.refunded)
	}
	data, _ := json.Marshal(got)
	var shape map[string]any
	_ = json.Unmarshal(data, &shape)
	if _, ok := shape["createdAt"].(string); !ok || shape["clips"] == nil {
		t.Errorf("details json: %s", data)
	}
}
