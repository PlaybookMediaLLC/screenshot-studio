package threads

import (
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func pollAttachment(post integrations.PostDetails) (string, error) {
	if post.Poll == nil {
		return "", nil
	}
	minutes := post.Poll.DurationMinutes
	if minutes == 0 {
		minutes = post.Poll.Duration * 60
	}
	if err := socialidentity.CheckThreadsPoll(post.Poll.Options, minutes, len(post.Media), post.Poll.Multiple); err != nil {
		return "", temporalx.BadBody(identifier, "{}", "{}", err.Error())
	}
	if post.Poll.Question != "" {
		return "", temporalx.BadBody(identifier, "{}", "{}", "Threads uses the post text as its poll question")
	}
	options := map[string]string{}
	for index, value := range post.Poll.Options {
		options[[]string{"option_a", "option_b", "option_c", "option_d"}[index]] = value
	}
	data, err := json.Marshal(options)
	return string(data), err
}
