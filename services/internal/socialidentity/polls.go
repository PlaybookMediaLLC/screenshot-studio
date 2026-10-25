package socialidentity

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// PollLimits are the connected Mastodon server's configuration.polls values.
// Durations are seconds on the wire, minutes in the composer.
type PollLimits struct {
	MaxOptions          int `json:"maxOptions"`
	MaxOptionCharacters int `json:"maxOptionCharacters"`
	MinDurationSeconds  int `json:"minDurationSeconds"`
	MaxDurationSeconds  int `json:"maxDurationSeconds"`
}

func (p PollLimits) Validate() error {
	if p.MaxOptions < 2 || p.MaxOptions > 20 || p.MaxOptionCharacters < 1 || p.MaxOptionCharacters > 1000 || p.MinDurationSeconds < 1 || p.MaxDurationSeconds < p.MinDurationSeconds || p.MaxDurationSeconds > 366*24*60*60 {
		return ErrInvalid
	}
	return nil
}

// Check refuses unknown limits, media, duplicate choices and out-of-range polls.
func (p *PollLimits) Check(options []string, minutes, media int) error {
	if p == nil || p.Validate() != nil {
		return fmt.Errorf("reconnect Mastodon to verify the server's poll limits")
	}
	if media != 0 {
		return fmt.Errorf("a poll cannot have media")
	}
	if len(options) < 2 || len(options) > p.MaxOptions {
		return fmt.Errorf("this server accepts 2 to %d poll options", p.MaxOptions)
	}
	if minutes < 1 || minutes > 366*24*60 || minutes*60 < p.MinDurationSeconds || minutes*60 > p.MaxDurationSeconds {
		return fmt.Errorf("poll duration is outside this server's accepted range")
	}
	seen := map[string]bool{}
	for _, option := range options {
		text := strings.TrimSpace(option)
		if text == "" || utf8.RuneCountInString(text) > p.MaxOptionCharacters || seen[strings.ToLower(text)] {
			return fmt.Errorf("poll choices must be distinct and 1 to %d characters", p.MaxOptionCharacters)
		}
		seen[strings.ToLower(text)] = true
	}
	return nil
}
