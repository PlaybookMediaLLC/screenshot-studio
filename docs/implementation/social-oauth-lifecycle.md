# Social authorization lifecycle

OAuth callbacks resolve their original workspace from `social_oauth_start`, using the signed-in user, exact session, provider, and state. Changing the selected workspace does not retarget the account. The web facade does not select the callback tenant. Go verifies current membership, session expiry, user suspension, workspace deletion status, and private-set access again. The existing owner/admin/publisher connection role policy is retained in this slice; the team capability revision remains a separate tracked requirement.

An attempt follows `PENDING → EXCHANGING → EXCHANGED → COMPLETED`. Go commits the exchange claim before calling the provider adapter. Only one request may claim it. Successful exchange saves a credential-free identity/page receipt; repeats use that receipt. A crash or failed provider response after the claim leaves `EXCHANGING`: the application refuses automatic exchange retries because the remote outcome is unknown. Check the account before starting a fresh authorization. This state does not change existing drafts, schedules, or product connections.

Connection creation/restoration, completion receipt, and audit event commit in one database transaction. The original workspace row serializes competing completions, while session, membership, user, and target-set locks prevent an access change during commitment. Concurrent repeats return one connection with one creation audit event. A completed replay never restores a subsequently removed account. A reconnect includes the expected connection ID; the exchanged integration must match it, and a restored account keeps its original set and lineage. Moving an account requires a separate transfer operation.

Return navigation is persisted per attempt. The production callback reads it through the authenticated context resolver, overriding the old shared return cookie. The selected-workspace UI after a callback still needs the creation-flow confirmation screen: backend completion can succeed in the original workspace even when another workspace is selected. The browser test matrix must cover that screen before S15 is verified.

## Migration and retention

`20261031100000_social_oauth_receipts.sql` is additive. Existing social and Slack starts remain pending with the same original identities, set, and expiry. Pending starts expire after one hour. Completed receipts can replay for 24 hours, subject to current authorization. Maintenance removes completed receipts after that window and other expired social starts after another 24 hours. Shared Slack starts retain their existing single-use deletion and expiry behavior.

Deploy the Go migration/backend before the web facade. A rollout interrupted after a provider consumed a pre-upgrade code can require a fresh authorization; never assume it is safe to exchange that code again. Rolling the application back may consume pending rows using the earlier deletion semantics; retain the additive columns and connection records when rolling back. No provider tokens are copied into receipts.

## Verification and remaining work

`TestOAuthReceiptsKeepOriginalContextAndIdentity` uses real PostgreSQL for concurrent completion, workspace switching, uncertain exchange, wrong-account reconnect, expiration, role downgrade, private ownership changes, target deletion, and removed-account replay. HTTP tests check one adapter exchange despite callback replay. Web tests cover bound return navigation and completed Instagram callbacks. The fresh-database upgrade test preserves pending X/Slack starts and completed receipts across migration replay.

These checks use local fixtures, not live provider accounts. Provider-first set creation, canonical external identity/capability verification, original-workspace success UI, and quota checks within the creation transaction remain tracked in the 60-criterion coverage matrix. The existing pre-transaction channel quota check has not yet been changed by this slice.
