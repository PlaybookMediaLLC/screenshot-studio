package discord

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

var (
	_ integrations.Provider         = (*Provider)(nil)
	_ integrations.Commenter        = (*Provider)(nil)
	_ integrations.NicknameChanger  = (*Provider)(nil)
	_ integrations.MentionFormatter = (*Provider)(nil)
)

func fake(t *testing.T, handler http.HandlerFunc) *Provider {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("DISCORD_BOT_TOKEN_ID", "bot")
	srv := httptest.NewServer(handler)
	old := apiBase
	apiBase = srv.URL
	t.Cleanup(func() { apiBase = old; srv.Close() })
	p := New()
	p.RetryDelay = time.Millisecond
	return p
}

func TestPostWithMedia(t *testing.T) {
	file := filepath.Join(t.TempDir(), "pic.png")
	if err := os.WriteFile(file, []byte("PNGDATA"), 0o600); err != nil {
		t.Fatal(err)
	}
	var payload, fileBody, auth string
	var length int64
	p := fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/channels/c1/messages" {
			w.WriteHeader(404)
			return
		}
		auth, length = r.Header.Get("Authorization"), r.ContentLength
		_, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			data, _ := io.ReadAll(part)
			if part.FormName() == "payload_json" {
				payload = string(data)
			} else if part.FormName() == "files[0]" && part.FileName() == "pic.png" {
				fileBody = string(data)
			}
		}
		_, _ = io.WriteString(w, `{"id":"m1"}`)
	})
	res, err := p.Post(context.Background(), "g1", "", []integrations.PostDetails{{
		ID: "p", Message: "hi [[[@123]]]", Settings: json.RawMessage(`{"channel":"c1"}`),
		Media: []integrations.MediaContent{{Path: file}},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].ReleaseURL != "https://discord.com/channels/g1/c1/m1" || res[0].Status != "success" {
		t.Fatalf("%+v", res[0])
	}
	if payload != `{"content":"hi <@123>","attachments":[{"id":0,"description":"Picture 0","filename":"pic.png"}]}` {
		t.Fatalf("payload %s", payload)
	}
	if fileBody != "PNGDATA" || auth != "Bot bot" || length <= 0 {
		t.Fatalf("file %q auth %q length %d", fileBody, auth, length)
	}
}

func TestPostErrorClassified(t *testing.T) {
	p := fake(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		_, _ = io.WriteString(w, `{"message":"Missing Permissions","code":50013}`)
	})
	_, err := p.Post(context.Background(), "g", "", []integrations.PostDetails{{Settings: json.RawMessage(`{"channel":"c"}`)}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Bot lacks permission to send messages in this channel" {
		t.Fatalf("err = %v", err)
	}
}

func TestCommentCreatesThread(t *testing.T) {
	var paths []string
	p := fake(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/threads") {
			_, _ = io.WriteString(w, `{"id":"t1"}`)
			return
		}
		_, _ = io.WriteString(w, `{"id":"m2"}`)
	})
	res, err := p.Comment(context.Background(), "g", "m1", "", "", []integrations.PostDetails{{ID: "c", Settings: json.RawMessage(`{"channel":"c1"}`)}}, &ent.Integration{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(paths, ",") != "/api/channels/c1/messages/m1/threads,/api/channels/t1/messages" || res[0].ReleaseURL != "https://discord.com/channels/g/t1/m2" {
		t.Fatalf("%v %+v", paths, res)
	}
}

func TestChannelsAndMention(t *testing.T) {
	p := fake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/guilds/g/channels":
			_, _ = io.WriteString(w, `[{"id":"1","name":"text","type":0},{"id":"2","name":"voice","type":2},{"id":"3","name":"forum","type":15}]`)
		case "/api/guilds/g/roles":
			_, _ = io.WriteString(w, `[{"id":"9","name":"@everyone"},{"id":"8","name":"@team"}]`)
		case "/api/guilds/g/members/search":
			_, _ = io.WriteString(w, `[{"user":{"id":"7","username":"teo","global_name":null,"avatar":"av"}}]`)
		}
	})
	channels, err := p.Functions()["channels"](context.Background(), "", nil, "g", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := json.Marshal(channels); string(got) != `[{"id":"1","name":"text"},{"id":"3","name":"forum"}]` {
		t.Fatalf("channels %s", got)
	}
	mentions, _, err := p.Mention(context.Background(), "", "e", "g", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(mentions) != 4 || mentions[3].Label != "teo" || mentions[0].ID != "here" || mentions[1].ID != "everyone" || mentions[2].ID != "&8" || mentions[2].Label != "team" {
		t.Fatalf("%+v", mentions)
	}
	if p.MentionFormat("@7", "teo") != "[[[@7]]]" || p.MentionFormat("here", "@here") != "@here" {
		t.Fatal("mentionFormat")
	}
}

func TestDtoValidate(t *testing.T) {
	empty := ""
	if len((&DiscordDto{}).Validate()) != 3 || (&DiscordDto{Channel: &empty}).Validate()[0] != "channel must be longer than or equal to 1 characters" {
		t.Fatal("validate")
	}
}
