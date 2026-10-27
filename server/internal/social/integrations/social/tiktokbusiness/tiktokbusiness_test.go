package tiktokbusiness

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/tiktok"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func setup(t *testing.T, handler http.HandlerFunc) *Provider {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	old := baseURL
	baseURL = srv.URL
	t.Cleanup(func() { baseURL = old })
	p := New()
	p.RetryDelay = 0
	return p
}

func integration() *ent.Integration {
	profile := "me"
	return &ent.Integration{Profile: &profile, InternalID: "biz-1"}
}

func TestPhotoPostWithRandomMusicAndPendingFlow(t *testing.T) {
	var publishBody map[string]any
	statuses := []string{
		`{"code":0,"data":{"status":"PROCESSING_DOWNLOAD"}}`,
		`{"code":40105,"message":"Access token has expired"}`,
		`{"code":0,"data":{"status":"PUBLISH_COMPLETE","post_ids":["7234567890123456789"]}}`,
	}
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Access-Token") != "tok" {
			t.Errorf("missing Access-Token on %s", r.URL.Path)
		}
		switch r.URL.Path {
		case "/discovery/cml/trending_list/":
			if r.URL.Query().Get("business_id") != "biz-1" {
				t.Errorf("trending query %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"code":0,"data":{"list":[{"commercial_music_name":"Song","full_duration_song_clip":{"song_clip_id":"clip-1"},"duration":30}]}}`)
		case "/business/photo/publish/":
			_ = json.NewDecoder(r.Body).Decode(&publishBody)
			io.WriteString(w, `{"code":0,"data":{"share_id":"p_pub_url~1"}}`)
		case "/business/publish/status/":
			if r.URL.Query().Get("publish_id") != "p_pub_url~1" || r.URL.Query().Get("business_id") != "biz-1" {
				t.Errorf("status query %s", r.URL.RawQuery)
			}
			io.WriteString(w, statuses[0])
			statuses = statuses[1:]
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})

	post := integrations.PostDetails{
		ID:       "p1",
		Message:  "caption",
		Settings: json.RawMessage(`{"content_posting_method":"DIRECT_POST","autoAddMusic":"yes","music":{"id":"ignored"},"comment":true,"location":{"id":"loc","name":"Paris"}}`),
		Media:    []integrations.MediaContent{{Path: "https://cdn/a.jpg"}},
	}
	res, err := p.PostPending(context.Background(), "biz-1", "tok", []integrations.PostDetails{post}, integration())
	if err != nil {
		t.Fatal(err)
	}
	if string(res[0].PendingData) != `{"publishId":"p_pub_url~1"}` || res[0].Status != "pending" {
		t.Fatalf("response %+v", res[0])
	}
	want := map[string]any{
		"business_id": "biz-1", "photo_cover_index": float64(0), "photo_images": []any{"https://cdn/a.jpg"},
		"post_info": map[string]any{
			"caption": "caption", "is_brand_organic": false, "is_branded_content": false,
			"privacy_level": "PUBLIC_TO_EVERYONE", "disable_comment": false, "auto_add_music": false,
			"location_id": "loc", "location_name": "Paris",
			"music_sound_info": map[string]any{"music_sound_id": "clip-1"},
		},
	}
	if !reflect.DeepEqual(publishBody, want) {
		t.Fatalf("publish body %v", publishBody)
	}

	ctx := context.Background()
	check, err := p.CheckPostStatus(ctx, "tok", res[0].PendingData, integration())
	if err != nil || check.Status != "pending" {
		t.Fatalf("first check %+v %v", check, err)
	}
	if _, err := p.CheckPostStatus(ctx, "tok", res[0].PendingData, integration()); temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("want refresh token, got %v", err)
	}
	check, err = p.CheckPostStatus(ctx, "tok", res[0].PendingData, integration())
	if err != nil || check.PostID != "7234567890123456789" || check.ReleaseURL != "https://www.tiktok.com/@me/photo/7234567890123456789" {
		t.Fatalf("completed %+v %v", check, err)
	}
}

func TestVideoBodyVolumesAndDraft(t *testing.T) {
	var settings = func(raw string) *tiktok.TikTokDTO { d := &tiktok.TikTokDTO{}; json.Unmarshal([]byte(raw), d); return d }
	post := integrations.PostDetails{Message: "m", Media: []integrations.MediaContent{{Path: "https://cdn/v.mp4", Thumbnail: "https://cdn/t.jpg"}}}

	body := buildVideoBody("biz", post, settings(`{"music":{"id":"clip","audio_volume":"20"},"duet":true}`))
	info := body["post_info"].(map[string]any)
	if body["custom_thumbnail_url"] != "https://cdn/t.jpg" || info["disable_duet"] != false {
		t.Fatalf("body %v", body)
	}
	if !reflect.DeepEqual(info["music_sound_info"], map[string]any{"music_sound_id": "clip", "music_sound_volume": float64(20), "video_original_sound_volume": 50}) {
		t.Fatalf("music %v", info["music_sound_info"])
	}

	draft := buildVideoBody("biz", post, settings(`{"content_posting_method":"UPLOAD","music":{"id":"clip"}}`))["post_info"].(map[string]any)
	if draft["upload_to_draft"] != true || draft["music_sound_info"] != nil || draft["disable_comment"] != nil {
		t.Fatalf("draft %v", draft)
	}
}

func TestPublishRejected(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"code":40002,"message":"url_ownership_unverified"}`)
	})
	post := integrations.PostDetails{ID: "p1", Media: []integrations.MediaContent{{Path: "https://cdn/v.mp4"}}}
	_, err := p.PostPending(context.Background(), "biz", "tok", []integrations.PostDetails{post}, integration())
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "The media domain is not a verified URL property of the TikTok app" {
		t.Fatalf("got %v", err)
	}
	if h := handleErrors("reached_active_user_cap", 200); h.Type != "bad-body" {
		t.Fatalf("active user cap must stay bad-body: %+v", h)
	}
}

func TestAuthenticateEnvelopeError(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"code":40001,"message":"auth_code expired"}`)
	})
	_, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c"}, nil)
	if temporalx.FailureMessage(err) != "auth_code expired" {
		t.Fatalf("got %v", err)
	}
}

func TestAuthenticate(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.example.com")
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tt_user/oauth2/token/":
			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body)
			if body["redirect_uri"] != "https://app.example.com/integrations/social/tiktok-business/" || body["auth_code"] != "c" {
				t.Errorf("body %v", body)
			}
			io.WriteString(w, `{"code":0,"data":{"access_token":"at","refresh_token":"rt","open_id":"-open-","scope":"user.info.basic,user.info.username,user.info.stats,video.list,video.upload,video.publish"}}`)
		case "/business/get/":
			if r.URL.Query().Get("fields") != `["username","display_name","profile_image"]` {
				t.Errorf("fields %s", r.URL.Query().Get("fields"))
			}
			io.WriteString(w, `{"code":0,"data":{"display_name":"Me","username":"me"}}`)
		}
	})
	got, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "-open-" || got.Name != "Me" || got.Picture != "" || got.ExpiresIn != 82800 {
		t.Fatalf("got %+v", got)
	}
}

func TestSearchFunctions(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/discovery/cml/trending_list/":
			if r.URL.Query().Get("genre") != "POP" {
				t.Errorf("genre %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"code":0,"data":{"list":[{"artist":"A"},{"trending_song_clip":{"song_clip_id":"t1","duration":15,"preview_url":"u"}}]}}`)
		case "/business/publish/location/":
			io.WriteString(w, `{"code":40100,"message":"Access token is incorrect"}`)
		}
	})
	fns := p.Functions()
	tracks, err := fns["musicSearch"](context.Background(), "tok", json.RawMessage(`{"genre":"POP"}`), "biz", nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []MusicTrack{{ID: "t1", Duration: 15000, PreviewURL: "u"}}
	if !reflect.DeepEqual(tracks, want) {
		t.Fatalf("tracks %+v", tracks)
	}
	if out, _ := p.LocationSearch(context.Background(), "tok", LocationSearchInput{}, "biz"); len(out) != 0 {
		t.Fatal("empty q must not search")
	}
	if _, err := p.LocationSearch(context.Background(), "tok", LocationSearchInput{Q: "Paris"}, "biz"); temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("want refresh token, got %v", err)
	}
}

func TestResolveReleaseID(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"code":0,"data":{"status":"PUBLISH_COMPLETE","post_ids":[]}}`)
	})
	ctx := context.Background()
	// privacy only blocks photo posts
	if r, _ := p.ResolveReleaseID(ctx, "t", "p_pub_url~1", integration(), json.RawMessage(`{"privacy_level":"SELF_ONLY"}`), ""); r == nil || !r.Unavailable {
		t.Fatalf("want unavailable: %+v", r)
	}
	if r, _ := p.ResolveReleaseID(ctx, "t", "v_pub_url~1", integration(), json.RawMessage(`{"privacy_level":"SELF_ONLY"}`), ""); r == nil || !r.Pending {
		t.Fatalf("want pending: %+v", r)
	}
	if r, _ := p.ResolveReleaseID(ctx, "t", "missing", integration(), nil, "https://www.tiktok.com/messages?lang=en#v_inbox_1"); r != nil {
		t.Fatalf("draft without id stays unresolved: %+v", r)
	}
}
