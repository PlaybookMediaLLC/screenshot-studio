# Social authorization lifecycle

OAuth callbacks resolve their original workspace from `social_oauth_start`, using the signed-in user, exact session, provider, and state. Changing the selected workspace does not retarget the account. The web facade does not select the callback tenant. Go verifies current membership, session expiry, user suspension, workspace deletion status, and private-set access again. The existing owner/admin/publisher connection role policy is retained in this slice; the team capability revision remains a separate tracked requirement.

An attempt follows `PENDING → EXCHANGING → EXCHANGED → COMPLETED`. Go commits the exchange claim before calling the provider adapter. Only one request may claim it. Successful exchange saves a credential-free identity/page receipt; repeats use that receipt. A crash or failed provider response after the claim leaves `EXCHANGING`: the application refuses automatic exchange retries because the remote outcome is unknown. Check the account before starting a fresh authorization. This state does not change existing drafts, schedules, or product connections.

Connection creation/restoration, completion receipt, and audit event commit in one database transaction. The original workspace row serializes competing completions, while session, membership, user, and target-set locks prevent an access change during commitment. Concurrent repeats return one connection with one creation audit event. A completed replay never restores a subsequently removed account. A reconnect includes the expected connection ID; the exchanged integration must match it, and a restored account keeps its original set and lineage. Moving an account requires a separate transfer operation.

Return navigation is persisted per attempt. The production callback reads it through the authenticated context resolver, overriding the old shared return cookie. After commitment, the callback redirects to a code-free confirmation URL. The server verifies the original session, current membership, target access, and completed receipt again. If that workspace is selected, it opens the saved destination; otherwise it names the original workspace and offers Open or Stay. Open uses the existing workspace activation REST contract, which rechecks membership. Pending, expired, and inaccessible receipts cannot display success. The browser journey covers switching in another tab, staying in the second workspace, replay, explicitly opening the original set, and anonymous metadata denial; desktop and mobile screenshots were inspected.

## First-account creation

An attempt records an immutable `CREATE_SET`, `ADD_ACCOUNT`, or `RECONNECT` operation. Creation requires explicit `PRIVATE` or `WORKSPACE` visibility and an owner/admin of the original workspace; it cannot also target an existing set or connection. Beginning or abandoning authorization creates no set. After a verified exchange, completion creates the set, its first account, default schedule, receipt, and audit events atomically. Concurrent callbacks recover the same result. A duplicate account or expired attempt creates nothing. The initial name is “New brand”; provider-derived naming and verified profile metadata remain pending.

Channel capacity is checked again inside that transaction, under the same workspace lock used by connection writers and billing updates. A downgrade or full plan leaves the exchange receipt recoverable without creating an empty set. Restoring entitlement allows the same saved exchange to complete. Reconnecting an active account consumes no additional slot; restoring a disabled account does.

`POST /api/v1/social-connection-attempts` exposes the explicit operation through the member-only Zod REST contract and SDK. Owner/admin authorization and fresh sensitive-action authentication run before beginning the provider handoff. Callers must not automatically retry a lost begin response; each begin creates a new attempt. Listing social sets no longer creates an empty default brand. Legacy unassigned accounts are still adopted into the default set. Existing explicit set-creation and draft-writing compatibility paths remain available for compatibility. The new picker begins from the sidebar, private/workspace list actions, existing-set rows, and General settings without navigating the current page.

## Mastodon server discovery

The picker offers the five documented servers and custom HTTPS hostnames. Public metadata comes from the authenticated Go backend through `GET /api/v1/social-instances/mastodon`; no account, credential, or social set is created by discovery. The backend checks the actual dialed IP, rejects private and link-local addresses even when the general self-hosted SSRF bypass is enabled, refuses redirects, bounds requests to ten seconds, and caps response bodies at 256 KiB. Hostnames cannot include paths, ports, query strings, fragments, or credentials. The browser validates before building the request URL and cancels previews when selection or workspace changes.

The preview uses Mastodon’s public [v2 instance endpoint](https://docs.joinmastodon.org/methods/instance/). The optional active-user count is labeled “past four weeks,” matching the [instance entity definition](https://docs.joinmastodon.org/entities/instance/). Metadata is untrusted text, not proof of account authorization or publishing capability. Custom-server authorization is opt-in through `PLATFORM_SOCIAL_CUSTOM_MASTODON_ENABLED=true` on both product and social APIs. The default remains disabled pending live verification and persisted capability evidence. The preview response reports availability from the backend; changing the server clears that availability until its new preview completes.

Go tests cover URL validation, malformed and oversized responses, denied private egress and redirects. Production browser checks cover presets, empty custom input, stale-request cancellation and credential rejection. An opt-in browser check (`E2E_LIVE_PUBLIC_PREVIEW=1`) passed against the real public mastodon.social endpoint on 2026-10-21 through authenticated REST/Go. This verifies public discovery only; no live provider account was authorized.

## Migration and retention

Provider storage uses authenticated encryption in the existing integration
columns. Ent seals access/refresh tokens on every write and opens them only in
backend memory. Custom client credentials are encrypted before Redis and database
persistence; temporary envelopes are bound to the exact OAuth state. Missing keys
block handoff before remote registration or exchange. Existing legacy credentials
remain readable for the bounded, rerunnable backfill. See the coordinated rollout
and key-rotation procedure in [the deployment guide](../social-backend-deployment.md).
The key never belongs in the web environment or OAuth receipts.

PostgreSQL tests verify raw encrypted storage, NULL/empty preservation, failed
authentication, batch rollback, idempotent backfill, retired-key rotation, erased
account tombstones, and the legacy Slack import. Linked-account token propagation
is restricted to the same workspace and provider and preserves a refresh token
when a provider returns no replacement. The social database/API/provider,
notification, publishing, and product suites pass; the affected storage/controller
packages also pass the race detector. The production non-root image builds and
its social API health and migration/backfill commands pass locally. Social workflow
payloads now omit credentials; provider activities reload the account and verify
its current workspace, identity and usable state before external calls. A real
local Temporal refresh/publish probe confirms that durable history contains no
fixture credentials and replays successfully. V101/V112 refresh workflows keep
their existing names and sequence, using a non-secret success marker instead of
a returned access token. Live-account verification still waits for provider-flow
work and deployment of the updated local API/worker image.

`20261031100000_social_oauth_receipts.sql` is additive. Existing social and Slack starts remain pending with the same original identities, set, and expiry. Pending starts expire after one hour. Completed receipts can replay for 24 hours, subject to current authorization. Maintenance removes completed receipts after that window and other expired social starts after another 24 hours. Shared Slack starts retain their existing single-use deletion and expiry behavior.

`20261031110000_social_oauth_creation.sql` adds operation, creation visibility, and the resulting set receipt. It backfills legacy reconnect starts from their expected connection IDs. Constraints prevent mixed creation/reconnect targets and incomplete creation receipts. Upgrade tests preserve pending X/Slack starts and reconnect identity, then replay the migrations safely.

Deploy the Go migration/backend before the web facade. A rollout interrupted after a provider consumed a pre-upgrade code can require a fresh authorization; never assume it is safe to exchange that code again. Rolling the application back may consume pending rows using the earlier deletion semantics; retain the additive columns and connection records when rolling back. No provider tokens are copied into receipts.

## Canonical platform slots

`20261031120000_social_platform_slots.sql` adds the immutable versioned SQL function `platform_social_channel_v1` and an active-account expression index. Twitter/X, LinkedIn/profile-page, Instagram/standalone and Mastodon/default-custom each occupy one platform slot. Connections and OAuth receipts keep the original adapter identifier; this migration does not replace credentials or merge external accounts. Set defaults are normalized in their original order, with one version increment only when changed. Stored drafts are not rewritten.

The migration first rejects preexisting duplicate active slots. Resolve those accounts explicitly through the removal flow and retry; a failed attempt rolls back the function, index and migration record together. Fresh and representative upgrade tests verify rollback, retry, disabled-account retention, index enforcement and replay. Index creation blocks connection writes while scanning; schedule a maintenance window sized for the connection table. Apply the migration before the updated backend because health queries use its function. Preserve the additive function/index on application rollback. Do not edit its mapping in place: a later mapping change requires a new function/index version and explicit backfill. Canonical slot aliases alone do not prove that two adapter identities represent the same underlying remote account; cross-adapter external identity reconciliation remains pending.

## Refresh completion and revocation

Credential refresh updates an existing connection conditionally. It never uses
an upsert that can recreate a deleted integration or clear its removal marker.
Before contacting the provider, the service rereads the original workspace,
provider/account identity, credentials, state and row version. After the response,
a short transaction locks the workspace and connection, verifies the same
snapshot, and saves only the returned credentials and known lifetime. Missing
refresh tokens preserve the existing value; unspecified lifetime preserves the
existing expiry. No database locks are held across provider HTTP calls.

Deletion, disabling, reconnecting, identity changes and a competing refresh win
over a stale completion. Both late success and late failure are rejected: an old
failure cannot mark a newer connection as broken or send its reconnect notice.
Linked-account propagation checks each captured row version in the same
workspace/provider, skipping removed or independently reconnected siblings. The
periodic refresh sweep uses this same service and skips superseded snapshots. An individual failure does not stop other accounts from refreshing; the sweep returns collected errors after processing the remaining accounts.
Provider errors are logged as fixed outcomes without raw remote error text.

The activity converts a superseded refresh into a terminal, credential-free
result before its error handler can mutate connection health. PostgreSQL tests
exercise changes during both successful and failed remote refreshes, two
simultaneous refreshes, linked accounts, deleted workspaces, the periodic sweep,
and activity error handling. These conditional writes protect persisted state;
they do not cancel a provider request already in flight. A provider-side token
rotation whose result is lost can still require a fresh user authorization.

## Custom Mastodon adapter preparation

The `mastodon-custom` adapter is registered only when the backend opt-in flag is enabled. The local product path accepts a validated `instanceServer`, preserves its original owner/set intent, and validates the authorization redirect against that exact HTTPS origin. Legacy default-server reconnects retain their existing adapter identity. General availability still requires real disposable-account verification and enforcement of persisted capabilities throughout scheduling and publishing. Its protocol implementation now registers a confidential client on
the normalized public HTTPS origin, uses the matching
`/integrations/social/mastodon-custom` callback in all three OAuth steps, and
binds a 64-character verifier to an S256 PKCE challenge. The instance client
ignores the self-hosted SSRF bypass, rejects redirects, checks the actual dialed
IP, times out after ten seconds, and bounds JSON responses to 1 MiB. App
registration and code exchange do not automatically retry unknown outcomes.
Provider error bodies are removed before shared publishing errors can enter
logs or Temporal history. Public profile-image downloads use the same strict
public transport so an avatar cannot bypass the instance boundary.

The requested permissions are `read:accounts write:statuses write:media`.
`read:accounts` supports account verification on instances older than the
`profile` scope; broader `read`/`write` grants also satisfy these permissions.
A connection fails before account lookup when any required grant, bearer token,
or token type is missing. Verified identity uses `mastodon:<server>:<account-id>`;
handles are display metadata. Equal numeric IDs from different servers remain
distinct. Missing or corrupt stored instance details fail closed, and delayed
status/finalize calls reject a pending origin that differs from the encrypted
connection origin.

Mastodon tokens have no automatic expiry or refresh token. The explicit
`NonExpiring` result stores a NULL expiry and clears a legacy invented expiry on
reconnection. This is distinct from an unspecified lifetime on another adapter.
No database migration is needed for this nullable existing column.

The shared publisher still supplies text/media posting, replies and pending-media
polling. Status finalization retains its existing idempotency key. Per-instance
media/length limits are discovered and persisted at authorization. Enforcing them
in the composer and publishing handoff, reconciling legacy and custom adapter
identities for the same underlying account, and live account verification remain
outstanding. Canonical platform slots and opt-in product start/callback plumbing
are implemented and covered by local tests.

### Verified account and capability records

`0003_verified_provider_capabilities.sql` adds five nullable columns to the
existing social `Integration`: `verifiedAccountKey`, `verifiedAccountKind`,
`verifiedScopes`, `verifiedCapabilities`, and `identityVerifiedAt`. The account
key has a tenant lookup index. These columns are independent of editable
`additionalSettings`. The database rejects partial verification records; the
repository additionally checks provider-specific identity, required grants and
the versioned, bounded capability schema before replacing credentials.

For custom Mastodon, the adapter reads the selected server's public
[`/api/v2/instance` configuration](https://docs.joinmastodon.org/entities/Instance/)
without credentials before consuming the authorization code. It stores caption
length, URL weight, attachment count, MIME types, image/video size and pixel
limits, video frame-rate limit, and the optional media-description limit. Missing
required limits fail closed. An absent description limit remains unknown rather
than receiving a default. The account lookup and token response then provide the
native account key and actual granted scopes. Discovery alone creates no record.

Fresh authorization replaces the full snapshot on the same integration. An
authorization without verification clears old proof. Provider migration,
second-step account replacement, and sibling token replacement also clear it.
Editable connection settings cannot upgrade capability claims. Legacy rows stay
unverified: the migration does not infer permissions from tokens or settings.

Apply this additive social migration before deploying the generated Ent client.
It takes an `Integration` table lock, adds nullable columns without backfilling
rows, and builds a tenant/account lookup index. Schedule it during the normal
migration window. Old binaries tolerate the extra columns, so application
rollback should leave them in place; dropping them would discard verification
evidence and requires stopping all new writers first. Fresh database, populated
upgrade, transaction rollback, and replay tests cover schema compatibility.

Primary protocol references: [app registration](https://docs.joinmastodon.org/methods/apps),
[OAuth and PKCE](https://docs.joinmastodon.org/methods/oauth/),
[granted token fields](https://docs.joinmastodon.org/entities/Token),
[hierarchical scopes](https://docs.joinmastodon.org/api/oauth-scopes),
[account verification](https://docs.joinmastodon.org/methods/accounts), and
[token lifetime](https://docs.joinmastodon.org/api/oauth-tokens).

## Verification and remaining work

`TestOAuthReceiptsKeepOriginalContextAndIdentity` uses real PostgreSQL for concurrent completion, workspace switching, uncertain exchange, wrong-account reconnect, expiration, role downgrade, private ownership changes, target deletion, and removed-account replay. HTTP tests check one adapter exchange despite callback replay. Web tests cover bound return navigation and completed Instagram callbacks. The fresh-database upgrade test preserves pending X/Slack starts and completed receipts across migration replay.

Creation integration tests add eight concurrent callbacks, private and workspace ownership, abandoned and expired starts, duplicate-account rollback, role downgrade, and entitlement recovery. PostgreSQL integration, race detection, Go vet, SDK compilation, and REST/OpenAPI contract checks pass locally.

These checks use local fixtures, not live provider accounts. The picker now has production browser proof for cancellation, focus/URL preservation, first-account creation, callback replay and occupied provider slots. Canonical external identity/capability verification and Bluesky/custom Mastodon flows remain tracked in the 60-criterion coverage matrix.
