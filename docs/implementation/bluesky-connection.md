# Bluesky connection implementation

Bluesky is still disabled in the product connection dialog. The existing social
adapter publishes through XRPC. Secure app-password authentication and renewal
are implemented in the adapter; the product form, scoped credential-attempt
endpoint, capability enforcement, and live account checks remain incomplete.
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

## Remaining connection work

- Use the existing durable connection attempt, tenant binding, receipt and set
  completion flow for a POST-only credential exchange. Passwords must not enter
  URLs, browser storage, logs, workflow payloads or response bodies.
- Consume credential attempt state once at the adapter boundary, bind its
  expected reconnect DID before authentication commits, enforce account
  ownership conflicts, and expose safe account metadata through the product API.
- Check account video-upload permission and enforce verified publishing limits;
  do not inherit the legacy adapter's silent image resizing as a capability policy.
- Implement and test the handle/app-password form, cancellation, wrong-account
  reconnect, uncertain exchange recovery, browser flow and disposable account.

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
