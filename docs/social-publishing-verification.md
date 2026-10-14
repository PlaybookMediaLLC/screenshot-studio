# Social publishing verification plan

This is the release gate for the Go `screenshot-studio-backend` and its social
providers. A provider is **ready** only when its automated contract tests,
isolated live canaries, and production smoke test have evidence. Registration
in the Go provider list or a successful schedule request is not proof of a
published post.

## Current evidence (2026-10-14)

| Destination                    | Automated tests                        | Live local post                                                                                                           | Production               | Status              |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------- |
| Personal LinkedIn              | Go and web scheduling tests pass       | Scheduled image published from private R2; [post](https://www.linkedin.com/feed/update/urn:li:share:7515573217172869120/) | Go services not deployed | Local canary passed |
| X                              | Go adapter and signed media tests pass | `@yoanyombax` and a developer app exist; live posting awaits API credit                                                   | Not deployed             | Unverified          |
| Instagram with Facebook Login  | Go adapter and signed media tests pass | Professional account and Meta app exist; linked Page and Facebook Login canary pending                                     | Not deployed             | Unverified          |
| Instagram with Instagram Login | Go adapter, signed media, and real-service gate pass | [Scheduled image](https://www.instagram.com/p/DedbtZADg8t/) and [Reel](https://www.instagram.com/reel/DedcM38jZQu/) published to `@get.eigenn` | Not deployed | Local canaries passed; 25-hour canary pending |
| Other registered providers     | Provider-specific mock tests vary      | No live canary                                                                                                            | Not deployed             | Unverified          |

On 2026-10-14, `go test -p 1 -count=1 ./...` passed for the updated Go tree. TypeScript
checking, formatting, five OAuth callback unit tests, and all nine Playwright
tests in `e2e/postiz-scheduling.spec.ts` pass locally in one run. The Playwright tests
exercise the real web HTTP routes and tenant database with a mock Go API. They
prove acceptance stays pending until a remote receipt, a Go error fails it, a
429 retries, cancellation stops handoff, uncertain recovery avoids a duplicate,
and missing tenant bindings or disabled Go destinations stop upload. They also
check cross-tenant destination isolation and the X and both Instagram OAuth
callbacks, including one-use state and Facebook Page selection. The separate
real-service gate below covers the Go API and worker with a fake provider.

The isolated real-service gate now runs from `./bin/social-gate` and in the
`social-gate` CI job. It starts a separate Go PostgreSQL, Redis, Temporal, Go
API, Go worker, and build-tag-only fake social provider alongside the local web
app and private RustFS bucket. The local run passed again on 2026-10-14 with the real worker:
duplicate schedule and dispatch produced one remote receipt; a post originally
scheduled 25 hours ahead stayed queued until the test moved it due; signed
media had the expected bytes and content and was signed at dispatch; the Go row retained
an unsigned stable path; cancellation produced no request; HTTP 429 and 500
each retried into one remote post; an expired credential failed without a
remote post. The test also checks the web and Go final receipts. This gate
does not establish that X or Instagram can publish through their live APIs.

Instagram Login now has live local evidence. The approved OAuth grant connected
`@get.eigenn` to the Go organization and an active Screenshot Studio channel.
The scheduled feed image (Go post `cmv7k236y000101o8639gj9ls`) published with
remote ID `17950460037274963`; the scheduled Reel (Go post
`cmv7k2hsx000201o8bj6sgjgy`) published with remote ID
`18143286247533551`. Both provider pages displayed the intended synthetic
caption and media. The profile showed exactly two posts, one for each canary.
The Go rows retained unsigned, stable R2 object paths; unsigned bucket requests
failed, while Instagram fetched both files during publication. A third image
(Go post `cmv7k7kom000301o8f0hm06dt`) is queued for
2026-10-15 04:37:51 UTC, 25 hours after creation. Its actual worker signature,
remote receipt, and visible media remain to be checked after that time.

The test account has two-factor authentication off by the owner's choice.
Screenshot Studio's normal Connect start route requires 2FA and was therefore
not exercised live. A session-bound test state allowed the callback and
persistent connection to be verified without changing that product rule.

Run it after `./bin/studio up` and `./bin/studio smoke`:

```bash
./bin/social-gate
```

The first audit found that the web app marked a post `PUBLISHED` as soon as Go
returned a post ID, before the social network confirmed publication. The web
worker now keeps that post `PROCESSING`, records the Go ID, and polls a
tenant-scoped Go status endpoint. It marks `PUBLISHED` only after the Go worker
reports `PUBLISHED` with a remote release ID. `QUEUE`, missing receipts, and
temporary lookup failures remain pending without another create request;
`ERROR` becomes `FAILED`. The local browser gate proves these transitions for
its controlled fake destination.

## Gate 1: real local services, fake social API

Run the web app, Go API, Go worker, dedicated Postiz PostgreSQL, Redis,
Temporal, and private S3-compatible storage together. Give the web app a
dedicated test organization's Go public API key. Route only test integrations
to a local fake social API; never use a connected personal or customer channel
in this gate. Use unique organization, channel, object, and post identifiers per
run, and remove test records through normal operations.

For one approved image artifact, record the release, exact artifact revision,
approval, scheduled post, publication attempt, Go post, and fake remote post
IDs. Assert these observations across the service boundary:

1. Before approval, scheduling creates no Go post or social request.
2. The web app uploads the correct bytes to the Go API. The Go database stores
   a stable private object URL, not a presigned URL. An unsigned GET fails.
3. Scheduling for a future time creates no early social request. At the due
   time, the worker signs media, and the fake API receives the expected
   caption, content type, bytes or fetchable temporary URL, and one request.
4. The web app records the Go post ID and final published state only after the
   fake social API accepts the post. A schedule acknowledgment alone does not
   pass.
5. Duplicate schedule and dispatch requests produce one remote post. A lost
   response moves to reconciliation or an explicit uncertain state; it must
   not blindly post again.
6. Cancellation, changed artifact revision, revoked approval, disabled
   connection, or lost publisher permission before due time stops handoff.
7. Expired or revoked credentials, HTTP 429, HTTP 5xx, timeout, malformed
   response, failed media fetch, and a worker restart produce safe, visible
   states and bounded retries. Logs and test artifacts contain no credentials
   or signed URLs.
8. A second tenant cannot read, modify, cancel, or dispatch the first tenant's
   schedule or media.

Keep this gate in CI. It runs against real local dependencies and fake social
responses. Remaining Gate 1 fault injection includes lost responses, media
fetch failure, malformed provider replies, worker restart, and a second-tenant
attack against the real Go service. Provider adapters still need their own
contract tests for request shape and media rules.

## Gate 2: provider contract and OAuth tests

For each provider and supported media kind, test OAuth state and callback
validation, required scopes, token refresh, revoked access, provider media
upload or fetch, publishing status, and error classification. Verify the
provider's current limits before declaring a media kind supported. Keep
separate tests for X image, X video, Instagram feed image, Instagram carousel,
and Instagram Reel. Test both Instagram login variants independently if both
will be offered.

The web app now has an authenticated OAuth start route for X and both Instagram
variants. It stores the Go one-use state against the active web organization,
user, and session, forwards callbacks to Go, and registers the returned Go
destination only after checking the operator binding. Instagram with Facebook
Login includes a Page selection step. The callback contract has mock tests and
web-route end-to-end tests. Instagram Login's live callback and destination
registration are verified; its normal 2FA-protected start route, X, and
Facebook Login still need live evidence. A successful Go adapter unit test or
callback mock does not replace this gate.

## Gate 3: isolated live canaries

Use dedicated test accounts and developer apps. The owner must approve each
OAuth grant and live post destination. Keep harmless, clearly labeled test
content and use only media owned by the test organization.

| Provider                       | Prerequisite                                                                        | Minimum live canaries                                              |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| X                              | Test account and developer app with posting and media access                        | Scheduled PNG image, scheduled MP4 video                           |
| Instagram with Facebook Login  | Professional test account, linked Facebook Page, Meta app and publishing permission | Scheduled feed JPEG, PNG conversion, Reel; add carousel if exposed |
| Instagram with Instagram Login | Professional test account and Meta app with Instagram publishing permission         | Feed image and Reel through this distinct OAuth flow               |

For every canary, save the scheduled time, local post and attempt IDs, remote
post ID and URL, provider-visible caption, media dimensions and bytes or a
checksum, and final state. Verify the post appears exactly once and that the
private bucket is still unreadable without a fresh signature. Cancel a second
future post and verify nothing appears remotely. Disconnect a test account and
verify a new schedule cannot publish.

Schedule one media post more than 24 hours ahead. Inspect the stored stable
object URL immediately, then verify the worker creates a fresh signature when
it publishes after the original 24-hour window. Keep the account connected
until its final state and media are confirmed.

## Gate 4: production smoke and rollout

Provision the separate Postiz database, Redis, Temporal namespace, and private
media bucket described in `docs/postiz-go-deployment.md`. Deploy the API and
worker, check both health endpoints, and repeat one image canary per verified
provider using a test destination. Confirm scheduling, worker execution,
remote post, stored receipt, private media behavior, logs, and alerts. Keep a
provider disabled for customers until its own production canary passes.

TikTok photo posting needs a separate design and test: TikTok requires photos
to be fetched from a verified domain or URL prefix, while the current private
R2 S3 hostname has not been configured as one. Do not treat TikTok video
success as proof that photos work.

## References

- [X media upload and posting](https://docs.x.com/x-api/media/introduction)
- [Instagram API with Facebook Login](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login)
- [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)
- [TikTok Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
