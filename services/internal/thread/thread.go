// Package thread holds a post's thread replies (RFC 037): the posts that
// follow the first one on a channel that publishes threads, such as X.
package thread

import "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"

// Reply is one post after the first: its text and its images, in order, and
// its own settings (RFC 041), such as who can reply or a quote of the first
// post. Replies stored before settings existed have none.
type Reply struct {
	AssetIDs []string                    `json:"assetIds"`
	Caption  string                      `json:"caption"`
	Options  *postoptions.PublishOptions `json:"options,omitempty"`
}
