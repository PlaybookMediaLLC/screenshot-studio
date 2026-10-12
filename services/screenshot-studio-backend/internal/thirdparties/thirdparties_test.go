package thirdparties

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestManagerListing(t *testing.T) {
	m := NewManager(nil, nil)
	data, _ := json.Marshal(m.GetAllThirdParties())
	want := `[{"identifier":"heygen","title":"HeyGen","description":"HeyGen is a platform for creating AI-generated avatars videos.","fields":[]},` +
		`{"identifier":"reelfarm","title":"Reel.Farm","description":"Import UGC and greenscreen videos from your Reel.Farm account.","fields":[]}]`
	if string(data) != want {
		t.Errorf("got %s", data)
	}
	if r := m.GetThirdPartyByName("reelfarm"); r == nil || r.Position != "media-library" {
		t.Errorf("reelfarm %+v", r)
	}
	if m.GetThirdPartyByName("nope") != nil {
		t.Error("unknown")
	}
}

func TestHeygen(t *testing.T) {
	polls := 0
	var generated map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "key" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/v1/user/me":
			w.Write([]byte(`{"data":{"first_name":"Ada","last_name":"L","username":"ada"}}`))
		case "/v2/video/generate":
			json.NewDecoder(r.Body).Decode(&generated)
			w.Write([]byte(`{"data":{"video_id":"vid"}}`))
		case "/v1/video_status.get":
			polls++
			if polls == 1 {
				w.Write([]byte(`{"data":{"status":"processing"}}`))
				return
			}
			w.Write([]byte(`{"data":{"status":"completed","video_url":"https://v.mp4"}}`))
		}
	}))
	defer srv.Close()
	heygenURL, heygenInterval = srv.URL, time.Millisecond
	h := NewHeygenProvider(nil)
	ctx := context.Background()

	if c, err := h.CheckConnection(ctx, "bad"); c != nil || err != nil {
		t.Errorf("bad key %v %v", c, err)
	}
	c, err := h.CheckConnection(ctx, "key")
	if err != nil || *c != (Connection{Name: "Ada L", Username: "ada", ID: "ada"}) {
		t.Fatalf("%+v %v", c, err)
	}
	url, err := h.SendData(ctx, "key", json.RawMessage(`{"voice":"hi","avatar":"a1","aspect_ratio":"story","captions":"yes","selectedVoice":"v1","type":"avatar"}`))
	if err != nil || url != "https://v.mp4" {
		t.Fatalf("%q %v", url, err)
	}
	inputs := generated["video_inputs"].([]any)[0].(map[string]any)
	if generated["caption"] != true || inputs["character"].(map[string]any)["avatar_id"] != "a1" ||
		generated["dimension"].(map[string]any)["height"] != 1280.0 {
		t.Errorf("body %v", generated)
	}
}

func TestReelFarm(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("video_type") == "ugc" {
			if r.URL.Query().Get("offset") != "20" {
				w.WriteHeader(400)
				return
			}
			w.Write([]byte(`{"videos":[{"id":7,"video_url":"https://r/1.mp4?sig=1","thumbnail":"https://r/t.jpg"}]}`))
			return
		}
		w.WriteHeader(500)
	}))
	defer srv.Close()
	reelFarmURL = srv.URL
	r := NewReelFarmProvider()

	out, err := r.Functions()["listMedia"](context.Background(), "key", json.RawMessage(`{"page":2}`))
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(out)
	if string(data) != `{"results":[{"id":"7","url":"https://r/1.mp4?sig=1","thumbnail":"https://r/t.jpg","name":"ugc","type":"video"}],"pages":1}` {
		t.Errorf("got %s", data)
	}

	items, _ := r.ImportMedia(context.Background(), "key", []ImportItem{{URL: "https://r/1.mp4?sig=1#t"}, {Name: "skip"}})
	if len(items) != 1 || items[0] != (ImportItem{URL: "https://r/1.mp4", Name: "reelfarm-video"}) {
		t.Errorf("import %+v", items)
	}
	if _, err := r.SendData(context.Background(), "key", nil); err == nil {
		t.Error("sendData is unsupported")
	}
}
