// Package postoptions holds what a scheduled post carries beyond its text
// (RFC 037): follow-up actions after it is live, a poll, and how far a thread
// got. A leaf package, so the ent schema can use its types.
package postoptions

import "strings"

// AutoActions are what happens after a post is live, on channels that
// support them (X). Zero values are off.
type AutoActions struct {
	// RepostAtLikes reposts the post once it has this many likes.
	RepostAtLikes int `json:"repostAtLikes,omitempty"`
	// PlugAtLikes replies PlugText under the post once it has this many likes.
	PlugAtLikes int    `json:"plugAtLikes,omitempty"`
	PlugText    string `json:"plugText,omitempty"`
	// QuoteAfterHours posts QuoteText with a link to the post this many hours
	// after it went out, which X shows as a quote.
	QuoteAfterHours int    `json:"quoteAfterHours,omitempty"`
	QuoteText       string `json:"quoteText,omitempty"`
}

// Empty reports whether no action is set.
func (a AutoActions) Empty() bool {
	return a.RepostAtLikes == 0 && a.PlugAtLikes == 0 && a.QuoteAfterHours == 0
}

// Poll is a question's choices and how long it stays open.
type Poll struct {
	DurationMinutes int      `json:"durationMinutes"`
	Options         []string `json:"options"`
}

// ThreadProgress is how much of a thread is live: the replies posted, of
// how many, and the last live reply a resumed thread answers.
type ThreadProgress struct {
	LastReplyID string `json:"lastReplyId,omitempty"`
	Posted      int    `json:"posted"`
	Total       int    `json:"total"`
}

// Metrics are a live post's engagement counts by name (likes, reposts,
// replies, impressions, …), as its platform reports them.
type Metrics map[string]float64

// LivePostURL is a live post's address on its platform, where one can be
// built from its id.
func LivePostURL(platform string, remoteID *string) *string {
	if remoteID == nil || *remoteID == "" {
		return nil
	}
	var url string
	switch platform {
	case "x":
		url = "https://x.com/i/status/" + *remoteID
	case "linkedin":
		url = "https://www.linkedin.com/feed/update/" + *remoteID
	case "threads", "bluesky", "mastodon":
		// These providers report a post's address as its id.
		if strings.HasPrefix(*remoteID, "https://") {
			url = *remoteID
		}
	}
	if url == "" {
		return nil
	}
	return &url
}
