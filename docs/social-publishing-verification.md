# Social publishing verification plan

This is the release gate for the Go `screenshot-studio-backend` and its social
providers. A provider is **ready** only when its automated contract tests,
isolated live canaries, and production smoke test have evidence. Registration
in the Go provider list or a successful schedule request is not proof of a
published post.

## Current evidence (2026-10-13)

| Destination                    | Automated tests                        | Live local post                                                                                                           | Production               | Status              |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------- |
| Personal LinkedIn              | Go and web scheduling tests pass       | Scheduled image published from private R2; [post](https://www.linkedin.com/feed/update/urn:li:share:7515573217172869120/) | Go services not deployed | Local canary passed |
| X                              | Go adapter and signed media tests pass | No dedicated test account or developer app                                                                                | Not deployed             | Unverified          |
| Instagram with Facebook Login  | Go adapter and signed media tests pass | No professional test account or Meta app                                                                                  | Not deployed             | Unverified          |
| Instagram with Instagram Login | Go adapter and signed media tests pass | No professional test account or Meta app                                                                                  | Not deployed             | Unverified          |
| Other registered providers     | Provider-specific mock tests vary      | No live canary                                                                                                            | Not deployed             | Unverified          |

On 2026-10-13, `go test -p 1 ./...` passed for the updated Go tree. TypeScript
checking, formatting, five OAuth callback unit tests, and all nine Playwright
tests in `e2e/postiz-scheduling.spec.ts` pass locally in one run. The Playwright tests
exercise the real web HTTP routes and tenant database with a mock Go API. They
prove acceptance stays pending until a remote receipt, a Go error fails it, a
429 retries, cancellation stops handoff, uncertain recovery avoids a duplicate,
and missing tenant bindings or disabled Go destinations stop upload. They also
check cross-tenant destination isolation and the X and both Instagram OAuth
callbacks, including one-use state and Facebook Page selection. They do not
exercise the real Go API and worker together; Gate 1 is
still required.

The first audit found that the web app marked a post `PUBLISHED` as soon as Go
returned a post ID, before the social network confirmed publication. The web
worker now keeps that post `PROCESSING`, records the Go ID, and polls a
tenant-scoped Go status endpoint. It marks `PUBLISHED` only after the Go worker
reports `PUBLISHED` with a remote release ID. `QUEUE`, missing receipts, and
temporary lookup failures remain pending without another create request;
`ERROR` becomes `FAILED`. The local browser gate must prove these transitions.

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

Keep this gate in CI. It must run against real local dependencies and fake
social responses. Provider adapters still need their own contract tests for
request shape and media rules.

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
web-route end-to-end tests; the live provider flows still need evidence before
live canaries. A successful Go adapter unit test or callback mock does not
replace this gate.

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
