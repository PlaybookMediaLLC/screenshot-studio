package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

type fakeStorage struct{ removed []string }

func (f *fakeStorage) UploadSimple(_ context.Context, path string) (string, error) { return path, nil }
func (f *fakeStorage) RemoveFile(_ context.Context, path string) error {
	f.removed = append(f.removed, path)
	return nil
}
func (f *fakeStorage) UploadStreamToStorage(context.Context, io.Reader, int64) (*UploadedStream, error) {
	return nil, errors.New("not used")
}
func (f *fakeStorage) SignDownloadURL(_ context.Context, name string) (string, error) {
	return "https://get/" + name, nil
}
func (f *fakeStorage) SignUploadURL(_ context.Context, name, _ string) (string, error) {
	return "https://put/" + name, nil
}

type fakeProcessor struct {
	jobs   []map[string]any
	status ProcessorStatus
}

func (f *fakeProcessor) Submit(_ context.Context, job any) (string, error) {
	f.jobs = append(f.jobs, job.(map[string]any))
	return "job1", nil
}
func (f *fakeProcessor) Status(context.Context, string) (*ProcessorStatus, error) {
	return &f.status, nil
}

func setup(t *testing.T, processor Processor) (*Service, *ent.Client, *ent.Organization, *fakeStorage) {
	t.Helper()
	client := dbtest.Open(t)
	storage := &fakeStorage{}
	org := client.Organization.Create().SetName("Acme").SaveX(context.Background())
	return NewService(NewRepository(client), nil, nil, nil, nil, redis.NewMemory(), storage, processor), client, org, storage
}

func TestGetMediaPagination(t *testing.T) {
	s, client, org, _ := setup(t, nil)
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range 20 {
		client.Media.Create().SetOrganizationID(org.ID).SetName(fmt.Sprintf("f%d.png", i)).SetPath("/p").
			SetOriginalName(fmt.Sprintf("Holiday %d", i)).SetCreatedAt(base.Add(time.Duration(i) * time.Minute)).SaveX(ctx)
	}
	client.Media.Create().SetOrganizationID(org.ID).SetName("deleted.png").SetPath("/p").SetDeletedAt(time.Now()).SaveX(ctx)
	client.Media.Create().SetOrganizationID(org.ID).SetName("busy.mp4").SetPath("/p").SetStatus("processing").SaveX(ctx)

	first, err := s.GetMedia(ctx, org.ID, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if first.Pages != 2 || len(first.Results) != 18 || first.Results[0].Name != "f19.png" {
		t.Fatalf("page 1: pages=%d len=%d first=%s", first.Pages, len(first.Results), first.Results[0].Name)
	}
	second, _ := s.GetMedia(ctx, org.ID, 2, "")
	if len(second.Results) != 2 || second.Results[1].Name != "f0.png" {
		t.Errorf("page 2: %+v", second.Results)
	}
	search, _ := s.GetMedia(ctx, org.ID, 0, "  holiday 1 ")
	if search.Pages != 1 || len(search.Results) != 11 {
		t.Errorf("search: pages=%d len=%d", search.Pages, len(search.Results))
	}
	data, _ := json.Marshal(first.Results[0])
	if !strings.Contains(string(data), `"createdAt":"2026-01-01T00:19:00.000Z"`) || !strings.Contains(string(data), `"thumbnailTimestamp":null`) {
		t.Errorf("item json: %s", data)
	}
}

func TestSaveAndStatusShapes(t *testing.T) {
	s, _, org, _ := setup(t, nil)
	ctx := context.Background()
	media, err := s.SaveUploadedFile(ctx, org.ID, "a.mov", "https://cdn/a.mov", "Clip.mov")
	if err != nil {
		t.Fatal(err)
	}
	saved, _ := json.Marshal(media)
	if strings.Contains(string(saved), "processingError") || !strings.Contains(string(saved), `"status":"ready"`) {
		t.Errorf("saveFile json: %s", saved)
	}
	status, err := s.GetMediaStatus(ctx, org.ID, media.ID)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(status)
	if !strings.Contains(string(data), `"processingError":null`) {
		t.Errorf("status json: %s", data)
	}
	var httpErr *httpx.Error
	if _, err := s.GetMediaStatus(ctx, org.ID, "missing"); !errors.As(err, &httpErr) || httpErr.Status != 404 {
		t.Errorf("missing media: %v", err)
	}
}

func TestProcessing(t *testing.T) {
	processor := &fakeProcessor{}
	s, client, org, storage := setup(t, processor)
	ctx := context.Background()
	m := client.Media.Create().SetOrganizationID(org.ID).SetName("abc.mov").SetPath("https://cdn/uploads/abc.mov").SetStatus("processing").SaveX(ctx)

	jobID, err := s.SubmitProcessing(ctx, m.ID)
	if err != nil || jobID != "job1" {
		t.Fatalf("submit: %v %v", jobID, err)
	}
	output := processor.jobs[0]["output"].(map[string]any)
	if output["url"] != "https://put/abc.mp4" || processor.jobs[0]["type"] != "video" {
		t.Errorf("job: %+v", processor.jobs[0])
	}

	processor.status = ProcessorStatus{Status: "pending"}
	if done, _ := s.CheckProcessing(ctx, m.ID, "job1"); done {
		t.Errorf("pending reported done")
	}

	processor.status = ProcessorStatus{Status: "completed", Result: json.RawMessage(`{"status":"completed","output":{"bytes":42}}`)}
	if done, err := s.CheckProcessing(ctx, m.ID, "job1"); !done || err != nil {
		t.Fatalf("completed: %v %v", done, err)
	}
	got := client.Media.GetX(ctx, m.ID)
	if got.Status != "ready" || got.Name != "abc.mp4" || got.Path != "https://cdn/uploads/abc.mp4" || got.FileSize != 42 {
		t.Errorf("finished media: %+v", got)
	}
	if len(storage.removed) != 1 || storage.removed[0] != "abc.mov" {
		t.Errorf("original not removed: %v", storage.removed)
	}

	f := client.Media.Create().SetOrganizationID(org.ID).SetName("x.png").SetPath("/x.png").SetStatus("processing").SaveX(ctx)
	processor.status = ProcessorStatus{Status: "completed", Result: json.RawMessage(`{"status":"failed","failure":{"code":"BAD","message":"nope","stderr_tail":"tail"}}`)}
	if _, err := s.CheckProcessing(ctx, f.ID, "job2"); err != nil {
		t.Fatal(err)
	}
	if got := client.Media.GetX(ctx, f.ID); got.Status != "failed" || *got.ProcessingError != "BAD: nope\ntail" {
		t.Errorf("failed media: %+v", got)
	}
}

func TestUploadSession(t *testing.T) {
	s, _, org, _ := setup(t, nil)
	ctx := context.Background()
	session, err := s.CreateUploadSession(ctx, org.ID)
	if err != nil || len(session) != 32 {
		t.Fatalf("session: %q %v", session, err)
	}
	ticket, err := s.CreateUploadTicket(ctx, org.ID, session)
	if err != nil {
		t.Fatal(err)
	}
	if found, _ := s.GetUploadTicket(ctx, ticket); found == nil || found.Org != org.ID || found.SessionID != session {
		t.Errorf("ticket: %+v", found)
	}
	if _, err := s.CreateUploadTicket(ctx, "other", session); err == nil {
		t.Errorf("another org used the session")
	}
	if _, err := s.SaveUploadSessionFile(ctx, org.ID, session, "a.png", "/a.png", ""); err != nil {
		t.Fatal(err)
	}
	list, err := s.GetUploadSession(ctx, org.ID, session)
	if err != nil || len(list) != 1 || list[0].Name != "a.png" {
		t.Errorf("session media: %+v %v", list, err)
	}
}

func TestGenerationError(t *testing.T) {
	var httpErr *httpx.Error
	err := generationError(errors.New("400 Your request was rejected by the safety system, safety_violations=[sexual]"))
	if !errors.As(err, &httpErr) || httpErr.Status != 422 ||
		httpErr.Message() != "Your request was rejected by the AI safety system. Flagged categories: sexual. Please adjust your prompt and try again." {
		t.Errorf("safety: %+v", err)
	}
	sub := &SubscriptionError{Section: SectionVideosPerMonth, Action: ActionCreate}
	if generationError(sub) != sub {
		t.Errorf("subscription error not preserved")
	}
	if !errors.As(generationError(errors.New("bad key")), &httpErr) || httpErr.Status != 500 {
		t.Errorf("generic: %+v", httpErr)
	}
}
