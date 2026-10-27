package socialidentity

import (
	"fmt"
	"os"
	"regexp"
)

var photoUserID = regexp.MustCompile(`^[0-9]{1,19}$`)

// CheckXPhotoTagIDs enforces the CreatePostsMedia schema and activation gate.
// Activation requires operator verification against an authorized test account.
func CheckXPhotoTagIDs(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if os.Getenv("PLATFORM_X_PHOTO_TAGS") != "true" {
		return fmt.Errorf("Native X photo tagging is awaiting authorized account verification on this installation.")
	}
	if len(ids) > 10 {
		return fmt.Errorf("X supports at most ten tagged users per post.")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !photoUserID.MatchString(id) || seen[id] {
			return fmt.Errorf("Photo tags must be distinct native X user IDs.")
		}
		seen[id] = true
	}
	return nil
}

// CheckXPhotoTags also checks the exact uploaded MIME types.
func CheckXPhotoTags(ids []string, media []XMedia) error {
	if err := CheckXPhotoTagIDs(ids); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	if len(media) == 0 {
		return fmt.Errorf("Photo tags require a static image.")
	}
	for _, item := range media {
		if item.MIME != "image/jpeg" && item.MIME != "image/png" && item.MIME != "image/webp" {
			return fmt.Errorf("Photo tags require static images, without GIFs or videos.")
		}
	}
	return nil
}
