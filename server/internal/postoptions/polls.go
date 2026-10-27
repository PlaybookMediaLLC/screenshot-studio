package postoptions

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// PollLimits are reported by the destination instance, never supplied by a client.
// Field names match Mastodon's Instance.configuration.polls contract.
type PollLimits struct {
	MaxOptions             int `json:"max_options"`
	MaxCharactersPerOption int `json:"max_characters_per_option"`
	MinExpiration          int `json:"min_expiration"`
	MaxExpiration          int `json:"max_expiration"`
}

// Validate checks a poll against freshly fetched instance limits. Unknown or
// malformed limits fail closed; an outage cannot silently enable a capability.
func (l *PollLimits) Validate(poll *Poll, media int) error {
	if l == nil || l.MaxOptions < 2 || l.MaxCharactersPerOption < 1 || l.MinExpiration < 1 || l.MaxExpiration < l.MinExpiration {
		return fmt.Errorf("This server's poll limits could not be verified. Try again later.")
	}
	if poll == nil {
		return nil
	}
	if media > 0 {
		return fmt.Errorf("A Mastodon poll cannot have images, video or a document; remove them or the poll.")
	}
	if len(poll.Options) < 2 || len(poll.Options) > l.MaxOptions {
		return fmt.Errorf("This server allows 2 to %d poll choices.", l.MaxOptions)
	}
	for _, option := range poll.Options {
		if !utf8.ValidString(option) || strings.TrimSpace(option) == "" || utf8.RuneCountInString(option) > l.MaxCharactersPerOption {
			return fmt.Errorf("Each poll choice is 1 to %d characters on this server.", l.MaxCharactersPerOption)
		}
	}
	seconds := int64(poll.DurationMinutes) * 60
	if seconds < int64(l.MinExpiration) || seconds > int64(l.MaxExpiration) {
		return fmt.Errorf("This server allows polls lasting %d to %d seconds.", l.MinExpiration, l.MaxExpiration)
	}
	return nil
}
