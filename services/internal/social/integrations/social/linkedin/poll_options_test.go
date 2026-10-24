package linkedin

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func TestNativePollAndResharePayloads(t *testing.T) {
	f, _ := newFake(t, map[string]http.HandlerFunc{"POST /rest/posts": func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-restli-id", "urn:li:share:987")
		w.WriteHeader(http.StatusCreated)
	}})
	for minutes, duration := range map[int]string{1440: "ONE_DAY", 4320: "THREE_DAYS", 10080: "SEVEN_DAYS", 20160: "FOURTEEN_DAYS"} {
		data := pendingData{AuthorID: "person1", PostType: Personal, Message: "Pick a release", Question: &integrations.PollDetails{Question: strings.Repeat("界", 140), Options: []string{strings.Repeat("界", 30), "Beta"}, DurationMinutes: minutes}}
		id, err := New().createMainPost(context.Background(), &data, "fixture-token")
		if err != nil || id != "urn:li:share:987" {
			t.Fatalf("id=%s err=%v", id, err)
		}
		calls := f.find("POST", "/rest/posts")
		var payload struct {
			Content struct {
				Poll struct {
					Question string
					Settings struct{ Duration string }
					Options  []struct{ Text string }
				}
			}
		}
		if err := json.Unmarshal(calls[len(calls)-1].body, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Content.Poll.Settings.Duration != duration || payload.Content.Poll.Options[0].Text != strings.Repeat("界", 30) || payload.Content.Poll.Question != data.Question.Question {
			t.Fatalf("poll lost: %s", calls[len(calls)-1].body)
		}
	}
	data := pendingData{AuthorID: "person1", PostType: Personal, Message: "Commentary", ReshareParent: "urn:li:share:123"}
	if _, err := New().createMainPost(context.Background(), &data, "fixture-token"); err != nil {
		t.Fatal(err)
	}
	calls := f.find("POST", "/rest/posts")
	var payload postPayload
	if err := json.Unmarshal(calls[len(calls)-1].body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ReshareContext["parent"] != "urn:li:share:123" || payload.Commentary != "Commentary" || payload.Content != nil {
		t.Fatalf("not a native reshare: %+v", payload)
	}
}

func TestInvalidLinkedInPollNeverUploadsOrCreates(t *testing.T) {
	f, _ := newFake(t, nil)
	for _, scenario := range []string{"duration", "question", "choice", "empty", "multiple", "media", "reshare"} {
		t.Run(scenario, func(t *testing.T) {
			poll := &integrations.PollDetails{Question: "Choose", Options: []string{"A", "B"}, DurationMinutes: 1440}
			post := integrations.PostDetails{Message: "Choose", Poll: poll}
			switch scenario {
			case "duration":
				poll.DurationMinutes = 60
			case "question":
				poll.Question = strings.Repeat("x", 141)
			case "choice":
				poll.Options[0] = strings.Repeat("x", 31)
			case "empty":
				poll.Options = nil
			case "multiple":
				poll.Multiple = true
			case "media":
				post.Media = []integrations.MediaContent{{Path: "https://example.com/picture.png"}}
			case "reshare":
				post.Settings = json.RawMessage(`{"reshare_parent":"urn:li:share:123"}`)
			}
			if _, err := New().PostPendingAs(context.Background(), "person1", "fixture-token", []integrations.PostDetails{post}, Personal); err == nil {
				t.Fatal("invalid poll admitted")
			}
		})
	}
	if len(f.calls) != 0 {
		t.Fatalf("invalid poll performed %d requests", len(f.calls))
	}
}
