# Local release automation fixture

This fixture uses real Postgres, Redis, S3-compatible local storage, browser auth,
the Go API, the tenant outbox, and Temporal. GitHub, the OpenRouter chat API,
destination verification, and email transport are local protocol fixtures. It
never proves live GitHub, a real model, or deployed Temporal access.

Use an isolated stack and test database. Do not point this runner at a shared
customer database or another workspace's Temporal queue. The fixture worker
dispatches all pending outbox records in its database; do not run database unit
tests concurrently against that same database.

Prerequisites: the repository's Node, npm, Go, Docker/Compose and Playwright
dependencies. `npm ci`, `npm run build:sdk`, and `npx playwright install chromium`
prepare the application. Follow the existing `dev/studio` local-services setup
for Postgres, Redis, RustFS and its bucket-init service, and Temporal. Use a unique
Compose project and unused host ports if other workspaces have running services.
The runner defaults to web 3049, API 8099, GitHub 8039, destination verification 8049, and Temporal 7253; service
URLs below must match your own stack.

Create a dedicated database whose name contains `test`. Supply these environment
variables from a private local file or shell (all URLs must be loopback):

```text
E2E_DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:<port>/release_automation_test?sslmode=disable
E2E_REDIS_URL=redis://127.0.0.1:<port>
E2E_R2_ENDPOINT=http://127.0.0.1:<port>
E2E_R2_ACCESS_KEY_ID=<local-storage-key>
E2E_R2_SECRET_ACCESS_KEY=<local-storage-secret>
E2E_R2_BUCKET_NAME=<initialized-bucket>
TEMPORAL_ADDRESS=127.0.0.1:7253
```

From the repository root, prepare once and migrate:

```sh
node --env-file=<private-fixture-env> test/e2e/framework/release-automation-stack.mjs prepare
node test/e2e/framework/release-automation-stack.mjs migrate
```

Preparation generates local App/auth/service secrets and writes only the
gitignored `.context/release-automation-fixture.json` with private file mode.
Do not commit or share that file. Restart all fixture processes after preparing
again, since their shared secrets change.

Run each long-lived process in its own terminal:

```sh
node test/e2e/framework/release-automation-stack.mjs github
node test/e2e/framework/release-automation-stack.mjs api
node test/e2e/framework/release-automation-stack.mjs worker
node test/e2e/framework/release-automation-stack.mjs web
```

Wait for the API, Next.js, and Temporal worker readiness messages. The dedicated
test worker registers the production interpreter/activities and uses the actual
outbox dispatcher; it excludes unrelated maintenance schedules and their email
configuration. Production uses `cmd/product-worker`, not this helper.

```sh
node test/e2e/framework/release-automation-stack.mjs test
```

The browser creates a new owner/workspace, enables two-factor auth, configures a
brand and destination fixture, opens Workflows from the sidebar, connects the
local GitHub App, watches a repository, creates a workflow from the release
template with AI copy, edits/validates/previews/activates it, submits signed
events, and checks actual Temporal-created releases, AI-written posts in review,
and the run page. It checks signature and payload rejection, unsupported events,
semantic redelivery with no second model call, a needs-attention run for missing
evidence, deactivation, mobile navigation, and the old settings redirect. The
fixture worker advertises `ai` because the stack points
`OPENROUTER_BASE_URL` at the GitHub fixture's fake chat endpoint, and `render`
because it holds the render URL and key; the web process gets no model key and
renders with a local headless Chromium (`PLATFORM_DESIGN_RENDERER=enabled`).
The second test uploads a product image and records it as a capture. Shifted
storage ports must allow the web origin in the bucket's CORS, as the local
RustFS init script does for port 3000. Fixture workspaces share one installation, so the
fake model counts calls per campaign post rather than globally.
Screenshots are written under `.context/`; Playwright reports/traces use the
existing ignored test-results directory. The normal E2E suite skips this test
unless `E2E_RELEASE_AUTOMATION=1` is explicitly set.

Stop the fixture processes with Ctrl-C. Preserve reports as needed, then stop only
the Compose project and database that you created for this fixture. No cleanup
command in this guide targets another workspace's stack.

## Verification recorded on 2026-10-20 (AI checks, tag releases, renders)

Both browser journeys passed locally (2.8 minutes): the Workflows journey and
the tag-release journey with an AI relevance check, AI copy, bundled unreleased
PRs, and a real render. Screenshots `workflows-editor-ai.png`,
`workflows-run-ai-render.png`, and `workflows-campaign-creatives.png` are local
artifacts under `.context/`. Go unit, Temporal, and Postgres integration tests
for the new features passed, as did the TypeScript contract tests. This is not
live GitHub, model, renderer service, or deployed Temporal verification.

## Verification recorded on 2026-10-20

The Workflows browser journey passed locally in 40 seconds (one test) on an
isolated stack: Postgres 16, Redis 7.4, RustFS, and Temporal dev server
containers on shifted ports, with the GitHub/model protocol fixture, Go API,
fixture worker, and Next.js dev server on the host. Screenshots
`workflows-dashboard.png`, `workflows-dashboard-mobile.png`,
`workflows-editor.png`, `workflows-run-success.png`, and
`workflows-run-attention.png` are local artifacts under `.context/`.

Also passing: the Go suite with `PUBLISHING_TEST_DATABASE_URL` set (including
the release automation and workflow integration tests), `go vet ./...`, root and
workspace JavaScript tests, full ESLint with zero warnings, TypeScript, the
backend SDK build, and all 17 RFC checks. This is not live GitHub, model,
social publishing, or deployed Temporal verification.

## Verification recorded on 2026-10-19

The complete opt-in browser scenario passed locally in 47 seconds (one test).
It used real Postgres, Redis, local object storage, the Go API, tenant outbox,
and a local Temporal server/worker. GitHub OAuth/API/webhooks, destination
verification, and email delivery used local protocol fixtures. The test verified
one release and reviewable campaign after semantic redelivery, visible release
and node history, a skipped prerelease, and workspace-scoped source disconnect.

Additional passing checks:

- Root JavaScript tests: 741 passed. Workspace suites: collaboration 2 passed
  and 1 skipped; editor 21 passed.
- Focused Postgres integration tests: semantic concurrency, immutable versions,
  draft/activation races, independent tenant fan-out and rollback, authorization,
  cancellation/recovery fencing, historical and late events, all three event
  families, action receipts, human review, and uncertain-notification handling.
- Temporal interpreter, retries, cancellation, revocation, missing enrichment,
  and dispatch lost-acknowledgement tests; race checks for the new interpreter
  and contract packages.
- Backend SDK build, TypeScript, API/web database boundary tests, fixture safety
  checks, and all 17 RFC status checks.
- Full repository ESLint and Prettier checks, full Go vet, and changed Go file
  formatting passed. ESLint emitted its existing React-version configuration
  notice, with no lint findings.
- The complete Go suite passed with `GOMAXPROCS=2 go test -p 1 ./...`.
  Database-dependent tests in that general run use their normal skip behavior;
  the focused integration tests above ran separately against migrated Postgres.
  An earlier parallel run hit Temporal's one-second deadlock detector under
  heavy host load; the sequential interpreter/publishing retry and final full
  sequential suite passed.

Screenshots from the successful local run are saved under `.context/` as
`release-automation-editor.png`, `release-automation-success.png`, and
`release-automation-history.png` (local artifacts, not repository fixtures).

The refined editor was also verified in Chromium at desktop and mobile viewport
sizes. The extended scenario covers inspector tabs, node selection, keyboard
movement, validation, both preview paths, stale-preview clearing, activation,
and keeping or discarding unsaved edits. The full local Temporal scenario passed
again after these UI changes. Updated editor screenshots are
`release-automation-editor-refined.png`, `release-automation-preview-refined.png`,
and `release-automation-editor-mobile.png` under `.context/`.

This record is not live GitHub, paid generation, social publishing, or deployed
Temporal verification. No production deployment or customer event was performed.
The production Next.js build and the remaining browser suites were not run.
