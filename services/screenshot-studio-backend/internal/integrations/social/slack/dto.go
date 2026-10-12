package slack

// SlackDto is dtos/posts/providers-settings/slack.dto.ts.
type SlackDto struct {
	Channel *string `json:"channel"`
}

// Validate reproduces class-validator: @IsDefined first, then the remaining
// constraints bottom-up (@IsString, @MinLength(1)).
func (d *SlackDto) Validate() []string {
	if d.Channel == nil {
		return []string{"channel should not be null or undefined", "channel must be a string", "channel must be longer than or equal to 1 characters"}
	}
	if *d.Channel == "" {
		return []string{"channel must be longer than or equal to 1 characters"}
	}
	return nil
}
