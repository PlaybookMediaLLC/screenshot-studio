package videos

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func clearEnv(t *testing.T) {
	for _, key := range []string{"EVOLINK_API_KEY", "ELEVENSLABS_API_KEY", "TRANSLOADIT_AUTH", "TRANSLOADIT_SECRET", "OPENAI_API_KEY", "FAL_KEY"} {
		t.Setenv(key, "")
	}
}

func TestGetAllVideos(t *testing.T) {
	clearEnv(t)
	m := NewManager(nil, nil)
	if got := m.GetAllVideos(); len(got) != 0 {
		t.Fatalf("nothing is available without keys: %+v", got)
	}

	t.Setenv("EVOLINK_API_KEY", "k")
	got := m.GetAllVideos()
	if len(got) != 1 || got[0].Identifier != "seedance" {
		t.Fatalf("%+v", got)
	}
	data, _ := json.Marshal(got)
	if string(data) != `[{"identifier":"seedance","title":"Seedance 2.0 (Audio + Video)","tools":[],"description":"Generate videos with the most advanced video model.","placement":"text-to-image","trial":false}]` {
		t.Errorf("json %s", data)
	}

	for _, key := range []string{"ELEVENSLABS_API_KEY", "TRANSLOADIT_AUTH", "TRANSLOADIT_SECRET", "OPENAI_API_KEY", "FAL_KEY"} {
		t.Setenv(key, "k")
	}
	if got := m.GetAllVideos(); len(got) != 2 || got[0].Identifier != "image-text-slides" || !got[0].Trial {
		t.Errorf("%+v", got)
	}
	if ids := AvailableIdentifiers(); strings.Join(ids, ",") != "image-text-slides,seedance" {
		t.Errorf("ids %v", ids)
	}
}

func TestGetVideoByNameAndFunctions(t *testing.T) {
	clearEnv(t)
	m := NewManager(nil, nil)
	slides := m.GetVideoByName("image-text-slides")
	if slides == nil || slides.Available {
		t.Fatalf("unavailable providers are still found: %+v", slides)
	}
	if m.CheckAvailableVideoFunction(slides.Instance, "loadVoices") || !m.CheckAvailableVideoFunction(slides.Instance, "process") {
		t.Error("only exposed functions are callable")
	}
	if m.GetVideoByName("nope") != nil {
		t.Error("unknown")
	}
}

func TestValidate(t *testing.T) {
	slides := NewImagesSlides(nil, nil)
	err := ProcessAndValidate(slides, json.RawMessage(`{"voice":"v"}`))
	if err == nil || !strings.Contains(err.Error(), "prompt must be a string") {
		t.Errorf("%v", err)
	}
	if ProcessAndValidate(slides, json.RawMessage(`{"voice":"v","prompt":5}`)) != nil {
		t.Error("implicit conversion makes a number a string")
	}

	got := NewSeedance().Validate(json.RawMessage(`{"images":[{"id":"1"},"x",{},{}]}`))
	want := []string{
		"prompt must be a string",
		"images must contain no more than 3 elements",
		"images.0.path must be a string",
		"nested property images must be either object or array",
		"images.2.id must be a string", "images.2.path must be a string",
		"images.3.id must be a string", "images.3.path must be a string",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("got %q", got)
	}
	if got := NewSeedance().Validate(json.RawMessage(`{"prompt":"p"}`)); strings.Join(got, "|") != "images must contain no more than 3 elements|images must be an array" {
		t.Errorf("missing images %q", got)
	}
}

func TestSeedanceProcess(t *testing.T) {
	var created map[string]any
	polls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/videos/generations":
			json.NewDecoder(r.Body).Decode(&created)
			w.Write([]byte(`{"id":"task-1"}`))
		case "/tasks/task-1":
			polls++
			if polls < 2 {
				w.Write([]byte(`{"status":"processing"}`))
				return
			}
			w.Write([]byte(`{"status":"completed","results":["https://v/1.mp4"]}`))
		}
	}))
	defer srv.Close()
	evolinkURL, pollInterval = srv.URL, time.Millisecond

	url, err := NewSeedance().Process(context.Background(), "horizontal", json.RawMessage(`{"prompt":"p","images":[{"id":"1","path":"https://i/1.png"}]}`))
	if err != nil || url != "https://v/1.mp4" {
		t.Fatalf("%q %v", url, err)
	}
	if created["model"] != "seedance-2.0-fast-reference-to-video" || created["aspect_ratio"] != "16:9" || created["duration"] != 8.0 {
		t.Errorf("body %v", created)
	}
}

func TestStringifySRT(t *testing.T) {
	got := stringifySRT([]cue{{0, 3500.7, "Hello"}, {3500.7, 3723456, "World"}})
	want := "1\n00:00:00,000 --> 00:00:03,500\nHello\n\n2\n00:00:03,500 --> 01:02:03,456\nWorld\n\n"
	if got != want {
		t.Errorf("got %q", got)
	}
}

func TestMP3Duration(t *testing.T) {
	// 128 kbps MPEG1 Layer III CBR: 16000 bytes per second
	frame := []byte{0xFF, 0xFB, 0x90, 0x64}
	data := append([]byte("ID3\x03\x00\x00\x00\x00\x00\x00"), frame...)
	data = append(data, make([]byte, 32000-len(frame))...)
	if got := mp3Duration(data); got != 2 {
		t.Errorf("cbr %v", got)
	}
	if mp3Duration([]byte("not audio")) != 0 {
		t.Error("no frame")
	}
}
