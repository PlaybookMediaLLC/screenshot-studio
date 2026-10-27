package mastodon

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// NativePoll is persisted with pending status data so resuming a media workflow
// cannot lose the poll. Current instance limits are checked before submission.
type NativePoll struct {
	Options  []string `json:"options"`
	Minutes  int      `json:"minutes"`
	Multiple bool     `json:"multiple"`
}

func (p *Provider) checkedPoll(ctx context.Context, origin string, poll *integrations.PollDetails, media int) (*NativePoll, error) {
	if poll == nil {
		return nil, nil
	}
	if poll.Question != "" {
		return nil, fmt.Errorf("Mastodon uses the post text as its poll question")
	}
	var instance struct {
		Configuration struct {
			Polls struct {
				MaxOptions    int `json:"max_options"`
				MaxCharacters int `json:"max_characters_per_option"`
				MinExpiration int `json:"min_expiration"`
				MaxExpiration int `json:"max_expiration"`
			} `json:"polls"`
		} `json:"configuration"`
	}
	res, err := p.Fetch(ctx, origin+"/api/v2/instance", integrations.Request{Method: http.MethodGet})
	if err != nil {
		return nil, err
	}
	if err := res.JSON(&instance); err != nil {
		return nil, err
	}
	got := instance.Configuration.Polls
	limits := socialidentity.PollLimits{MaxOptions: got.MaxOptions, MaxOptionCharacters: got.MaxCharacters, MinDurationSeconds: got.MinExpiration, MaxDurationSeconds: got.MaxExpiration}
	minutes := poll.DurationMinutes
	if minutes == 0 {
		minutes = poll.Duration * 60
	}
	if err := limits.Check(poll.Options, minutes, media); err != nil {
		return nil, err
	}
	return &NativePoll{Options: poll.Options, Minutes: minutes, Multiple: poll.Multiple}, nil
}
func pollPairs(poll *NativePoll) []string {
	if poll == nil {
		return nil
	}
	pairs := []string{"poll[expires_in]", strconv.Itoa(poll.Minutes * 60), "poll[multiple]", strconv.FormatBool(poll.Multiple)}
	for _, option := range poll.Options {
		pairs = append(pairs, "poll[options][]", option)
	}
	return pairs
}
