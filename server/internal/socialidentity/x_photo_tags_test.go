package socialidentity

import "testing"

func TestXPhotoTagsRequireActivationAndNativeStaticImageIDs(t *testing.T) {
	image := []XMedia{{MIME: "image/png", Bytes: 100}}
	t.Setenv("PLATFORM_X_PHOTO_TAGS", "")
	if CheckXPhotoTags([]string{"123"}, image) == nil {
		t.Fatal("activation bypassed")
	}
	t.Setenv("PLATFORM_X_PHOTO_TAGS", "true")
	if err := CheckXPhotoTags([]string{"123", "456"}, image); err != nil {
		t.Fatal(err)
	}
	for _, ids := range [][]string{{"@user"}, {"1", "1"}, {"12345678901234567890"}} {
		if CheckXPhotoTags(ids, image) == nil {
			t.Fatal("invalid tag accepted")
		}
	}
	for _, mime := range []string{"video/mp4", "image/gif"} {
		if CheckXPhotoTags([]string{"1"}, []XMedia{{MIME: mime}}) == nil {
			t.Fatal("non-photo accepted")
		}
	}
	if CheckXPhotoTags([]string{"1"}, nil) == nil {
		t.Fatal("tags without photo accepted")
	}
}
