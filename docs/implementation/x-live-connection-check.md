# X live connection check — 2026-10-21

The local production web build and product API completed real X OAuth 1.0a
authorization against a separate development app. The operator approved the
displayed account and permissions. The app uses `X_API_KEY` and `X_API_SECRET`,
read/write access, and `http://localhost:3460/integrations/social/x` as its callback.
The OAuth 2.0 client credentials available in Infisical cannot replace these
consumer credentials. Generated values remain in private, ignored local runtime
configuration; no keys or account tokens are included in this report.

Verified through the browser and disposable PostgreSQL database:

- X returned its native account ID, name, and handle through the adapter's
  authenticated identity request.
- One private social set and one active channel were committed together.
- Reload retained the connected account, and the occupied X provider slot was
  disabled in Add account.
- Two same-account reconnects retained the original set, channel, and adapter
  integration IDs. All three durable OAuth attempts completed against that channel.
- The final stored access credential uses the existing authenticated encryption
  envelope.

No post was published. Publishing, current account limits, revocation detection,
and production deployment are not verified by this connection check. The follow-up below records the identity/grant verification work. S20 remains in
progress until the remaining connection and publishing capability gaps are verified.

## Reconnect encryption correction

The live storage check exposed a defect in the integration upsert. Ent's custom
upsert setters bypass the schema value scanner, so reconnect could overwrite a
sealed credential with plaintext. Reusing the insert's encrypted values through
`UpdateToken()` and `UpdateRefreshToken()` preserves encryption on conflict.
An omitted refresh token continues to preserve the existing refresh credential.

`TestReconnectKeepsCredentialsEncrypted` first failed on reconnect and retained
refresh-token cases, then passed after the fix. It checks raw database storage and
decrypted round trips for creation, credential replacement, and retained refresh
credentials. The integration, database fixture, credential backfill, cipher,
channel API, and public API suites passed. The focused race test and affected
package vet checks passed. CodeRabbit reviewed the two changed Go files with no
findings. A rebuilt local adapter then completed another real X
reconnect, and the stored token was confirmed encrypted without printing its value.

For environments that have used the affected upsert, deploy this fix and run the
existing `services/cmd/social-credentials` backfill with the correct database and
`PLATFORM_SOCIAL_ENCRYPTION_KEY`. The command seals legacy credentials and retains
connection IDs. No new migration or encryption format is introduced. Do not roll
back to the defective upsert after the backfill.

Local evidence: `.context/x-live-verification.json`,
`.context/x-live-connected-detail.jpg`, and `.context/x-app-configured.jpg`.

## Verified X identity and grant

The adapter now binds the OAuth access-token response's decimal `user_id` to a
signed `GET /2/users/me` response. It requires an observed `x-access-level` of
`read-write` or `read-write-directmessages`; this is OAuth 1.0a access-level
evidence, not an OAuth 2.0 scope list. Missing, combined, or read-only levels,
mismatched IDs, malformed token replies, and partial identity errors fail closed.
The response header was observed on the approved disposable account's real X
response. It is not an assertion that the header is a documented permanent API.
If X stops returning it, connections require a supported verification replacement.

The versioned credential-free proof stores `x:<native ID>`, profile identity,
observed access level, optional subscription metadata, and documented standard
post limits. A subscription name or editable Verified setting cannot grant a
4,000-character allowance. Premium long-post and account-specific video byte/time
limits remain explicitly unknown. This snapshot does not prove paid API quota,
article support, media eligibility, or successful publication.

Primary references checked on 2026-10-21:

- [X user access tokens](https://docs.x.com/fundamentals/authentication/oauth-1-0a/obtaining-user-access-tokens):
  OAuth 1.0a tokens do not expire, but users can revoke them. Reconnect now clears
  the old fabricated token expiry through the existing non-expiring contract.
- [X developer apps](https://docs.x.com/fundamentals/developer-apps) and
  [authentication API](https://docs.x.com/fundamentals/authentication/api-reference):
  request write access; permission changes require renewed user authorization.
- [Official twitter-text configuration](https://github.com/twitter/twitter-text/blob/master/config/v3.json):
  standard weighted length 280, with 23 characters reserved per URL.
- [Create post](https://docs.x.com/x-api/posts/create-post) and
  [media introduction](https://docs.x.com/x-api/media/introduction):
  at most four photos, one GIF or one video; image 5 MB and GIF 15 MB. Content and
  account eligibility still need validation at the publication boundary.

OAuth and identity requests have a 15-second context deadline, a 1 MiB response
bound, and reject redirects. Provider response bodies never enter authentication
errors. Rate limits and server outages remain transient errors.

The product API reads the adapter's proof through the original tenant credential,
persists it in the durable OAuth exchange receipt, and requires it before first
completion. Destination verification also rejects legacy X records without proof.
Completed callback replay retains its prior result without exchanging the code
again. An uncertain verification outcome never repeats the one-time exchange.

No new DDL is needed: existing verified identity columns and exchange receipt JSON
hold the proof. Roll out the social adapter before the product API. Existing X
connections need a same-account reconnect to obtain proof; do not synthesize proof
from settings or old tokens. In-flight legacy exchanged receipts without proof are
rejected at completion and require a new authorization attempt. Completed historical
receipts remain replayable. Listing health and execution-time enforcement still need
the broader provider health/capability work; this change does not claim to solve them.

### Execution evidence

A fourth real same-account OAuth attempt completed against the rebuilt local
adapter and updated product API. The original private set, channel, and adapter
integration stayed unchanged. PostgreSQL confirms matching native identity,
`read-write` access, the versioned standard capability snapshot, verification time,
a null token expiry, authenticated credential encryption, and the same proof in
the completed reconnect receipt. No public post was made.

All 124 Go package tests passed after correcting one old capacity-test fixture to
supply the new proof. Full vet, five focused race suites, TypeScript, changed-spec
lint/format, and the production picker/create/replay browser journey passed.
CodeRabbit reviewed 16 source/test files without findings. The later capacity-test
fixture update was inspected and passed in the full rerun. The web application
bundle was unchanged; the existing production build was reused.

Evidence: `.context/x-proof-live-verification.json`,
`.context/x-proof-connected-detail.jpg`, `.context/x-proof-go-final.log`,
`.context/x-proof-race.log`, `.context/x-proof-browser.log`, and
`.context/x-proof-review.ndjson`. The screenshot was inspected after reconnect.
