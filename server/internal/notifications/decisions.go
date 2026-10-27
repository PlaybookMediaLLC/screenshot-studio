package notifications

import "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"

// personalDecision is evaluated only after recipient/resource authorization. Required
// publishing failures bypass category choices, never workspace ceilings or masters.
func personalDecision(p Policy, pref Preferences, d activity.Definition, channel string, emailOn bool, setIDs ...string) (bool, string) {
	if !availableChannel(p, channel) {
		return false, "WORKSPACE_CHANNEL_DISABLED"
	}
	policy := p.Events[d.ID]
	if channel == "in_app" && !policy.InApp || channel == "email" && !policy.Email {
		return false, "WORKSPACE_EVENT_DISABLED"
	}
	if channel == "email" && !emailOn {
		return false, "EMAIL_TURNED_OFF"
	}
	if channel == "slack_dm" && pref.SlackEnabled != nil && !*pref.SlackEnabled {
		return false, "SLACK_TURNED_OFF"
	}
	if d.MandatoryFailure {
		return true, "REQUIRED_FAILURE_ALERT"
	}
	if !pref.selected(d.ID, channel, setIDs...) {
		return false, "CATEGORY_DISABLED"
	}
	return true, "SELECTED"
}

func notifyActor(d activity.Definition, background bool) bool {
	return background || d.MandatoryFailure
}
