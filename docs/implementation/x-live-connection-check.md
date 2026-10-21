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
receipts remain replayable. The follow-up below adds proof checks to listing health and provider handoff.
Content eligibility and ongoing remote revocation detection remain separate work.

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

## Stored verification governs health and provider handoff

X, Bluesky, and custom Mastodon now require a valid stored native identity, grant,
capability snapshot, and verification timestamp before an otherwise active account
reports connected. A legacy `twitter` adapter identifier remains unverified until
reconnected through canonical X. Removed, revoked, expired, and permission-required
states retain precedence. Invalid proof blocks draft scheduling without changing the
draft or creating a scheduled post.

Social workflow activities reload all five verification fields from the current
credential row and pass them to the provider. Previously their conversion dropped
these fields, including the Bluesky limits required by its publishing checks.
Verification is excluded from serialized workflow snapshots: old history cannot
supply a missing or superseded grant. Publication, pending publication, comments,
status checks, and finalization are covered across the Temporal data converter.

The direct publisher rejects missing proof, incomplete setup, deleted accounts,
and mismatched tenant/destination/provider records before signing media. It reloads
credentials and proof after signing and before each thread reply, checks identity
continuity, and retains the last confirmed receipt if access is lost mid-thread.
A media-signing failure now stops the reply instead of being overwritten by a
successful settings conversion and producing a reply without its selected media.
Custom Mastodon remains outside the direct publisher allowlist; this does not enable
another publishing route.

The updated local product API and existing production web bundle showed the approved
X account connected. A controlled disposable-database fixture temporarily removed
only verification metadata: the real UI showed unverified and instructed reconnect.
Restoring the original metadata returned the same account to connected. Database
verification confirmed the original identity, write grant, four completed attempts,
one channel, null token expiry, and encrypted credentials remained intact. This is
local missing-proof/recovery evidence, not a live provider revocation test. Screenshots
were captured and inspected in `.context/x-health-unverified.jpg` and
`.context/x-health-connected.jpg`. No public post was made.

No new DDL is required. Apply existing social migration 0003 and deploy the proof-capable
adapters before the updated product API and publishing workers. Legacy records for
these adapters require reconnect; do not fabricate verification from editable settings.
An in-flight workflow with missing proof stops and requires recovery after reconnect;
check any existing remote outcome before retrying publication. Old workflow payloads
remain compatible because current credentials and proof are loaded in activities.

Remaining work includes remote revocation/health probes, native ownership conflicts,
full X text/media eligibility at queue and handoff, and live publication verification.
The separate legacy account-standing path still derives Premium/article allowances
from editable settings and needs replacement with verified capability enforcement.
This increment does not establish those allowances or complete S18/S20.

Validation: all 124 Go packages passed with `go test -p 1 ./... -count=1` against
migrated disposable PostgreSQL; full `go vet ./...` passed. The product, social
activities, direct publisher, and shared identity packages passed `go test -race
-p 1`. The local API build passed; no web application source changed, so its existing
production build was reused. CodeRabbit reviewed all 13 changed source/test files
with zero findings. The first new fixture expectation incorrectly assumed custom
Mastodon was allowed for direct publishing; its corrected assertion preserves the
existing restriction, and the complete rerun passes.

Evidence: `.context/social-proof-health-{go,vet,race,build}.log`,
`.context/social-proof-health-review-final.ndjson`,
`.context/x-proof-live-verification.json`, and the two inspected health screenshots.

## X account limits and queue validation — 2026-10-21

The signed, authenticated `users/me` response now provides subscription facts for
new connections. Recognized values map to documented account features: `None`
uses standard posts; `Basic`, `Premium`, and `PremiumPlus` support 25,000 weighted
characters. Articles are a separate capability, enabled only for `Premium` and
`PremiumPlus`. Unknown or absent subscription values retain unknown optional
capabilities. Legacy snapshots with null optional fields remain readable and do
not acquire permissions from their subscription label. They require reconnect
for the new facts. Neither the editable `Verified` setting nor the workspace plan
can grant long posts or Articles.

The account list, composer, and server-side draft serializer use explicit
`xCaptionLimit` and `xArticles` values. Go independently reads the tenant-bound
stored proof inside the scheduling transaction. It validates root and reply text,
including canonical URL weighting, NFC normalization, emoji sequences, invalid
characters, and the applicable account limit. The frontend now uses the pinned
`twitter-text` 3.1.0 parser, matching the existing Go port, instead of its approximate
URL/emoji counter.

Scheduling checks uploaded workspace asset MIME types and byte sizes before
creating any posts. It rejects extra X images instead of dropping the fifth image,
GIF/video combinations, unsupported files, oversized files, and video with unknown
account limits. Article covers receive the same tenant and image checks. Shots'
existing four-attachment and 100,000-character article bounds are application
limits, not claims about X's full Articles contract. Quote posts and quote-thread
finishers remain unavailable because this connection has no verified Enterprise
API access. Rejected multi-target schedules create no partial posts.

Primary references checked on 2026-10-21:

- [X data dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary):
  `subscription_type` is meaningful for the authenticated user; recognized values
  are None, Basic, Premium and PremiumPlus.
- [X Premium features](https://help.x.com/en/using-x/x-premium) and
  [Articles](https://help.x.com/en/using-x/articles): longer posts and Articles
  have different eligible subscription tiers. New subscription names remain
  unknown until their API mapping is established.
- [Create post](https://docs.x.com/x-api/posts/create-post): quote posts require
  Enterprise API access. Documented video maxima are 8 GB/20 minutes for standard
  accounts and 16 GB/125 minutes for Premium accounts. These facts do not establish
  successful media processing, paid API quota, or publication permission.
- [Media best practices](https://docs.x.com/x-api/media/quickstart/best-practices):
  image/GIF formats, size limits, and additional dimensions/duration constraints.

No DDL is needed. Deploy compatible proof readers (product API, social API, and
workers) before allowing the new adapter to emit non-null optional capabilities.
Use a coordinated cutover with connection/callback traffic drained if old and new
adapter instances would otherwise overlap: older validators reject these newly
populated facts. Keep the compatible validator on rollback. Deploy the SDK/web
after the product API; missing fields from an older API remain conservative.
Existing connected records retain their null optional facts until reconnect.

This increment establishes queue validation, not complete execution-time content
eligibility. The X adapter still needs fresh account capability checks before
publication, source-byte/media dimension and duration validation, removal of its
implicit image transformations, and full handling of its legacy post paths.
Other provider live checks and remote revocation detection remain open. The real
approved account remains connected with its prior standard-only proof; synthetic
subscription fixtures do not verify that account's paid subscription. No public
post, live Article, or live video upload was performed.

### Account-limit verification evidence

All 124 Go packages pass against the migrated disposable database, as do full
`go vet` and five race suites (product, shared identity, direct publishing, X
adapter, and text helpers). The SDK build, TypeScript, lint, formatting, RFC checks,
936 root JavaScript tests and workspace suites pass; the existing opt-in Redis
replication test remains skipped. After the browser import correction, all 24
focused serializer/publication tests and the final production build pass.

The production browser regression writes and adapts a thread, plans and schedules
it against fixture accounts, and recovers a backup (18.5 seconds). A new browser
journey verifies legacy editable metadata stays at 280, Basic proof changes the
counter to 25,000 without changing persisted text, and a Basic Article is rejected
by the server with no scheduled post (5.3 seconds). These are local protocol/database
fixtures, not live paid-account publishing. Both populated capability screenshots
were captured and inspected. The real approved account was separately reloaded in
Chrome and remains connected.

The first production browser run exposed a module-export mismatch in twitter-text:
its CommonJS entry supports named properties while the browser ESM entry exports
a default object. Using the default import fixes the runtime failure. Later test
assertions were corrected to target the editor's text leaf and validate the HTTP
receipt fields independently of in-memory Date schemas; exact text and durable
no-post assertions remain in place. Initial Go media fixtures also required valid,
unique asset IDs; the final complete suite passes. CodeRabbit reviewed all 33
changed files with zero findings; subsequent test-only assertion corrections were
inspected and passed in the browser rerun.

Evidence: `.context/x-content-{go,vet,race,js,build-final}.log`,
`.context/x-content-browser-final.log` (thread regression),
`.context/x-content-capability-browser-final.log`,
`.context/x-content-review-final.ndjson`, `.context/x-content-basic-long-post.png`,
`.context/x-content-basic-article.png`, and `.context/x-authorized-confirmed.png`.

A final incremental TypeScript invocation hit an internal compiler stack overflow.
The clean `npx tsc --noEmit --incremental false` check passed with no diagnostics
(`.context/x-content-typecheck-clean.log`); the production build's TypeScript
check also passed. This did not require a source change.


## Fresh X content checks before handoff — 2026-10-21

The X adapter now requires the current persisted native proof and matching
credential, then reads signed `users/me` immediately before preparing a post and
again before a confirmed pending post is sent. The bounded, redirect-refusing
identity client rechecks the native ID, observed OAuth 1.0a write grant, and
current authenticated subscription. It never falls back to cached subscription
facts after a rate limit, provider outage, cancellation, or rejected identity.
The workflow and direct publisher remain responsible for reloading the current
tenant-bound integration before each adapter invocation.

- Root posts and all supplied thread replies are checked before root media is
  uploaded. Finalization rechecks text limits, Article eligibility, and the
  unavailable Enterprise quote capability using the current provider response.
- Comments recheck before upload and after any media-processing wait. Direct
  replies and automatic plug replies use the same current-identity and text
  checks. Standard and long-post limits use the existing canonical weighted
  parser; Article text retains the explicit 100000-character application bound.
- `STRIP_LINKS_FROM_X_POSTS` no longer changes X posts or scheduler content.
  Approved links and long text are retained. Existing content already altered
  by an older process is not reconstructed automatically.
- Missing post IDs no longer count as successful tweet/reply receipts. The
  non-retrying direct-reply client is preserved; an ambiguous response requires
  checking the remote account. The existing pending-create handshake remains.

The provider contracts are the existing [authenticated account facts](https://docs.x.com/x-api/fundamentals/data-dictionary),
[X post creation](https://docs.x.com/x-api/posts/create-post), and
[Articles API](https://docs.x.com/x-api/articles/introduction). These checks do
not imply that account subscription guarantees app quota, every media allowance,
or successful publication.

Protocol fixtures cover missing/mismatched stored proof, disabled/deleted/revoked
accounts, a changed remote native ID, missing/read-only grants, HTTP 401/429/503,
unknown subscriptions, downgrade between preparation and finalization, invalid
thread text before upload, unverified Article/quote attempts, exact long text and
links, missing receipts, automated replies, and no direct-reply retry on HTTP 500.
The existing image/video/Article fixtures now supply explicit stored and remote
identity proof. Two video-upload fixtures were corrected to represent ordinary
video posts rather than Articles; they still assert chunking and provider errors,
not source-byte validity.

Validation passed: 124 Go packages with `go test -p 1 ./...`, full `go vet`,
race checks for X, socialidentity, social activities and the direct tenant
publisher, and 17/17 RFC checks. CodeRabbit reviewed all seven changed files with
zero findings; the final added post-upload subscription regression was inspected
and passed the race run. An initial compile check caught an unused test import,
which was removed before the successful runs. No frontend source or contract
changed, so the prior production build/browser verification remains applicable.
Logs are `.context/x-handoff-go-test.log`, `x-handoff-go-vet.log`,
`x-handoff-provider-race.log`, `x-handoff-publisher-race.log`, `x-handoff-rfcs.log`
and `x-handoff-review-final.ndjson`.

The already-approved live account remains visibly connected in Shots. A read-only
database check confirms one connection, four completed attempts, the native
account/write grant, encrypted credentials, and no fabricated expiry. No new OAuth grant, public post,
Article draft, or media upload was performed against that account in this
increment. Local protocol fixtures do not count as live publishing verification.

Remaining X work includes source-byte/dimension/duration inspection, removal of
legacy media conversion and silent missing-media handling, exact poll behavior,
legacy social API long-post admission, and auditing automatic retries of the
existing root/Article HTTP mutation client. Remote health beyond these publish-time
checks, native ownership conflicts, app quota, real publication, and production
rollout remain unverified. S18/S20 remain In progress.

Deployment needs updated social API and publishing worker binaries. No schema or
new environment variable is introduced. Existing optional-capability reader
compatibility rules still apply. Fresh identity lookups add read requests and can
block publication when X is unavailable; pending workflow outcomes remain
conservative after an armed attempt. Rollback restores older publication behavior,
including any legacy link-stripping configuration.
