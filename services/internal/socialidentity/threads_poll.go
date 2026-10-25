package socialidentity

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// CheckThreadsPoll enforces Meta's text-only poll attachment contract. The
// duration is provider-controlled; the editor exposes only its 24-hour default.
func CheckThreadsPoll(options []string, minutes, media int, multiple bool) error {
	if len(options) < 2 || len(options) > 4 {
		return fmt.Errorf("A Threads poll has 2 to 4 choices.")
	}
	if minutes != 0 && minutes != 1440 {
		return fmt.Errorf("Threads polls use a fixed 24-hour duration.")
	}
	if media != 0 || multiple {
		return fmt.Errorf("Threads polls are single-choice text posts without media.")
	}
	for _, option := range options {
		if strings.TrimSpace(option) == "" || utf8.RuneCountInString(option) > 25 {
			return fmt.Errorf("Each Threads poll choice is 1 to 25 characters.")
		}
	}
	return nil
}
