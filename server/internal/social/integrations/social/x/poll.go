package x

import (
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func checkedPoll(poll *integrations.PollDetails, mediaCount int, article bool) (*tweetPoll, error) {
	if poll == nil {
		return nil, nil
	}
	if poll.Question != "" {
		return nil, publishRejected("Use the X post text as the poll question.")
	}
	minutes := poll.DurationMinutes
	if minutes == 0 {
		// Old callers send whole hours. Bound before multiplication to prevent
		// overflow; an explicit minute value always retains its exact value.
		if poll.Duration < 1 || poll.Duration > 168 {
			return nil, publishRejected("An X poll stays open 5 minutes to 7 days.")
		}
		minutes = poll.Duration * 60
	}
	if err := socialidentity.CheckXPoll(poll.Options, minutes, mediaCount, article); err != nil {
		return nil, publishRejected(err.Error())
	}
	return &tweetPoll{Options: poll.Options, DurationMinutes: minutes}, nil
}
