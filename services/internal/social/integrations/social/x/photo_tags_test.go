package x

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"testing"
)

func TestNativePhotoTagsValidateBeforePublication(t *testing.T) {
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
			pending := pendingData{Message: "Photos", Settings: pendingSettings{PhotoTagIDs: tc.tags}, MediaIDs: []string{"11"}, MediaFacts: []mediaFacts{{MIME: tc.mime, Bytes: 100}}, Attempting: true, Confirmed: true}
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
