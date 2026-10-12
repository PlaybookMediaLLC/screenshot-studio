package instagram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

func setup(t *testing.T, mux *http.ServeMux) *Provider {
	t.Helper()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old := origin
	origin = func(string) string { return srv.URL }
	t.Cleanup(func() { origin = old })
	p := New()
	p.RetryDelay = 0
	return p
}

func TestCarouselPendingFlow(t *testing.T) {
	statuses := map[string][]string{
		"c1":  {"IN_PROGRESS", "FINISHED"},
		"c2":  {"FINISHED"},
		"car": {"IN_PROGRESS", "FINISHED"},
	}
	var calls []string
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v25.0/ig1/media", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("media_type") == "CAROUSEL" {
			if q.Get("children") != "c1,c2" || q.Get("collaborators") != `["bob"]` || q.Get("caption") != "Hi (there)!" {
				t.Errorf("carousel query %s", r.URL.RawQuery)
			}
			calls = append(calls, "carousel")
			w.Write([]byte(`{"id":"car"}`))
			return
		}
		if q.Get("is_carousel_item") != "true" || q.Has("collaborators") || q.Has("caption") {
			t.Errorf("child query %s", r.URL.RawQuery)
		}
		if q.Get("access_token") != "page" {
			t.Errorf("token %s", q.Get("access_token"))
		}
		if q.Get("image_url") == "https://cdn/1.jpg" {
			w.Write([]byte(`{"id":"c1"}`))
			return
		}
		w.Write([]byte(`{"id":"c2"}`))
	})
	mux.HandleFunc("GET /v25.0/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if r.URL.Query().Get("fields") == "permalink" {
			w.Write([]byte(`{"permalink":"https://instagram.com/p/` + id + `"}`))
			return
		}
		if r.URL.Query().Get("access_token") != "user" {
			t.Errorf("status check must use the user token")
		}
		list := statuses[id]
		status := list[0]
		if len(list) > 1 {
			statuses[id] = list[1:]
		}
		w.Write([]byte(`{"status_code":"` + status + `"}`))
	})
	mux.HandleFunc("POST /v25.0/ig1/media_publish", func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, "publish:"+r.URL.Query().Get("creation_id"))
		w.Write([]byte(`{"id":"m1"}`))
	})
	p := setup(t, mux)
	ctx := context.Background()
	integration := &ent.Integration{InternalID: "ig1"}

	res, err := p.PostPending(ctx, "ig1", "page___user", []integrations.PostDetails{{
		ID: "post", Message: "Hi (there)!",
		Settings: json.RawMessage(`{"post_type":"post","collaborators":[{"label":"@@bob"}]}`),
		Media:    []integrations.MediaContent{{Path: "https://cdn/1.jpg"}, {Path: "https://cdn/2.jpg"}},
	}}, integration)
	if err != nil {
		t.Fatal(err)
	}
	if string(res[0].PendingData) != `{"type":"graph.facebook.com","postType":"carousel","containers":["c1","c2"],"message":"Hi (there)!","collaborators":["bob"]}` {
		t.Fatalf("pendingData %s", res[0].PendingData)
	}

	data := res[0].PendingData
	var steps []string
	for i := 0; i < 10; i++ {
		check, err := p.CheckPostStatus(ctx, "page___user", data, integration)
		if err != nil {
			t.Fatal(err)
		}
		steps = append(steps, "check:"+check.Status)
		if check.Status == "pending" {
			data = check.PendingData
			continue
		}
		result, err := p.FinalizePost(ctx, "page___user", check.PendingData, integration)
		if err != nil {
			t.Fatal(err)
		}
		steps = append(steps, "finalize:"+result.Status)
		if result.Status == "completed" {
			if result.PostID != "m1" || result.ReleaseURL != "https://instagram.com/p/m1" {
				t.Fatalf("%+v", result)
			}
			break
		}
		data = result.PendingData
	}
	if got := strings.Join(steps, " "); got != "check:pending check:ready finalize:pending check:pending check:ready finalize:completed" {
		t.Fatalf("steps %s", got)
	}
	if strings.Join(calls, ",") != "carousel,publish:car" {
		t.Fatalf("calls %v", calls)
	}
}

func TestSingleReelQuery(t *testing.T) {
	var query string
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v25.0/ig1/media", func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		w.Write([]byte(`{"id":"c1"}`))
	})
	p := setup(t, mux)
	ts := int64(1500)
	res, err := p.PostPending(context.Background(), "ig1", "page", []integrations.PostDetails{{
		ID: "post", Message: "a b",
		Settings: json.RawMessage(`{"post_type":"post","is_trial_reel":"true","audio":{"id":"a1","audio_volume":"40"}}`),
		Media:    []integrations.MediaContent{{Path: "https://cdn/v.mp4", ThumbnailTimestamp: &ts}},
	}}, &ent.Integration{})
	if err != nil {
		t.Fatal(err)
	}
	want := "video_url=https://cdn/v.mp4&media_type=REELS&thumb_offset=1500" +
		"&trial_params=%7B%22graduation_strategy%22%3A%22MANUAL%22%7D" +
		"&audio_configuration=%7B%22audio_id%22%3A%22a1%22%2C%22audio_volume%22%3A40%7D" +
		"&access_token=page&caption=a%20b"
	if query != want {
		t.Fatalf("query\n got %s\nwant %s", query, want)
	}
	if !strings.Contains(string(res[0].PendingData), `"postType":"single"`) {
		t.Fatalf("%s", res[0].PendingData)
	}
}

func TestContainerErrorDisconnects(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v25.0/c1", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status_code":"ERROR","status":"Session key is malformed"}`))
	})
	p := setup(t, mux)
	_, err := p.CheckPostStatus(context.Background(), "tok", json.RawMessage(`{"type":"graph.facebook.com","postType":"single","containers":["c1"],"message":""}`), &ent.Integration{})
	if temporalx.FailureType(err) != temporalx.TypeDisconnect {
		t.Fatalf("got %v", err)
	}
}

func TestPublishErrorClassified(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v25.0/ig1/media_publish", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		w.Write([]byte(`{"error":{"error_subcode":2207042}}`))
	})
	p := setup(t, mux)
	_, err := p.FinalizePost(context.Background(), "tok", json.RawMessage(`{"type":"graph.facebook.com","postType":"single","containers":["c1"],"message":""}`), &ent.Integration{InternalID: "ig1"})
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "You have reached the maximum of 25 posts per day, allowed for your account" {
		t.Fatalf("got %v", err)
	}
}

func TestCheckValidity(t *testing.T) {
	p := New()
	media := func(paths ...string) [][]integrations.ValidityMedia {
		var out []integrations.ValidityMedia
		for _, path := range paths {
			out = append(out, integrations.ValidityMedia{Path: path})
		}
		return [][]integrations.ValidityMedia{out}
	}
	cases := []struct {
		posts    [][]integrations.ValidityMedia
		settings string
		want     string
	}{
		{nil, `{}`, "Should have at least one media"},
		{media("a.jpg"), `{"is_trial_reel":true}`, "Trial Reels must be a video"},
		{media("a.mp4"), `{"post_type":"story","audio":{"id":"x"}}`, "Audio can only be added to Reels, not to Stories"},
		{media("a.mp4"), `{"post_type":"post","audio":{"id":"x"}}`, ""},
	}
	for _, c := range cases {
		if got, _ := p.CheckValidity(context.Background(), c.posts, json.RawMessage(c.settings), nil); got != c.want {
			t.Errorf("%s: got %q want %q", c.settings, got, c.want)
		}
	}
}

func TestInstagramDTOValidate(t *testing.T) {
	var dto InstagramDTO
	if err := json.Unmarshal([]byte(`{"graduation_strategy":"X","collaborators":[{}],"audio":{"audio_volume":"abc","video_volume":50}}`), &dto); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"post_type should not be null or undefined",
		"post_type must be one of the following values: post, story",
		"graduation_strategy must be one of the following values: MANUAL, SS_PERFORMANCE",
		"collaborators.0.label should not be null or undefined",
		"collaborators.0.label must be a string",
		"audio.id should not be null or undefined",
		"audio.id must be a string",
		"audio.audio_volume must not be greater than 100",
		"audio.audio_volume must not be less than 0",
		"audio.audio_volume must be a number conforming to the specified constraints",
	}
	if got := dto.Validate(); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got\n%s", strings.Join(got, "\n"))
	}
}
