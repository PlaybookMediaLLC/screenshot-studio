package x

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func TestNativePhotoTagsRemainMediaMetadata(t *testing.T) {
	t.Setenv("PLATFORM_X_PHOTO_TAGS", "true")
	calls, done := fakePublishingX(t, func(r recorded) (int, string) { return 201, `{"data":{"id":"99"}}` })
	defer done()
	pending := pendingData{Message: "Photo caption", Settings: pendingSettings{TaggedUserIDs: []string{"123", "456"}}, MediaIDs: []string{"11"}, MediaFacts: []mediaFacts{{MIME: "image/png", Bytes: 100}}, Attempting: true, Confirmed: true}
	_, err := New().FinalizePost(context.Background(), "a:b", marshal(pending), publishingAccount())
	if err != nil {
		t.Fatal(err)
	}
	var body tweetBody
	if len(*calls) != 2 || json.Unmarshal((*calls)[1].body, &body) != nil || body.Media == nil || !reflect.DeepEqual(body.Media.TaggedUserIDs, []string{"123", "456"}) || body.Text != "Photo caption" {
		t.Fatalf("native tags lost or caption changed: %+v", body)
	}
}

func TestNativePhotoTagsValidateBeforePublication(t *testing.T) {
	t.Setenv("PLATFORM_X_PHOTO_TAGS", "true")
	for _, tc := range []struct {
		name string
		tags []string
		mime string
		want bool
	}{
		{"native", []string{"123", "456"}, "image/png", true},
		{"duplicate", []string{"123", "123"}, "image/png", false},
		{"malformed", []string{"@alice"}, "image/png", false},
		{"overlong", []string{"12345678901234567890"}, "image/png", false},
		{"video", []string{"123"}, "video/mp4", false},
		{"eleven", []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"}, "image/png", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mutations := 0
			_, done := fakePublishingX(t, func(r recorded) (int, string) {
				if r.method != "POST" {
					return 200, `{"data":{"id":"native-x"}}`
				}
				mutations++
				var body struct {
					Media struct {
						Tags []string `json:"tagged_user_ids"`
					} `json:"media"`
				}
				if err := json.Unmarshal(r.body, &body); err != nil || len(body.Media.Tags) != 2 || body.Media.Tags[0] != "123" {
					t.Errorf("wrong native payload: %s", r.body)
				}
				return 201, `{"data":{"id":"99"}}`
			})
			defer done()
			pending := pendingData{Message: "Photos", Settings: pendingSettings{TaggedUserIDs: tc.tags}, MediaIDs: []string{"11"}, MediaFacts: []mediaFacts{{MIME: tc.mime, Bytes: 100}}, Attempting: true, Confirmed: true}
			_, err := New().FinalizePost(context.Background(), "a:b", marshal(pending), publishingAccount())
			if tc.want {
				if err != nil || mutations != 1 {
					t.Fatalf("%v mutations=%d", err, mutations)
				}
			} else if temporalx.FailureType(err) != temporalx.TypePublicationRejected || mutations != 0 {
				t.Fatalf("unsafe rejection: %v mutations=%d", err, mutations)
			}
		})
	}
}
