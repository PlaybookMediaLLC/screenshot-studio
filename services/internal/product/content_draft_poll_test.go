package product

import (
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
)

func TestXPollAdmissionKeepsExactValues(t *testing.T) {
	poll := &postoptions.Poll{Options: []string{" A ", strings.Repeat("界", 25)}, DurationMinutes: 6}
	if err := checkPoll("x", poll, nil, 0); err != nil {
		t.Fatal(err)
	}
	if poll.DurationMinutes != 6 || poll.Options[0] != " A " {
		t.Fatal("poll rewritten")
	}
	for _, option := range []string{string([]byte{0xff}), strings.Repeat("界", 26), "   "} {
		poll.Options[0] = option
		if checkPoll("x", poll, nil, 0) == nil {
			t.Fatal("invalid option admitted")
		}
	}
}
