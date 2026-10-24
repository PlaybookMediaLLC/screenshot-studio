package x

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
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
