// Package thread holds a post's thread replies (RFC 037): the posts that
// follow the first one on a channel that publishes threads, such as X.
package thread

// Reply is one post after the first: its text and its images, in order.
type Reply struct {
	AssetIDs []string `json:"assetIds"`
	Caption  string   `json:"caption"`
}
