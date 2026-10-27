package postoptions

import "regexp"

// MastodonQuoteURL accepts public Mastodon web or ActivityPub status URLs.
// The connected server resolves these; Shots never fetches the supplied host.
var MastodonQuoteURL = regexp.MustCompile(`^https://[A-Za-z0-9][A-Za-z0-9.-]{0,252}/(?:@[A-Za-z0-9_.-]+/[0-9]{1,80}|users/[A-Za-z0-9_.-]+/statuses/[0-9]{1,80})$`)
