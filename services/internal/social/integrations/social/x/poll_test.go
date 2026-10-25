package x

import (
	"context"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func TestXPollPreservesExactOptionsAndMinutes(t *testing.T) {
	for _, reply := range []bool{false, true} {
		for _, duration := range []int{5, 6, 90, 10080} {
			calls, done := fakePublishingX(t, func(r recorded) (int, string) { return 201, `{"data":{"id":"99"}}` })
			poll := &integrations.PollDetails{Options: []string{" A ", strings.Repeat("界", 25)}, Duration: 2, DurationMinutes: duration}
			var err error
			if reply {
				_, err = New().Comment(context.Background(), "1", "42", "", "a:b", []integrations.PostDetails{{ID: "p", Message: "Choose", Poll: poll}}, publishingAccount())
			} else {
				_, err = New().FinalizePost(context.Background(), "a:b", marshal(pendingData{Message: "Choose", Poll: poll, Attempting: true, Confirmed: true}), publishingAccount())
			}
			if err != nil {
				t.Fatal(err)
			}
			var body tweetBody
			if len(*calls) != 2 || json.Unmarshal((*calls)[1].body, &body) != nil || body.Poll == nil || body.Poll.DurationMinutes != duration || !reflect.DeepEqual(body.Poll.Options, poll.Options) {
				t.Fatalf("poll changed: %+v requests=%d", body.Poll, len(*calls))
			}
			if reply && (body.Reply == nil || body.Reply.InReplyToTweetID != "42") {
				t.Fatal("reply lost")
			}
			done()
		}
	}
	for _, hours := range []int{1, 168} {
		got, err := checkedPoll(&integrations.PollDetails{Options: []string{"A", "B"}, Duration: hours}, 0, false)
		if err != nil || got.DurationMinutes != hours*60 {
			t.Fatalf("legacy hours: %+v %v", got, err)
		}
	}
}

func TestInvalidXPollStopsBeforeAnyMutation(t *testing.T) {
	for _, tc := range []struct {
		name           string
		poll           integrations.PollDetails
		media, article bool
	}{
		{"no options", integrations.PollDetails{DurationMinutes: 5}, false, false},
		{"one option", integrations.PollDetails{Options: []string{"A"}, DurationMinutes: 5}, false, false},
		{"five options", integrations.PollDetails{Options: []string{"A", "B", "C", "D", "E"}, DurationMinutes: 5}, false, false},
		{"too long", integrations.PollDetails{Options: []string{strings.Repeat("界", 26), "B"}, DurationMinutes: 5}, false, false},
		{"blank", integrations.PollDetails{Options: []string{"  ", "B"}, DurationMinutes: 5}, false, false},
		{"four minutes", integrations.PollDetails{Options: []string{"A", "B"}, DurationMinutes: 4}, false, false},
		{"zero minutes", integrations.PollDetails{Options: []string{"A", "B"}}, false, false},
		{"negative minutes", integrations.PollDetails{Options: []string{"A", "B"}, DurationMinutes: -1, Duration: 24}, false, false},
		{"over week", integrations.PollDetails{Options: []string{"A", "B"}, DurationMinutes: 10081}, false, false},
		{"hours overflow", integrations.PollDetails{Options: []string{"A", "B"}, Duration: math.MaxInt}, false, false},
		{"question", integrations.PollDetails{Options: []string{"A", "B"}, DurationMinutes: 5, Question: "Not sent as text"}, false, false},
		{"media", integrations.PollDetails{Options: []string{"A", "B"}, DurationMinutes: 5}, true, false},
		{"Article", integrations.PollDetails{Options: []string{"A", "B"}, DurationMinutes: 5}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls, done := fakePublishingX(t, func(r recorded) (int, string) { t.Errorf("mutation before validation: %s", r.path); return 500, `{}` })
			defer done()
			post := integrations.PostDetails{ID: "p", Message: "Choose", Poll: &tc.poll}
			pending := pendingData{Message: post.Message, Poll: post.Poll, Attempting: true, Confirmed: true}
			if tc.media {
				post.Media = []integrations.MediaContent{{Path: "must-not-read"}}
				pending.MediaIDs = []string{"11"}
			}
			if tc.article {
				post.Settings = marshal(XDto{PostType: ptr("article"), ArticleTitle: ptr("Title"), ArticleStatus: ptr("published")})
				pending.Settings = pendingSettings{PostType: ptr("article"), ArticleTitle: ptr("Title"), ArticleStatus: ptr("published")}
			}
			_, err := New().PostPending(context.Background(), "1", "a:b", []integrations.PostDetails{post}, publishingAccount())
			if temporalx.FailureType(err) != temporalx.TypePublicationRejected {
				t.Fatalf("prepare: %v", err)
			}
			_, err = New().FinalizePost(context.Background(), "a:b", marshal(pending), publishingAccount())
			if temporalx.FailureType(err) != temporalx.TypePublicationRejected {
				t.Fatalf("finalize: %v", err)
			}
			if !tc.article {
				_, err = New().Comment(context.Background(), "1", "42", "", "a:b", []integrations.PostDetails{post}, publishingAccount())
				if temporalx.FailureType(err) != temporalx.TypePublicationRejected {
					t.Fatalf("reply: %v", err)
				}
			}
			for _, r := range *calls {
				if r.method != "GET" || r.path != "/2/users/me" {
					t.Fatalf("unexpected request %s %s", r.method, r.path)
				}
			}
		})
	}
}

// encoding/json replaces invalid UTF-8 on marshal. Exercise the original
// in-memory input before serialization, where it must be rejected unchanged.
func TestXPollRejectsInvalidUTF8BeforeSerialization(t *testing.T) {
	calls, done := fakePublishingX(t, func(r recorded) (int, string) { t.Errorf("unexpected mutation: %s", r.path); return 500, `{}` })
	defer done()
	post := integrations.PostDetails{ID: "p", Message: "Choose", Poll: &integrations.PollDetails{Options: []string{string([]byte{0xff}), "B"}, DurationMinutes: 5}}
	_, err := New().PostPending(context.Background(), "1", "a:b", []integrations.PostDetails{post}, publishingAccount())
	if temporalx.FailureType(err) != temporalx.TypePublicationRejected {
		t.Fatalf("prepare: %v", err)
	}
	_, err = New().Comment(context.Background(), "1", "42", "", "a:b", []integrations.PostDetails{post}, publishingAccount())
	if temporalx.FailureType(err) != temporalx.TypePublicationRejected || len(*calls) != 2 {
		t.Fatalf("reply: %v calls=%d", err, len(*calls))
	}
}
