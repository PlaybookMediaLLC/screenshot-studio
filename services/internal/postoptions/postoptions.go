// Package postoptions holds what a scheduled post carries beyond its text
// (RFC 037): follow-up actions after it is live, a poll, and how far a thread
// got. A leaf package, so the ent schema can use its types.
package postoptions

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

// PublishOptions are a draft post's settings beyond its text (RFC 041):
// who can reply, its labels, where it goes, and what it quotes. Each field
// belongs to the platforms whose adapter sends it; scheduling refuses it
// anywhere else. Zero values are off.
type PublishOptions struct {
	// X: who can reply (following, mentionedUsers, subscribers, verified);
	// empty is everyone. Replies never change who can see the post.
	ReplySettings string `json:"replySettings,omitempty"`
	// X: content labels.
	MadeWithAI      bool `json:"madeWithAi,omitempty"`
	PaidPartnership bool `json:"paidPartnership,omitempty"`
	// X: post to a community, and whether followers see it too.
	CommunityID        string `json:"communityId,omitempty"`
	ShareWithFollowers bool   `json:"shareWithFollowers,omitempty"`
	// X: the post this one quotes; LinkedIn: the post this one reshares.
	QuoteRemoteID string `json:"quoteRemoteId,omitempty"`
	// X: this reply quotes the thread's first post, once it is live.
	QuoteFirstPost bool `json:"quoteFirstPost,omitempty"`
	// X articles: the title and cover; the caption is the body.
	ArticleTitle        string `json:"articleTitle,omitempty"`
	ArticleCoverAssetID string `json:"articleCoverAssetId,omitempty"`
	// LinkedIn: PUBLIC or CONNECTIONS; empty is PUBLIC.
	Visibility string `json:"visibility,omitempty"`
	// LinkedIn: a comment posted under the post once it is live.
	FirstComment string `json:"firstComment,omitempty"`
	// LinkedIn: a PDF asset posted as a document carousel, with its title.
	DocumentAssetID string `json:"documentAssetId,omitempty"`
	DocumentTitle   string `json:"documentTitle,omitempty"`
	// LinkedIn: a poll's question (X polls ask the post's text).
	PollQuestion string `json:"pollQuestion,omitempty"`
}

// Empty reports whether no option is set.
func (o PublishOptions) Empty() bool { return o == PublishOptions{} }
