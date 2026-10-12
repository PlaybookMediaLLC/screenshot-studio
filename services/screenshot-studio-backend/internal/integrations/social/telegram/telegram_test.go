package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

var (
	_ integrations.Provider  = (*Provider)(nil)
	_ integrations.Commenter = (*Provider)(nil)
)

type recorder struct {
	mu    sync.Mutex
	calls []string
	forms []map[string]string
}

func setup(t *testing.T, handle func(method string, form map[string]string) string) (*Provider, *recorder) {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("TELEGRAM_TOKEN", "TOKEN")
	rec := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method := strings.TrimPrefix(r.URL.Path, "/botTOKEN/")
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
			r.ParseMultipartForm(1 << 20)
		} else {
			r.ParseForm()
		}
		form := map[string]string{}
		for k, v := range r.Form {
			form[k] = v[0]
		}
		if r.MultipartForm != nil {
			for k := range r.MultipartForm.File {
				form["file:"+k] = r.MultipartForm.File[k][0].Filename
			}
		}
		rec.mu.Lock()
		rec.calls = append(rec.calls, method)
		rec.forms = append(rec.forms, form)
		rec.mu.Unlock()
		body := handle(method, form)
		if strings.Contains(body, `"ok":false`) {
			w.WriteHeader(http.StatusBadRequest)
		}
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
	return New(), rec
}

func TestPostText(t *testing.T) {
	p, rec := setup(t, func(string, map[string]string) string {
		return `{"ok":true,"result":{"message_id":16}}`
	})
	out, err := p.Post(context.Background(), "mychannel", "-1001234", []integrations.PostDetails{{ID: "p1", Message: "hello"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].PostID != "16" || out[0].ReleaseURL != "https://t.me/mychannel/16" || out[0].Status != "completed" {
		t.Fatalf("got %+v", out[0])
	}
	if rec.calls[0] != "sendMessage" || rec.forms[0]["chat_id"] != "-1001234" || rec.forms[0]["parse_mode"] != "HTML" {
		t.Fatalf("got %v %v", rec.calls, rec.forms)
	}
	if got := releaseURL("undefined", "-1001234", 3); got != "https://t.me/c/1234/3" {
		t.Fatalf("private link %s", got)
	}
}

func TestCommentMediaGroupWithLocalFile(t *testing.T) {
	dir := t.TempDir()
	local := filepath.Join(dir, "a.png")
	os.WriteFile(local, []byte("png"), 0o600)
	t.Setenv("FRONTEND_URL", "http://front")
	p, rec := setup(t, func(string, map[string]string) string {
		return `{"ok":true,"result":[{"message_id":20},{"message_id":21}]}`
	})
	out, err := p.Comment(context.Background(), "chan", "10", "", "-100", []integrations.PostDetails{{
		ID: "c1", Message: "caption",
		Media: []integrations.MediaContent{{Path: "http://front" + local}, {Path: "https://cdn.example/b.mp4"}},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].PostID != "20" {
		t.Fatalf("got %+v", out[0])
	}
	form := rec.forms[0]
	if rec.calls[0] != "sendMediaGroup" || form["reply_to_message_id"] != "10" || form["file:0"] != "a.png" {
		t.Fatalf("got %v %v", rec.calls, form)
	}
	var media []map[string]string
	json.Unmarshal([]byte(form["media"]), &media)
	if media[0]["media"] != "attach://0" || media[0]["type"] != "photo" || media[0]["caption"] != "caption" ||
		media[1]["media"] != "https://cdn.example/b.mp4" || media[1]["type"] != "video" || media[1]["caption"] != "" {
		t.Fatalf("got %v", media)
	}
}

func TestPostBadRequest(t *testing.T) {
	p, _ := setup(t, func(string, map[string]string) string {
		return `{"ok":false,"error_code":400,"description":"Bad Request: failed to get HTTP URL content"}`
	})
	_, err := p.Post(context.Background(), "c", "1", []integrations.PostDetails{{ID: "p", Message: "x", Media: []integrations.MediaContent{{Path: "https://x/y.jpg"}}}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody ||
		temporalx.FailureMessage(err) != "Telegram could not download your media file, please check the file and try again" {
		t.Fatalf("got %v", err)
	}
}

func TestGetBotID(t *testing.T) {
	p, rec := setup(t, func(method string, form map[string]string) string {
		switch method {
		case "getUpdates":
			return `{"ok":true,"result":[{"update_id":5,"channel_post":{"message_id":7,"text":"/connect abc","chat":{"id":-100}}}]}`
		case "getMe":
			return `{"ok":true,"result":{"id":99}}`
		case "getChatMember":
			return `{"ok":true,"result":{"status":"administrator","can_delete_messages":true}}`
		case "sendMessage":
			return `{"ok":true,"result":{"message_id":8}}`
		}
		return `{"ok":true,"result":true}`
	})
	oldWait := deleteSuccessWait
	deleteSuccessWait = 0
	t.Cleanup(func() { deleteSuccessWait = oldWait })
	got, err := p.GetBotID(context.Background(), BotIDQuery{ID: "4", Word: "abc"})
	if err != nil || got.ChatID != -100 {
		t.Fatalf("got %+v %v", got, err)
	}
	if rec.forms[0]["offset"] != "4" || rec.calls[3] != "deleteMessage" || rec.forms[3]["message_id"] != "7" {
		t.Fatalf("got %v %v", rec.calls, rec.forms)
	}
	// the success message is deleted after deleteSuccessWait
	for i := 0; ; i++ {
		rec.mu.Lock()
		n := len(rec.calls)
		rec.mu.Unlock()
		if n == 6 {
			break
		}
		if i > 200 {
			t.Fatal("success message never deleted")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if rec.forms[5]["message_id"] != "8" {
		t.Fatalf("deleted %v", rec.forms[5])
	}

	p2, _ := setup(t, func(string, map[string]string) string {
		return `{"ok":true,"result":[{"update_id":5,"message":{"message_id":7,"text":"hi","chat":{"id":1}}}]}`
	})
	got, err = p2.GetBotID(context.Background(), BotIDQuery{Word: "abc"})
	if err != nil || got.LastChatID != 6 || got.ChatID != 0 {
		t.Fatalf("got %+v %v", got, err)
	}
}
