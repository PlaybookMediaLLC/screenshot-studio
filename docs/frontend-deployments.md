# Frontend production deployment evidence

Implemented on the opt-in **Workflows → Deployments** page. Existing GitHub
sources receive no policy during migration. Workspace administrators can connect
hosting projects, link a GitHub source, save versioned rules, preview illustrative
or recorded evidence, enable alerts, and select an existing deployment workflow.
Members can inspect evidence and preview the saved policy. Tokens never return to
the browser; blank credential fields retain the encrypted backend values.

## What qualifies

| Provider           | Implemented production evidence                                                                      | Evidence that does not qualify                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GitHub             | Signed App `deployment_status`, selected environment, success, deployment and status IDs             | Actions workflow/job completion, skipped/cancelled/no-op jobs, missing status identity       |
| Vercel             | Signed `deployment.promoted`, correct account and project, distinct promotion event ID               | Created/ready/succeeded builds, previews, accepted rollback requests                         |
| Netlify            | Authenticated site's current `published_deploy`, production context and ready state                  | Signed ready notification alone, unpublished or locked new builds, previews, skipped deploys |
| Cloudflare Pages   | Authenticated project's `canonical_deployment`, production, successful **deploy** stage, not skipped | Preview, build-stage success, skipped/incomplete deploy, old noncanonical object             |
| Cloudflare Workers | First/current deployment from the authenticated deployments API, one version receiving 100%          | Build-only evidence, earlier deployment, split traffic, absent deployment history            |

No integration declares **verified live** or **release ready**. Code merges remain
source changes; Actions runs/jobs, builds, deployments, production activations and
checks are separate facts. No generic HTTP probe is performed. An optional Shots
workflow uses the existing interpreter, qualification, cancellation and human
review requirements. Choosing a deployment workflow does not approve a release,
a claim, campaign content or publication.

Production environments/aliases match exactly. Branch and tag selectors require
provider-reported facts; missing facts produce needs attention. The domain
selector requires an exact hostname in the provider-reported evidence URL. It
is not an HTTP health check or an assertion about custom-domain routing. Vercel
promotion links are usually dashboard URLs; Pages URLs can be deployment URLs.
Leave unsupported selectors blank rather than weakening their requirements.

GitHub Actions observations retain run ID, attempt, workflow ID and job identity
when supplied. Native deployment payloads used here do **not** prove a run/job
association. Selecting a workflow or job therefore requires attention until such
evidence is available; matching SHA, name or timing never establishes that link.

Required checks explicitly select source, name, App/integration identity, scope,
passing conclusions (`success`, optionally `neutral`) and maximum age. GitHub
checks match repository ID **and** commit; Vercel checks match deployment ID.
GitHub commit statuses have no App identity, so use an empty App field and a
trusted status context. Only exact matching evidence can pass. Running checks are
pending; missing, skipped, stale, inaccessible or conflicting results need
attention. Definitive failures take precedence over other pending requirements.
A newer timestamp supersedes an older result; contradictory results at the same
time remain conflicting regardless of arrival order.

Vercel's GitHub metadata provides repository ID and SHA. Pages uses the deployment's
GitHub source ID and a clean `github:push` trigger. Netlify's provider-reported
commit URL is resolved against the linked installation's repository identity.
Direct uploads without trustworthy repository provenance cannot satisfy commit
checks. Workers version/deployment APIs do not establish commit or Actions run
provenance in this implementation. Missing correlation blocks success.

With no additional checks, the event says **Production deployment reported
successful**. With all configured checks passed it explicitly says **required
checks passed**. Neither wording asserts a live revision or customer availability.

## Setup and permissions

1. Apply the reviewed platform migration, deploy API/web and product worker,
   configure `PLATFORM_WEBHOOK_ENCRYPTION_KEY` consistently on API and worker, and
   run the existing Temporal maintenance schedules. `frontend-deployments` runs
   every minute. No new service or public outbound endpoint is required.
2. Connect GitHub through the existing GitHub App/installation flow if using
   GitHub evidence, commit checks or a Shots workflow. Select only required
   repositories. Preserve existing permissions; add repository **Actions: read**,
   **Checks: read**, **Commit statuses: read**, **Deployments: read** for these
   observations. Subscribe to `deployment_status`, `workflow_run`, `workflow_job`,
   `check_run` and `status`, as well as existing event subscriptions. The existing
   App webhook secret verifies `X-Hub-Signature-256` before forwarding. App delivery
   recovery uses the existing App private key/JWT, not a user token.
3. Create a frontend on Workflows → Deployments. For GitHub, choose the connected
   repository, installation ID and repository ID. For hosting providers, supply
   the exact account/team and project/site identity. Multiple frontend projects
   can link to one GitHub source without being merged.
4. Supply provider credentials with the least access the provider can grant:
   - **Vercel:** a team-scoped credential able to GET project metadata and
     deployment checks. Configure an outgoing webhook for created, ready/succeeded,
     error, canceled, promoted and rollback events. Use its signing secret in
     Shots. Verification is HMAC-SHA1 of the original body using
     `x-vercel-signature`, per Vercel's contract.
   - **Netlify:** a token with site/deployment read access to the chosen site,
     preferably a dedicated identity restricted to the necessary team. Netlify
     personal tokens can grant broader access; Shots only issues GET requests.
     Configure deploy notifications with a JWS secret. Verification locks
     `X-Webhook-Signature` to HS256, requires issuer `netlify` and the SHA256 digest
     of the original body. Unsigned notifications are rejected.
   - **Cloudflare Pages:** API token scoped to the selected account with
     **Cloudflare Pages: Read**; configure account ID and project name.
   - **Cloudflare Workers:** API token scoped to the selected account with
     **Workers Scripts: Read**; configure the exact script serving the frontend.
     A staging script must not be selected as the production script. This does not
     use or alter the existing R2 asset-store connection.
5. For Vercel/Netlify, set the provider's outgoing URL to
   `https://YOUR_SHOTS_HOST/api/webhooks/frontends/SOURCE_ID`, displayed after saving.
   Shots does not create or modify provider settings. Cloudflare Pages deploy
   hooks start deployments; they are not an outbound integration here.
6. Preview examples and recorded observations, then explicitly enable new-event
   alerts/workflow processing. The first API poll establishes a silent baseline.
   Enable email or Slack through existing workspace/personal notification settings.

Provider reads use fixed official hosts, bounded response sizes, timeouts and no
redirects. Deployment links are sanitized HTTPS links and are never fetched by
this feature. Existing screenshot capture uses its existing URL/DNS safeguards.

### Provider SDKs

The Go backend uses Netlify's official `netlify/open-api/v2` client (v2.63.0)
for site ownership, published deployments and deployment history, and Cloudflare's
official `cloudflare-go/v7` SDK (v7.13.1) for Pages projects/deployments and Workers
deployments through its service packages, without importing the full SDK root.
Pagination remains explicitly bounded; SDK automatic retries are
disabled so maintenance owns retry timing and persisted checkpoints.

Vercel's standalone official SDK is TypeScript. Its Go Terraform client lacks the
required deployment check-result method and injectable HTTP transport. The
backend therefore uses a small Go SDK generated from Vercel's official OpenAPI
contract for `getProject` and `getAllChecks`. This is a generated client, **not an
official Vercel Go SDK distribution**. The checked-in contract projection retains
upstream paths, parameters and evidence field types, records the upstream hash,
and regenerates with pinned `oapi-codegen` v2.5.1 during `make check`. See
`server/internal/frontenddeploy/vercelapi/README.md` for refresh instructions.

All three clients use the same GET-only, fixed-host transport, 15-second timeout,
1 MiB response limit and safe error classification. Credentials remain in Go.
Netlify request/response debug dumps are disabled even when process-wide
`DEBUG` or `SWAGGER_DEBUG` is enabled.
Cloudflare's raw SDK response metadata preserves fields needed for evidence and
its Workers `result.deployments` envelope, which its generic pagination `items`
model does not expose. Provider signature verification and production/check
policies remain separate from API SDK transport.

## Acceptance, identity and recovery

Backend acceptance resolves the source, verifies the provider's actual signature,
checks account/project, rechecks workspace/source authorization, and commits the
observation, activation decision and outbox intents in one source transaction
before acknowledging. Hosting webhook bodies are limited to 1 MiB; the existing
GitHub facade budget remains unchanged. The stored snapshot contains selected fields, not raw credentials, build environments,
arbitrary repository content or check output. Secrets use existing AES-GCM storage.

The record separates provider occurrence time, receipt time, processing time,
policy/version and decision. History shows both the original receipt decision and
the current activation decision after later checks. Activation IDs retain real
provider IDs. Pages and Netlify do not consistently expose restoration occurrence IDs; a clearly local,
persisted transition key identifies changes in the observed production target.
Provider artifact time and activation observation time remain separate. Returning
to a previously observed active Netlify/Pages deployment is a new transition and
can emit the configured rollback/restoration alert. Workers rollback deployments
remain distinct production activations; rollback intent is not inferred from
build metadata. A→B→A entirely between polls cannot be reconstructed and is a documented coverage limitation.

GitHub observations are retained for linked hosting projects. The selected host
is authoritative for production; GitHub cannot produce a second success or
workflow run for that frontend. Separate projects remain separate even at the same
SHA. Opting a repository into these policies replaces its legacy deployment
fan-out with the explicitly selected workflow(s); releases, PRs, tags and milestones
continue through the existing pipeline. This opt-in change is stated on the form.

Unique source/event keys, activation keys, activity/outbox keys and stable workflow
run IDs survive duplicate deliveries, concurrent acceptance and restarts. The
source's persisted latest activation timestamp suppresses delayed success alerts
for superseded activations. Check results arriving before or after activation are
evaluated against the pinned policy. Configuration changes do not replay history.
Already accepted pending activations retain their original rules. Evidence first
received while paused stays historical after enabling.

Polling processes up to 20 sources per maintenance invocation, with a ten-minute
overlap. Netlify, Pages and Workers lists are bounded to four pages of 50 items.
Incomplete coverage does not advance the successful poll checkpoint. HTTP 401/403,
429 (Retry-After), timeouts and malformed responses become visible source health;
failed reads leave checkpoints unchanged. Changed failure health can emit a
configured needs-attention notification. A detected Pages/Netlify gap over 30
minutes remains visible for operator review. The polling interval does not prove
that no intermediate traffic switch occurred.

GitHub does not retry failed webhooks automatically. The worker reads the latest
100 App deliveries and their request payloads through GitHub's authenticated
App delivery API, filters by installation/repository, and reuses durable acceptance.
It does not mutate provider delivery settings. Missing permissions, more deliveries
than the bounded window covers, or a gap older than 72 hours is explicit health.
Operators must review App delivery history and manually redeliver available missing
events. The normal endpoint then deduplicates them.

Vercel promotions rely on signed webhooks. Its project/build API cannot reconstruct
a missed promotion, so health explicitly says promotion history requires webhooks.
Use Vercel delivery history/retry facilities after an outage; no speculative success
is inferred from a ready deployment. Workers retains bounded deployment history;
this path observes deployments exposed by the API from Wrangler, direct upload,
Actions or other CI, but does not consume Workers Builds queue subscriptions.
Scripts/deployment paths absent from that API are unsupported, visibly requiring
attention. A build alone never becomes an active-version assertion.

## Notifications and architecture

Reuse: source/workspace authorization, encrypted webhook credential pattern,
GitHub App access, Ent transactions, activity catalogue/outbox, notification
preferences/receipts and Temporal maintenance/release workflow dispatch.

New: `frontend_source`, immutable `frontend_observation`, `frontend_activation`,
versioned production/check policies, provider adapters/polling and a member-readable
configuration/evidence page. Additive migration:
`20261103090000_frontend_deployments.sql`; generated Ent code and SDK zod contracts
are included together. No rows or rules are populated for existing customers.

API: backend list/save/history/side-effect-free preview under `/v1/frontend-sources`,
service-only webhook acceptance, typed SDK and tRPC facade. Web code has no database
credentials. Configuration edits require a current administrator session and
optimistic policy revision. Reads recheck current membership.

Activity kinds: `frontend.succeeded`, `frontend.checks_passed`, `frontend.failed`,
`frontend.needs_attention`, `frontend.rollback`, `frontend.connection_attention`.
In-app notifications use current authorized workspace membership. Email and
personal Slack use existing preferences and delivery authority checks; shared
Slack retains the existing coarse, workspace-safe catalogue text. Personal
notifications include provider/project, environment, revision and provider time,
plus an authorized Shots evidence link. External-delivery failure and uncertain
receipts use the existing delivery state machine. Repeated provider delivery does
not create another success receipt. No direct mail/Slack sender was added.

## Verification and rollout

Provider verification here uses official contracts and realistic isolated fixtures,
not customer credentials or live deployments. Unit and database coverage includes
production/preview/build/skipped states, exact and conflicting checks, HMAC/JWS
validation, permissions/revocation/rate limits, duplicate concurrency, later checks,
source authority, separate projects, restoration, restart, pause/baseline and
GitHub recovery with one pinned workflow dispatch. Existing notification, capture,
GitHub and release automation suites cover compatibility and shared transports.
Checks completed locally (Go 1.26.10 and repository-pinned Node 22.23.4):

- `make -C server check`, with `GOFLAGS=-p=1` and
  `PUBLISHING_TEST_DATABASE_URL` pointing to a migrated local PostgreSQL 17
  database: **passed**. Includes generation, all Go tests, required race suites,
  vet and generated Ent consistency. Expected generated files were staged before
  the consistency check.
- The complete `./internal/frontenddeploy` unit suite and additional frontend
  race tests: **passed**. After the last recovery and restoration changes,
  `go test -race ./internal/product -run TestFrontend -count=1` passed with
  `PUBLISHING_TEST_DATABASE_URL` and
  `FRONTEND_TEMPORAL_TEST_ADDRESS=127.0.0.1:7233`. This includes the real Temporal
  maintenance/notification receipt test.
- `npm run quality:check` from `clients/`: **passed** formatting, lint, types and
  tests. Web: 1,140 passed; collab: 9 passed and one existing conditional replica
  test skipped; editor: 22 passed. No test was weakened or newly skipped.
- `npm run build:sdk`, `npm run api:generate`, and
  `python3 dev/verify-rfcs.py`: **passed** (18/18 RFC checks). OpenAPI generation
  produced no unexpected public API changes.
- Native browser run with real authentication, Next.js, Go and PostgreSQL:
  **passed** policy editing, preview without observation writes, ready-only
  suppression, a signed Vercel promotion producing one outbox event, duplicate
  replay producing no second event, and invalid-signature rejection. History
  displayed immutable receipt and current activation evidence; no browser errors
  or horizontal overflow were observed.
- Checked-in `test/e2e/frontend-deployments.spec.ts` through the existing Playwright
  framework, with `--project=production --workers=4 --repeat-each=2`: **2 passed**.
  The initial run used the native Next.js development server and local Chromium.
  It verifies persisted edits, side-effect-free previews,
  stale/invalid saves and real cross-workspace access denial. Focused ESLint and
  formatting checks and a subsequent workspace typecheck also passed.
- After the SDK refactor, `npm run build` from `clients/`: **passed**, including
  TypeScript and all 1,177 static pages. The build reported warnings in the
  existing AVIF/MediaPipe editor dependencies and circular chunks. The standalone
  output was started with the Dockerfile's runtime layout, using Node 22, the
  rebuilt Go API, local PostgreSQL, Redis, Temporal and RustFS.
- Against that production server, the deployment, authorization-revocation and
  notification-preferences browser specs ran with
  `--project=production --workers=4 --repeat-each=2`: **6 passed**. This covers
  deployment edits/previews/tenant denial, role downgrade and session revocation,
  independent notification channels and stale preference saves.
- `npm run test:tenant-isolation -w screenshot-studio` against the production
  server: **passed**. Session and API-key requests could not read or mutate another
  workspace's releases, assets, campaigns, approvals or onboarding runs; a revoked
  key was denied and a key could not approve or schedule unapproved content.
  Request ID: `tenant-isolation:512fa67e-1cb3-4da5-95a7-84db43778173`.
- `git diff --check`: **passed**.

The subsequent SDK refactor also passed `make -C server check` (including Vercel
SDK regeneration, the full Go suite, required race suites and vet),
`go test -race ./internal/frontenddeploy/...`, and the focused frontend/product
race suite with local PostgreSQL and Temporal enabled. SDK coverage verifies
project ownership, exact Vercel check identity/time, explicit pagination limits,
401/403/404/429/503 handling without hidden retries, malformed/oversized responses,
and isolation from process-level Cloudflare credentials. Provider fixtures were
updated to include their real JSON content-type headers and occurrence timestamps.
These are fixture results; live-provider verification remains outstanding.

Earlier local test failures were resolved: Node 24 was replaced by the pinned
Node 22 runtime, and integration fixture cleanup was corrected so retained test
sources/outbox records could not interfere with other suites. Final checks used a
fresh migrated test database. The entire Compose browser and social publishing
suite was not run because this verification setup used individually provisioned
native services rather than the Compose stack; those broader checks remain for
CI. The focused browser flows passed against both native development and
standalone production servers. Live-provider inspection remained unavailable:
no provider credentials were configured in this environment, and the browser
connector returned a reauthentication error.
No live-provider result is claimed by these checks.

For live verification in a dedicated test workspace:

1. Install/migrate the code and verify the maintenance schedule and worker key.
2. Connect dedicated test projects with the permissions above; save paused policies,
   inspect preview decisions and enable only when ready. Confirm silent initial poll.
3. For each provider, perform a preview/build-only run and verify no production
   success, then publish/promote an actual test deployment and verify one success.
4. Configure a named required check: exercise pass, fail, pending, skipped and wrong
   revision, then deliver the late correct check and confirm only one success.
5. Lock Netlify auto-publication, publish manually, and restore an older deploy.
   For Pages restore a prior canonical deployment. For Workers test split traffic
   then a single version at 100%, including a Wrangler/direct-upload path.
6. Redeliver signed events; pause/restart the worker; verify overlap recovery,
   preserved IDs/timestamps, receipt uniqueness and visible unrecoverable gaps.
7. Use isolated email/Slack test destinations only after explicitly configuring
   them; change preferences and membership while delivery is queued, and inspect
   success/failure/uncertainty receipts. Verify selected workflow stops at existing
   human review and never publishes or approves content automatically.

No live provider settings, deployments, automation or external messages were
changed during implementation verification.

## Official contract references (reviewed 2026-10-28)

- [GitHub failed delivery handling](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)
- [GitHub App webhook delivery API](https://docs.github.com/en/rest/apps/webhooks)
- [GitHub check-runs API](https://docs.github.com/en/rest/checks/runs)
- [Vercel webhooks and event payloads](https://vercel.com/docs/webhooks/webhooks-api)
- [Vercel deployment checks API](https://vercel.com/docs/rest-api/reference/endpoints/checks/retrieve-a-list-of-all-checks)
- [Netlify deploy notifications/signatures](https://docs.netlify.com/deploy/deploy-notifications/)
- [Netlify official OpenAPI schema](https://github.com/netlify/open-api/blob/master/swagger.yml)
- [Cloudflare official Pages deployment API types](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/pages/projects/projects.ts)
- [Cloudflare official Workers deployments API](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/workers/scripts/deployments.ts)
- [Cloudflare Pages deploy hooks](https://developers.cloudflare.com/pages/configuration/deploy-hooks/)

RFCs 002, 015, 016 and 029 describe product history and proposals. Current Go/Ent,
Temporal and notification implementations own these paths; no Prisma/Trigger.dev
or automatic release-approval behavior was introduced from historical sketches.
