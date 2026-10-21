# Bluesky connection implementation

Bluesky is still disabled in the product connection dialog. The existing social
adapter publishes through XRPC, but the handle/app-password form, scoped attempt
endpoint, verified grant/capability storage, and live account checks are not
complete. The user asked to focus on other providers and defer Mastodon login.

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

## Remaining connection work

- Normalize and validate the full handle; names and handles are not ownership IDs.
- Require a dedicated app password before the credential request. Check the
  provider-issued session scope as well as the password's shape: a primary
  password could happen to use the same format.
- Validate the DID document and public PDS destination before any credential
  forwarding. Keep the public-only transport independent of deployment bypasses.
- Replace the adapter's invented 100-year access-token expiry with an accurate
  credential lifecycle. Existing publishing logs in from encrypted instance
  details; generic token refresh currently returns an empty result.
- Use the existing durable connection attempt, tenant binding, receipt and set
  completion flow for a POST-only credential exchange. Passwords must not enter
  URLs, browser storage, logs, workflow payloads or response bodies.
- Persist verified native identity, grants and publishing capabilities, enforce
  account ownership conflicts, and expose only safe display metadata to the UI.
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
limits post text to 300 graphemes and 3000 bytes. Media and account-specific video
capabilities still need to be verified against their own contracts.
