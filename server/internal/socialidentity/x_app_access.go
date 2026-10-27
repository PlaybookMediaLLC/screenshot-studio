package socialidentity

import "os"

// XEnterpriseQuotesEnabled is an operator-managed application grant. X's
// create-post contract restricts quote_tweet_id to Enterprise access; an account
// subscription, draft option or saved OAuth snapshot cannot establish that
// application contract. Keep this off until X has approved the deployed app.
// Both admission and execution read the current setting so revocation takes
// effect for already scheduled work as well.
func XEnterpriseQuotesEnabled() bool {
	return os.Getenv("PLATFORM_X_ENTERPRISE_QUOTES_ENABLED") == "true"
}
