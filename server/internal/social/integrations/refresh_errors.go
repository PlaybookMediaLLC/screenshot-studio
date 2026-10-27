package integrations

import "errors"

// ErrRefreshUnavailable indicates a temporary failure, not a revoked grant.
// Refresh callers must preserve credentials and health and retry later. The
// fixed message deliberately excludes provider responses and credentials.
var ErrRefreshUnavailable = errors.New("the provider is temporarily unavailable; retry credential renewal later")
