package mastodon

import (
	"context"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"strconv"
)

// DynamicPollLimits reads the actual public instance configuration. The existing
// instance transport applies SSRF and redirect restrictions.
func (p *Provider) DynamicPollLimits(ctx context.Context, origin string) (*postoptions.PollLimits, error) {
	response, err := p.Fetch(ctx, origin+"/api/v2/instance", integrations.Request{})
	if err != nil {
		return nil, err
	}
	var instance struct {
		Configuration struct {
			Polls *postoptions.PollLimits `json:"polls"`
		} `json:"configuration"`
	}
	if err = response.JSON(&instance); err != nil {
		return nil, err
	}
	if err = instance.Configuration.Polls.Validate(nil, 0); err != nil {
		return nil, err
	}
	return instance.Configuration.Polls, nil
}

func (p *Provider) PollLimits(ctx context.Context, _ *ent.Integration) (*postoptions.PollLimits, error) {
	return p.DynamicPollLimits(ctx, DefaultURL())
}

func (p *Provider) validatePoll(ctx context.Context, origin string, post integrations.PostDetails) error {
	if post.Poll == nil {
		return nil
	}
	limits, err := p.DynamicPollLimits(ctx, origin)
	if err != nil {
		return err
	}
	if post.Poll.Question != "" {
		return fmt.Errorf("Mastodon polls ask the post text, not a separate question")
	}
	return limits.Validate(&postoptions.Poll{Options: post.Poll.Options, DurationMinutes: post.Poll.DurationMinutes, Multiple: post.Poll.Multiple}, len(post.Media))
}

func pollPairs(poll *integrations.PollDetails) []string {
	if poll == nil {
		return nil
	}
	pairs := []string{"poll[expires_in]", strconv.Itoa(poll.DurationMinutes * 60), "poll[multiple]", strconv.FormatBool(poll.Multiple)}
	for _, option := range poll.Options {
		pairs = append(pairs, "poll[options][]", option)
	}
	return pairs
}
