package postoptions

import "regexp"

// BlueskyQuoteURL is the native public post URL accepted for record quotes.
// Only the handle/DID and record key are resolved through the verified PDS.
var BlueskyQuoteURL = regexp.MustCompile(`^https://bsky\.app/profile/([A-Za-z0-9.:-]{1,253})/post/([A-Za-z0-9]{1,64})$`)
