package socialidentity

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// CheckLinkedInPoll pins the Posts API poll contract shared by admission and
// the native adapter. Invalid durations are rejected, never changed to a week.
func CheckLinkedInPoll(question string, options []string, minutes, media int, multiple bool) error {
	if !utf8.ValidString(question) || strings.TrimSpace(question) == "" || utf8.RuneCountInString(question) > 140 {
		return fmt.Errorf("a LinkedIn poll asks a question of 1 to 140 characters")
	}
	if len(options) < 2 || len(options) > 4 {
		return fmt.Errorf("a LinkedIn poll has 2 to 4 choices")
	}
	for _, option := range options {
		if !utf8.ValidString(option) || strings.TrimSpace(option) == "" || utf8.RuneCountInString(option) > 30 {
			return fmt.Errorf("each LinkedIn poll choice is 1 to 30 characters")
		}
	}
	switch minutes {
	case 1440, 4320, 10080, 20160:
	default:
		return fmt.Errorf("a LinkedIn poll stays open 1 day, 3 days, 1 week or 2 weeks")
	}
	if media != 0 || multiple {
		return fmt.Errorf("a LinkedIn poll is single-choice and cannot have media")
	}
	return nil
}
