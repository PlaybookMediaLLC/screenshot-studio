# Social authorization lifecycle

OAuth callbacks resolve their original workspace from `social_oauth_start`, using the signed-in user, exact session, provider, and state. Changing the selected workspace does not retarget the account. The web facade does not select the callback tenant. Go verifies current membership, session expiry, user suspension, workspace deletion status, and private-set access again. The existing owner/admin/publisher connection role policy is retained in this slice; the team capability revision remains a separate tracked requirement.

An attempt follows `PENDING → EXCHANGING → EXCHANGED → COMPLETED`. Go commits the exchange claim before calling the provider adapter. Only one request may claim it. Successful exchange saves a credential-free identity/page receipt; repeats use that receipt. A crash or failed provider response after the claim leaves `EXCHANGING`: the application refuses automatic exchange retries because the remote outcome is unknown. Check the account before starting a fresh authorization. This state does not change existing drafts, schedules, or product connections.

Connection creation/restoration, completion receipt, and audit event commit in one database transaction. The original workspace row serializes competing completions, while session, membership, user, and target-set locks prevent an access change during commitment. Concurrent repeats return one connection with one creation audit event. A completed replay never restores a subsequently removed account. A reconnect includes the expected connection ID; the exchanged integration must match it, and a restored account keeps its original set and lineage. Moving an account requires a separate transfer operation.

Return navigation is persisted per attempt. The production callback reads it through the authenticated context resolver, overriding the old shared return cookie. The selected-workspace UI after a callback still needs the creation-flow confirmation screen: backend completion can succeed in the original workspace even when another workspace is selected. The browser test matrix must cover that screen before S15 is verified.

## First-account creation

An attempt records an immutable `CREATE_SET`, `ADD_ACCOUNT`, or `RECONNECT` operation. Creation requires explicit `PRIVATE` or `WORKSPACE` visibility and an owner/admin of the original workspace; it cannot also target an existing set or connection. Beginning or abandoning authorization creates no set. After a verified exchange, completion creates the set, its first account, default schedule, receipt, and audit events atomically. Concurrent callbacks recover the same result. A duplicate account or expired attempt creates nothing. The initial name is “New brand”; provider-derived naming and verified profile metadata remain pending.

Channel capacity is checked again inside that transaction, under the same workspace lock used by connection writers and billing updates. A downgrade or full plan leaves the exchange receipt recoverable without creating an empty set. Restoring entitlement allows the same saved exchange to complete. Reconnecting an active account consumes no additional slot; restoring a disabled account does.

`POST /api/v1/social-connection-attempts` exposes the explicit operation through the member-only Zod REST contract and SDK. Owner/admin authorization and fresh sensitive-action authentication run before beginning the provider handoff. Callers must not automatically retry a lost begin response; each begin creates a new attempt. Listing social sets no longer creates an empty default brand. Legacy unassigned accounts are still adopted into the default set. Existing explicit set-creation and draft-writing compatibility paths remain available for compatibility. The new picker begins from the sidebar, private/workspace list actions, existing-set rows, and General settings without navigating the current page.

## Migration and retention

`20261031100000_social_oauth_receipts.sql` is additive. Existing social and Slack starts remain pending with the same original identities, set, and expiry. Pending starts expire after one hour. Completed receipts can replay for 24 hours, subject to current authorization. Maintenance removes completed receipts after that window and other expired social starts after another 24 hours. Shared Slack starts retain their existing single-use deletion and expiry behavior.

`20261031110000_social_oauth_creation.sql` adds operation, creation visibility, and the resulting set receipt. It backfills legacy reconnect starts from their expected connection IDs. Constraints prevent mixed creation/reconnect targets and incomplete creation receipts. Upgrade tests preserve pending X/Slack starts and reconnect identity, then replay the migrations safely.

Deploy the Go migration/backend before the web facade. A rollout interrupted after a provider consumed a pre-upgrade code can require a fresh authorization; never assume it is safe to exchange that code again. Rolling the application back may consume pending rows using the earlier deletion semantics; retain the additive columns and connection records when rolling back. No provider tokens are copied into receipts.

## Verification and remaining work

`TestOAuthReceiptsKeepOriginalContextAndIdentity` uses real PostgreSQL for concurrent completion, workspace switching, uncertain exchange, wrong-account reconnect, expiration, role downgrade, private ownership changes, target deletion, and removed-account replay. HTTP tests check one adapter exchange despite callback replay. Web tests cover bound return navigation and completed Instagram callbacks. The fresh-database upgrade test preserves pending X/Slack starts and completed receipts across migration replay.

Creation integration tests add eight concurrent callbacks, private and workspace ownership, abandoned and expired starts, duplicate-account rollback, role downgrade, and entitlement recovery. PostgreSQL integration, race detection, Go vet, SDK compilation, and REST/OpenAPI contract checks pass locally.

These checks use local fixtures, not live provider accounts. The picker now has production browser proof for cancellation, focus/URL preservation, first-account creation, callback replay and occupied provider slots. Canonical external identity/capability verification, Bluesky/custom Mastodon flows, and the original-workspace success screen remain tracked in the 60-criterion coverage matrix.
