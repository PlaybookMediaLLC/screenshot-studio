package threads

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"net/http"
	"strings"
	"testing"
)

func TestPollContainerAndPublishedRecovery(t *testing.T) {
	creates, publishes := 0, 0
	published := false
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/u/threads":
			creates++
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatal(err)
			}
			var poll map[string]string
			if err := json.Unmarshal([]byte(r.FormValue("poll_attachment")), &poll); err != nil {
				t.Fatal(err)
			}
			if len(poll) != 4 || poll["option_a"] != " Exact " || poll["option_d"] != strings.Repeat("界", 25) {
				t.Errorf("poll changed: %+v", poll)
			}
			if r.FormValue("media_type") != "TEXT" || r.FormValue("auto_publish_text") != "" {
				t.Error("poll bypassed container workflow")
			}
			w.Write([]byte(`{"id":"container"}`))
		case "/v1.0/container":
			if published {
				w.Write([]byte(`{"status":"PUBLISHED"}`))
			} else {
				w.Write([]byte(`{"status":"FINISHED"}`))
			}
		case "/v1.0/u/threads_publish":
			publishes++
			published = true
			w.Write([]byte(`{"id":"live"}`))
		case "/v1.0/live":
			w.Write([]byte(`{"permalink":"https://threads.net/@user/post/live"}`))
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
		}
	})
	p := New()
	ctx := context.Background()
	account := &ent.Integration{InternalID: "u"}
	poll := &integrations.PollDetails{Options: []string{" Exact ", "Second", "Third", strings.Repeat("界", 25)}}
	result, err := p.PostPending(ctx, "u", "token", []integrations.PostDetails{{ID: "one", Message: "Question?", Poll: poll}}, account)
	if err != nil {
		t.Fatal(err)
	}
	done, err := p.FinalizePost(ctx, "token", result[0].PendingData, account)
	if err != nil || done.Status != "completed" {
		t.Fatal(done, err)
	}
	recovery, err := p.CheckPostStatus(ctx, "token", result[0].PendingData, account)
	if err != nil || recovery.Status != "completed" || publishes != 1 || creates != 1 {
		t.Fatal("published container was not recovered", recovery, err)
	}
	for _, bad := range []*integrations.PollDetails{{Options: []string{"one"}}, {Options: []string{"a", "b"}, DurationMinutes: 1440}, {Options: []string{strings.Repeat("x", 26), "b"}}} {
		if _, err := p.PostPending(ctx, "u", "token", []integrations.PostDetails{{Message: "Question?", Poll: bad}}, account); err == nil {
			t.Fatal("invalid poll accepted")
		}
	}
	if _, err := p.PostPending(ctx, "u", "token", []integrations.PostDetails{{Message: "Question?", Poll: poll, Media: []integrations.MediaContent{{Path: "https://example.test/image.png"}}}}, account); err == nil {
		t.Fatal("media poll accepted")
	}
	if creates != 1 {
		t.Fatal("invalid polls reached provider")
	}
}
