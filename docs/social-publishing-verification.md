# Social publishing verification

The Go product backend owns `scheduled_post` and `publication_attempt` in the
product PostgreSQL database's `public` schema. Its Temporal worker calls the
Go provider adapters directly. The web calls the published
`screenshot-studio-backend-sdk`; it has no social API key, database connection,
or provider client. Private media remains in R2 and is signed when a publish
activity runs. A confirmed remote receipt is required for `PUBLISHED`.

## Current evidence (2026-10-15)

| Provider | Local live evidence | Production evidence | Readiness |
| --- | --- | --- | --- |
| LinkedIn | A scheduled image reached the owner's account before the backend cutover; the test image was later removed. | None on the cutover architecture. | Needs new canary. |
| X | Test account and developer app exist; API credit for live publishing is unavailable. | None. | Disabled. |
| Instagram Login | A scheduled feed image and Reel reached `@get.eigenn` before the backend cutover; the test media was later removed. | None on the cutover architecture. | Needs new canaries. |
| Instagram with Facebook Login | Mock callback and Page selection tests only. | None. | Unverified. |
| Other providers | Provider-specific unit coverage varies. | None. | Unverified. |

The backend cutover is deployed to the production host (verified with
`doctl apps get` on 2026-10-16), but no live canary has run on it yet. Earlier
live posts prove the social accounts and provider integrations worked under
the previous publish path; they do not prove the new canonical worker path.
The previously queued 25-hour Instagram canary has no verified final receipt
in this cutover record and is not counted as passing.

## Automated local gate

Run `./dev/social-gate`. It creates an isolated Compose project with the real
web app, published npm SDK, Go product API, Go social API and worker, one
PostgreSQL database, Redis, Temporal, private RustFS, and a fake social API.
The Playwright flow signs up, creates an approved variant, connects a test
destination, and schedules through the web. It verifies:

1. Duplicate schedules converge on one canonical post and one remote post.
2. The worker signs private media at publish time; the fake API fetches the
   expected bytes and caption. The database retains a stable unsigned key.
3. The confirmed remote ID appears on one successful `publication_attempt`;
   the legacy social `Post` table gets no customer row.
4. A cancelled post makes no provider request.
5. HTTP 429 and 500 responses retry into one remote post each.
6. An expired provider credential fails without publishing.

The gate schedules an approved campaign variant, not a draft. Draft media
(a photo, a video, an ordered carousel with a MOV, separate posts, an
unanswered submission and a withdrawn approval) is proven through the real
publish activities in the Temporal test environment by
`TestScheduledMediaReachesTheProviderThroughTheWorker`, against a private
signed-URL bucket and a test provider; see
[media scheduling](media-scheduling.md) for the capability matrix.

`test/e2e/social-scheduling.spec.ts` checks the web callback and scheduling facade
with a mock social API, including cross-workspace isolation, X, LinkedIn, and
both Instagram login variants. Go tests cover ambiguous delivery, retry and
workflow behavior. A gate result belongs to its exact commit and SDK version;
rerun it after changing those paths.

## Remaining release gates

- Inject lost provider responses, malformed replies, media fetch failure,
  worker restart, approval revocation, and wrong-tenant access through the
  isolated full stack. Prove no duplicate remote post and the intended
  canonical status for each case.
- Hold a post for more than 24 real hours, then verify the worker signs its
  private media only when it publishes. Moving a future timestamp forward in
  a test proves scheduling behavior, but not elapsed URL expiry.
- Extend the gate to schedule drafts with a photo, a video and a
  multi-image post to its fake destination.
- Run new harmless LinkedIn and Instagram feed/Reel canaries through the
  cutover customer UI. Record the canonical post and attempt IDs, remote ID
  and URL, visible caption/media, and absence of duplicates. X image and video
  canaries require API credit. Facebook Login needs a linked Page and its own
  canaries.
- Deploy the backend migration, Go services, worker, and web SDK build to the
  production host in that order. Repeat one canary per enabled provider on a
  dedicated test destination before customer traffic.

Keep the bucket private. TikTok photo publishing needs its own media design
because the provider requires a verified fetch domain or URL prefix.
