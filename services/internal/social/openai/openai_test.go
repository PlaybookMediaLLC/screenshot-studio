package openai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

type recorded struct {
	path string
	auth string
	body map[string]any
}

// server answers each request with the next handler response.
func server(t *testing.T, answer func(n int, body map[string]any) (int, string)) (*[]recorded, func()) {
	t.Helper()
	var mu sync.Mutex
	var calls []recorded
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		var body map[string]any
		json.Unmarshal(data, &body)
		mu.Lock()
		calls = append(calls, recorded{path: r.URL.Path, auth: r.Header.Get("Authorization"), body: body})
		n := len(calls)
		mu.Unlock()
		status, out := answer(n, body)
		w.Header().Set("retry-after-ms", "1")
		w.WriteHeader(status)
		w.Write([]byte(out))
	}))
	old := baseURL
	baseURL = srv.URL
	t.Setenv("OPENAI_BASE_URL", "")
	return &calls, func() { srv.Close(); baseURL = old }
}

func chatAnswer(contents ...string) string {
	choices := []map[string]any{}
	for _, c := range contents {
		choices = append(choices, map[string]any{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": c}})
	}
	data, _ := json.Marshal(map[string]any{"choices": choices})
	return string(data)
}

func TestGeneratePromptForPictureRequest(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-test")
	calls, done := server(t, func(int, map[string]any) (int, string) {
		return 200, chatAnswer(`{"prompt":"a long prompt"}`)
	})
	defer done()

	got, err := NewService().GeneratePromptForPicture(context.Background(), "a cat")
	if err != nil || got != "a long prompt" {
		t.Fatalf("%q %v", got, err)
	}
	c := (*calls)[0]
	if c.path != "/chat/completions" || c.auth != "Bearer sk-test" || c.body["model"] != "gpt-4.1" {
		t.Errorf("request %+v", c)
	}
	messages := c.body["messages"].([]any)
	if messages[1].(map[string]any)["content"] != "prompt: a cat" || messages[0].(map[string]any)["role"] != "system" {
		t.Errorf("messages %v", messages)
	}
	format := c.body["response_format"].(map[string]any)
	schema := format["json_schema"].(map[string]any)
	if format["type"] != "json_schema" || schema["name"] != "picturePrompt" || schema["strict"] != true ||
		schema["schema"].(map[string]any)["additionalProperties"] != false {
		t.Errorf("response_format %v", format)
	}
}

func TestPickClipsDoesNotRetry(t *testing.T) {
	calls, done := server(t, func(int, map[string]any) (int, string) {
		return 500, `{"error":{"message":"overloaded"}}`
	})
	defer done()

	_, err := NewService().PickClips(context.Background(), "t", "en", []Segment{{Start: 0, End: 1.25, Text: "hi"}}, 3)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || err.Error() != "500 overloaded" || len(*calls) != 1 {
		t.Fatalf("%v, %d calls", err, len(*calls))
	}
	user := (*calls)[0].body["messages"].([]any)[1].(map[string]any)["content"]
	if user != "title: t\n\n0 [0.0 - 1.3] hi" && user != "title: t\n\n0 [0.0 - 1.2] hi" {
		t.Errorf("transcript lines %q", user)
	}
}

func TestDefaultRequestsRetry(t *testing.T) {
	calls, done := server(t, func(n int, _ map[string]any) (int, string) {
		if n < 3 {
			return 429, `{"error":{"message":"slow down"}}`
		}
		return 200, `{"data":[{"b64_json":"aGk="}]}`
	})
	defer done()

	got, err := NewService().GenerateImage(context.Background(), "p", true)
	if err != nil || got != "aGk=" || len(*calls) != 3 {
		t.Fatalf("%q %v %d", got, err, len(*calls))
	}
	if body := (*calls)[2].body; body["size"] != "1024x1536" || body["model"] != "chatgpt-image-latest" || body["response_format"] != nil {
		t.Errorf("image body %v", body)
	}
}

func TestGeneratePosts(t *testing.T) {
	_, done := server(t, func(int, map[string]any) (int, string) {
		return 200, chatAnswer("Here:\n[{\"post\":  \"one\"}]\nthanks", "no json at all")
	})
	defer done()

	posts, err := NewService().GeneratePosts(context.Background(), "content")
	if err != nil || len(posts) != 4 {
		t.Fatalf("%v %v", posts, err)
	}
	parsed, empty := 0, 0
	for _, p := range posts {
		list := p.([]any)
		if len(list) == 0 {
			empty++
		} else if list[0].(map[string]any)["post"] == "one" {
			parsed++
		}
	}
	if parsed != 2 || empty != 2 {
		t.Errorf("parsed %d empty %d", parsed, empty)
	}
}

func TestSeparatePostsShrinks(t *testing.T) {
	_, done := server(t, func(n int, body map[string]any) (int, string) {
		name := body["response_format"].(map[string]any)["json_schema"].(map[string]any)["name"]
		if name == "separatePosts" {
			return 200, chatAnswer(`{"posts":["short","this one is far too long"]}`)
		}
		if n == 2 {
			// still too long: z.string().max() fails and it is retried
			return 200, chatAnswer(`{"post":"still too long here"}`)
		}
		return 200, chatAnswer(`{"post":"shrunk"}`)
	})
	defer done()

	res, err := NewService().SeparatePosts(context.Background(), "text", 10)
	if err != nil || strings.Join(res.Posts, "|") != "short|shrunk" {
		t.Errorf("%v %v", res, err)
	}
}

func TestParseRejectsTruncated(t *testing.T) {
	_, done := server(t, func(int, map[string]any) (int, string) {
		return 200, `{"choices":[{"finish_reason":"length","message":{"content":"{"}}]}`
	})
	defer done()
	if _, err := NewService().GenerateVoiceFromText(context.Background(), "x"); err == nil ||
		!strings.Contains(err.Error(), "length limit was reached") {
		t.Errorf("got %v", err)
	}
}

func TestGenerationError(t *testing.T) {
	safety := GenerationError(newAPIError(400, []byte(`{"error":{"message":"Your request was rejected by the safety system, safety_violations=[sexual, violence]"}}`)))
	if safety.Status != 422 || safety.Message() != "Your request was rejected by the AI safety system. Flagged categories: sexual, violence. Please adjust your prompt and try again." {
		t.Errorf("safety %+v", safety)
	}
	generic := GenerationError(newAPIError(400, []byte(`{"error":{"message":"Invalid size"}}`)))
	if generic.Status != 500 || generic.Message() != "AI generation failed, please try again later." {
		t.Errorf("generic %+v", generic)
	}
	kept := httpx.HTTPException("No credits", 402)
	if GenerationError(kept) != kept {
		t.Error("http errors are kept")
	}
	if GenerationError(errors.New("blocked by moderation")).Status != 422 {
		t.Error("plain error message matched")
	}
}

func TestFalService(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/ideogram/v2" || r.Header.Get("Authorization") != "Key fk" {
			w.WriteHeader(403)
			w.Write([]byte("nope"))
			return
		}
		w.Write([]byte(`{"images":[{"url":"https://img/1.jpg"}],"seed":1}`))
	}))
	defer srv.Close()
	falURL = srv.URL + "/"
	t.Setenv("FAL_KEY", "fk")

	url, err := NewFalService().GenerateImageFromText(context.Background(), "ideogram/v2", "p", true)
	if err != nil || url != "https://img/1.jpg" || body["aspect_ratio"] != "9:16" {
		t.Fatalf("%q %v %v", url, err, body)
	}
	if _, err := NewFalService().GenerateImageFromText(context.Background(), "other", "p", false); err == nil || err.Error() != "fal 403: nope" {
		t.Errorf("error %v", err)
	}
}

func TestExtractContent(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`<html><body><nav><h1>Site</h1></nav><article><h1>Title</h1>
<h2>Sub</h2>   <p>Body   text</p></article></body></html>`))
	}))
	defer srv.Close()

	got, err := NewExtractContentService().ExtractContent(context.Background(), srv.URL)
	if err != nil || got != "TitleSub Body text" && got != "Title Sub Body text" {
		t.Errorf("%q %v", got, err)
	}
}
