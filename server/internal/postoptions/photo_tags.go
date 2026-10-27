package postoptions

import (
	"fmt"
	"regexp"
)

var photoTagID = regexp.MustCompile(`^[0-9]{1,19}$`)

// CheckPhotoTags validates the X create-post media.tagged_user_ids contract.
func CheckPhotoTags(ids []string) error {
	if len(ids) > 10 {
		return fmt.Errorf("Tag at most ten X accounts in photos.")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !photoTagID.MatchString(id) || seen[id] {
			return fmt.Errorf("Photo tags must be distinct numeric X user IDs of at most 19 digits.")
		}
		seen[id] = true
	}
	return nil
}
