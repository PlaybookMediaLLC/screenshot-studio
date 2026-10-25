package postoptions

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// CheckThreadsPoll follows Meta's create-posts/polls contract: a text-only
// post with 2–4 choices, 1–25 characters each, and provider-controlled expiry.
// Duration zero explicitly represents the API's default, not a requested day.
func CheckThreadsPoll(options []string, duration, media int, multiple bool) error {
	if media > 0 || multiple || duration != 0 {
		return fmt.Errorf("Threads polls require a text-only, single-choice post and provider-default duration")
	}
	if len(options) < 2 || len(options) > 4 {
		return fmt.Errorf("Threads polls have 2 to 4 choices")
	}
	for _, option := range options {
		if !utf8.ValidString(option) || strings.TrimSpace(option) == "" || utf8.RuneCountInString(option) > 25 {
			return fmt.Errorf("Threads poll choices must contain 1 to 25 characters")
		}
	}
	return nil
}
