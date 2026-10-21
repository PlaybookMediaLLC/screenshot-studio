# Bluesky connection implementation

Bluesky now has a dedicated product form and a scoped, durable credential
connection API. The existing social adapter authenticates and publishes through
XRPC. The backend requires `PLATFORM_SOCIAL_BLUESKY_ENABLED=true`; deployments
default to disabled until a harmless disposable account check is completed.
Capability enforcement and live account checks remain incomplete.
The user asked to focus on other providers and defer Mastodon login.

## Account identity checks implemented

Connection verifies that the profile's DID matches the authenticated session DID.
A login requires a nonempty DID and access/refresh tokens, and rejects an explicit
inactive or suspended account response. `active` is optional in the provider
contract; its absence is not interpreted as affirmative account health.

Every publishing login compares the authenticated DID with the integration's
stored native ID before media upload or posting. A changed handle cannot silently
switch the publishing identity. Refresh also checks the original DID before
retaining the replacement session or replaying a request. Mismatch requires
reconnecting the original account.

Local provider tests cover mismatched profiles, missing identifiers/credentials,
inactive/suspended sessions, account substitution during publishing, and account
substitution during refresh. These are protocol fixtures, not live Bluesky proof.
The provider, publishing activities and workflow suites passed with the race
detector. Vet passed. CodeRabbit's two error-classification findings were fixed;
the follow-up review reported no findings. A subsequent focused test caught
preparation wrapping the reconnect outcome as a generic publishing error; the
preparation path now preserves disconnect errors and the suites pass again.

## App-password authentication and renewal

New connections normalize and validate a full handle, then resolve it through
the public Bluesky identity service. The DID document must bind the same DID
and first valid handle alias to a public HTTPS PDS. Only hostname-level
`did:web` and `did:plc` are supported. This implementation accepts one PDS
service on a standard HTTPS origin; custom ports and ambiguous duplicate PDS
entries are rejected. Both discovery and credential calls use dial-time public
IP checks even when the deployment permits legacy SSRF bypasses. Responses are
bounded and redirects are never followed.

The password request goes only to that verified PDS using the immutable DID.
Caller-provided server URLs are ignored. A dedicated app-password shape is
required before discovery; the returned access grant must independently be
`com.atproto.appPass` or `com.atproto.appPassPrivileged`. Returned access and
refresh metadata must name the expected account and server, have the correct
scope, and carry a future expiry. This reads tokens received directly over
pinned HTTPS; it is not signature verification of arbitrary caller JWTs.

The callback encrypts the provider's canonical credential document, including
the verified PDS, server DID, immutable account DID and app password. It never
stores the caller's arbitrary server as the credential destination. This
storage-only document is omitted from JSON responses and workflow payloads.
Existing unversioned encrypted credentials keep their legacy publishing path
until reconnect; only new authentication writes the verified version.

Session renewal uses the stored refresh token at the original PDS and retains
the original account identity. The repository saves tokens, actual expiry and
new verified grants together only if the connection has not changed. Temporary
network failures, timeouts, cancellation, rate limits and server failures
preserve credentials and connection health without sending reconnect notices.
Expired/rejected grants still require reconnect. Publishing currently performs
a fresh app-password login and verifies the saved DID before its first write.

The persisted capability snapshot records the current post/image/video lexicon
limits and the PDS's optional blob limit. Unknown account video permission stays
null. These facts do not yet enforce all publishing media limits or claim that
an account can upload video.

Protocol fixtures and migrated PostgreSQL tests cover handle and DID boundaries,
primary-password grants, mismatched subjects/audiences, wrong accounts, unsafe
PDS destinations, redirects, oversized replies, secret-safe failures, encrypted
canonical storage, actual expiry, renewal and stale-result rejection. No account
was authorized during these tests. Full Go verification returned 123 passing
package results with no failures, vet passed, and focused provider, repository,
callback, activity and workflow race checks passed. CodeRabbit reviewed all 20
changed code files with zero findings. One initial race command included two
incorrect package paths; those suites passed when run with the correct paths.

## Product credential connection flow

The form accepts a full handle and app password, normalizes the handle, and
requires both values before enabling Connect. Cancel returns to the provider
picker, restores focus, and discards the form values. A submission starts a
password-free attempt before posting credentials. The password stays in memory
and a POST body; neither browser storage nor URLs contain it. The UI clears it
when submitting and sends only the attempt state when checking a saved result.
A successful form preserves the current page and offers an explicit Open social
set action, which selects the newly created set without unexpected navigation.

`POST /api/v1/bluesky-connection-attempts` uses the existing owner/admin,
fresh-second-factor, subscription, quota, tenant binding, and private-set access
checks. Create, add and reconnect intents reuse `SocialOAuthStart`; a begin does
not create a social set. Reconnect resolves the native DID through the original
tenant's adapter connection instead of trusting the handle or browser input.

`POST /api/v1/bluesky-connection-attempts/connect` resolves the original
user/session-bound workspace before any exchange. It claims the durable receipt,
submits credentials once, then reads tenant-scoped identity, health, actual grant,
and capabilities from the adapter. Product association, safe profile metadata,
and completed receipt commit together. Recovery from a saved exchange rechecks
the live adapter facts and original native identity. Completed recovery requires
neither provider availability nor a repeated password. Current membership,
original target access and connection status remain authoritative.

An interrupted exchange with no saved receipt remains `EXCHANGING`: it cannot
resubmit credentials automatically. The UI offers a result check and an explicit
new attempt. It does not claim that cancellation can roll back an external
request already received by the provider. Expired attempts require a new start.
The adapter separately consumes state atomically before touching any provider
and rejects reconnects returning a different DID before changing stored access.

The adapter's new tenant-authenticated `/public/v1/integrations/:id/identity`
returns safe profile and proof fields, never credentials. Removed integrations
retain their original identity for reconnect but return `active: false`.

## Compatibility and rollout

The product receipt gains an optional account JSON member in its existing
column; there is no new database migration in this increment. Existing OAuth
receipts remain readable. New Bluesky completions require the verified proof.
The previously added social migration 0003 remains required for adapter proof.

Every adapter callback now requires the `connection-provider:<state>` binding
written by the updated state producers. Authorization links issued before this
rollout lack it and must be restarted. Drain in-flight attempts or communicate
that reconnect is required during deployment; do not relax this check to accept
unbound credential callbacks. Product and social adapter releases must be
coordinated before enabling the flag. `bin/studio e2e` enables it for simulated
provider tests only; the ordinary Compose default remains false.

## Remaining connection work

- Complete native account ownership conflict handling across workspaces and
  legacy adapters; product connection IDs alone are not global native identity.
- Check account video-upload permission and enforce verified publishing limits;
  do not inherit the legacy adapter's silent image resizing as a capability policy.
- Reflect runtime provider availability in the picker before accepting inputs.
- Complete a harmless authorized disposable account connection and record live
  identity/capability evidence before enabling Bluesky for customers.

## Product-flow verification — 2026-10-21

The SDK build, generated API registry, typecheck, lint, formatting, all 902 root
JavaScript tests and workspace suites, 17 RFC checks, and production Next build
passed. The initial contract run caught a missing contract-module entry in the
test registry; adding it restored the required scan. Go vet and race checks for
HTTP API, publishing, social client, public identity API, callbacks and Redis pass.
All 124 Go test packages pass with package execution serialized. The first
parallel run hit a notification-process/member-lock deadlock against another
suite's organization cleanup in the shared test database; the isolated suite
and full serial rerun pass. This remains a test-isolation concern to address.

The production browser verified empty/invalid form disabling, nested cancellation
and focus restoration, password clearing, mobile width, private creation,
profile/health display, completed replay without credentials, anonymous denial,
occupied provider slots, reconnect preserving the same set/connection, and a
provider failure that never resends credentials. It asserts stored native proof
and no password in receipt/browser storage. The simulated adapter owns its test
credential row; product authorization, completion and health use real local
services and PostgreSQL. These are not live provider tests.

The first browser run found the missing Bluesky reconnect mapping. After fixing
it, both Bluesky journeys passed in 8.8s. Existing provider-picker and cross-tab
scope journeys also passed. The mobile form, populated connected account and
unknown-result screenshots were inspected. Evidence lives under
`.context/bluesky-form-*`, `.context/bluesky-verified-mobile.png`,
`.context/bluesky-connected-account.png` and `.context/bluesky-unknown-result.png`.
CodeRabbit initially reviewed all 42 code files with zero findings; the follow-up
review of all 44 files, including the reconnect fix and richer provider fixture,
also reported zero findings.

## Primary references checked on 2026-10-21

[Handle specification](https://atproto.com/specs/handle) defines ASCII hostname
syntax, lowercase normalization and bidirectional handle/DID verification.
[DID specification](https://atproto.com/specs/did) defines the supported `did:plc`
and hostname-level `did:web` methods.

The [createSession contract](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/createSession.json)
requires tokens, handle and DID; account status is optional. The provider's
[password implementation](https://github.com/bluesky-social/atproto/blob/main/packages/pds/src/account-manager/helpers/password.ts)
generates app passwords as four groups of four base32 characters. Its
[scope enum](https://github.com/bluesky-social/atproto/blob/main/packages/pds/src/auth-scope.ts)
distinguishes `com.atproto.appPass`/`com.atproto.appPassPrivileged` from
`com.atproto.access`. The [token implementation](https://github.com/bluesky-social/atproto/blob/main/packages/pds/src/account-manager/helpers/auth.ts)
defaults access tokens to 120 minutes and refresh tokens to 90 days; returned
expiry metadata must govern storage rather than a fabricated lifetime.

The [post lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json)
limits post text to 300 graphemes and 3000 bytes. The
[image embed](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/images.json)
allows four images up to 2,000,000 bytes each; the
[video embed](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json)
allows one MP4 up to 300,000,000 bytes. PDS
[describeServer](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/describeServer.json)
can report a separate blob limit. Account-specific
[getUploadLimits](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/video/getUploadLimits.json)
reports video permission and optional remaining quotas; this account check is
not implemented yet.
