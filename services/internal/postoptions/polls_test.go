package postoptions

import (
	"strings"
	"testing"
)

func TestPollLimitsFailClosed(t *testing.T) {
	var missing *PollLimits
	poll := &Poll{DurationMinutes: 5, Options: []string{"a", "b"}}
	if missing.Validate(poll, 0) == nil {
		t.Fatal("missing limits accepted")
	}
	limits := &PollLimits{MaxOptions: 6, MaxCharactersPerOption: 45, MinExpiration: 300, MaxExpiration: 600}
	if err := limits.Validate(poll, 0); err != nil {
		t.Fatal(err)
	}
	for _, option := range []string{"  ", strings.Repeat("界", 46), string([]byte{255})} {
		poll.Options[0] = option
		if limits.Validate(poll, 0) == nil {
			t.Fatal("invalid option accepted")
		}
	}
	poll.Options[0] = "ok"
	poll.DurationMinutes = 11
	if limits.Validate(poll, 0) == nil {
		t.Fatal("duration accepted")
	}
}
