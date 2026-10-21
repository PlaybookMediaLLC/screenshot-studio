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
and production deployment are not verified by this connection check. The legacy
X adapter still does not persist the newer verified-scope/capability snapshot;
S20 remains in progress even though live authorization and association succeeded.

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
