# RFC 032: Background Onboarding Agent and ICP Extraction

**Status:** Implemented behind the onboarding:agent flag
**Status note (2026-10-17):** All seven rollout steps are built, with the end-to-end test and the dashboard (`infra/dashboards/onboarding.json`). Still open: MCP tools (question 4). Onboarding spends no AI credits, Exa does the third-party enrichment, and the agent is on by default (see Decisions).
**Date:** 2026-08-17
**Revised:** 2026-10-17
**Depends on:** RFC 004, RFC 011, RFC 012, RFC 013, and RFC 026
**Owners:** Product and Engineering

## Decision

Implement URL onboarding as a two-speed pipeline: a fast synchronous path that
returns a usable profile in seconds, and a background agent that deepens it
over minutes. Extract an explicit Ideal Customer Profile, not only a product
description. Model the structure on the Founder Inbox codebase
(`Oppulence-Engineering/cossistant`), which ships this pattern in production
form.

Both speeds run in the Go product backend. The fast path is one backend
endpoint. The background agent is a Temporal workflow on the platform's own
task queue, and its activities call the same Go domain services as the REST
API. The web reaches all of it through the backend SDK and never touches the
database or Temporal.

This RFC refines the pipeline design of RFC 012. The `ProductProfile` data
model, source precedence, safety rules, and extraction contract from RFC 012
stand unchanged. This RFC adds the ICP object, enrichment, the execution
architecture, the progress model, and the operational limits.

## Prior art

The cossistant fork implements website → agent onboarding with these pieces:

| Piece           | Location                                                     | What it does                                                                                                                          |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Crawler service | `apps/api/src/services/firecrawl.ts`                         | One class wraps the crawl vendor: scrape, site map, batch scrape, crawl status, cancel, brand extraction                              |
| Fast path       | `apps/api/src/trpc/routers/ai-agent.ts` `generateBasePrompt` | Scrape one page and map the site in parallel. Generate the agent prompt in one request                                                |
| Crawl worker    | `apps/workers/src/queues/web-crawl/`                         | Background crawl writes knowledge rows. A Redis slot lease caps concurrent crawls. Plan limits apply in the worker                    |
| Training worker | `apps/workers/src/queues/ai-training/worker.ts`              | Embeds knowledge into chunks. Content hashes skip unchanged items. Orphaned chunks get deleted                                        |
| Status model    | `apps/api/src/db/schema/ai-agent.ts`                         | `trainingStatus`, `trainingProgress`, `trainingError`, `onboardingCompletedAt` live on the agent row. Realtime events stream progress |

Patterns we adopt directly:

1. **Two speeds.** The user sees value in seconds. Depth arrives in minutes.
2. **One fetch wrapper.** All page fetches go through one Go package built on
   the platform SSRF guard. A crawl vendor could sit behind it later; none is
   needed now.
3. **Manual beats scraped.** A user-typed description always wins over
   extracted content. Extracted values fill only fields nobody locked.
4. **Cache on scrape.** A page read within the last hour is served from its
   stored `PageKnowledge` row, so page refreshes during onboarding are free.
5. **Status on the domain object.** Progress, error, and completion timestamps
   live on the `OnboardingRun` row. The UI reads the backend; it never
   inspects Temporal.
6. **Incremental re-analysis.** Content hashes per page. Re-runs process only
   changed pages.
7. **Fallbacks everywhere.** Extraction failure degrades to a default profile
   plus a manual form. Onboarding never blocks on the crawler.

## Goals

- A reviewable profile on screen within ten seconds of pasting a URL.
- A run that always terminates, in a reported state, within a hard deadline.
- Partial results that are useful; no all-or-nothing onboarding.
- Bounded, attributable cost per run.

## Non-goals

- Authenticated page capture. That gap needs its own RFC.
- Continuous re-crawling. GitHub events (RFC 022) update product context.
- Embedding-based retrieval over `PageKnowledge`. Classification reads pages
  directly at this scale.
- A conversational onboarding agent. This is a pipeline with a progress bar.

## Design

### Fast path (synchronous, under ~10 seconds)

```text
POST /v1/onboarding-runs              (Go backend; web route /api/v1/onboarding-runs)
   ↓
authorize, flag, rate limit
   ↓
scrape homepage ∥ map site ∥ extract brand    (parallel, cached)
   ↓
one LLM call → ProductProfile draft + ICP draft
   ↓
save drafts (automated source; locked fields skipped), seed BrandProfile draft
   ↓
create OnboardingRun, start OnboardingWorkflow
   ↓
return drafts + run + discovered page count
```

The user lands on a review screen with a filled-in profile, not a spinner.

The fast path has a hard 10-second budget, enforced by a context deadline on
the request. Every stage has its own sub-budget, and exceeding one degrades
rather than fails:

| Stage             | Budget | On timeout                                            |
| ----------------- | ------ | ----------------------------------------------------- |
| Homepage scrape   | 4s     | Fall back to metadata-only fetch                      |
| Site map          | 4s     | Continue with homepage links only                     |
| Brand extraction  | 2s     | Skip; brand kit stays empty                           |
| LLM draft         | 6s     | Return the empty profile with the manual form         |

The three reads run in parallel, so the budgets overlap. Brand extraction
reads the homepage HTML the scrape already holds; it makes no extra request.
If everything times out, the user sees a manual form in under ten seconds.
That is a worse onboarding than the happy path and a far better one than a
spinner that never resolves.

The fast path never waits on enrichment or the background run. It starts the
workflow and returns. If the homepage content hash matches the stored one and
a profile already exists, the fast path skips its LLM call and returns the
saved drafts.

### Background agent (asynchronous, minutes)

```text
OnboardingWorkflow (parent, ID onboarding-<workspaceId>)
   ↓
OnboardingPipelineWorkflow (child, 15-minute execution timeout)
   ↓
crawl discovered pages            (pricing, features, docs, changelog, about)
   ↓
store PageKnowledge rows          (one per page, content-hashed; unchanged pages skipped)
   ↓
classify pages → enrich ProductProfile
   ↓
run enrichment providers          (cached per workspace and domain, TTL)
   ↓
derive IdealCustomerProfile       (personas, pains, jobs, buying triggers, objections, channels)
   ↓
seed BrandProfile / BrandKit      (only empty fields; a draft kit only when none exists)
   ↓
seed ProductSurfaces              (behind a flag until RFC 013 lands)
   ↓
parent marks the run completed, partial, failed, or cancelled
```

Execution maps to our stack:

| cossistant                       | screenshot-studio                                                            |
| -------------------------------- | ---------------------------------------------------------------------------- |
| BullMQ queues + Redis slot lease | Temporal workflows on the `platform-onboarding` task queue                   |
| One active crawl per agent       | Workflow ID `onboarding-<workspaceId>`, conflict policy `USE_EXISTING`       |
| `emitToWebsite` realtime events  | A `progress` workflow query, mirrored onto the `OnboardingRun` row           |
| Drizzle schema                   | Ent schemas in `services/ent/schema`, SQL in `services/platformmigrations`   |
| Plan checks in the worker        | Page cap and token budget enforced in workflow code                          |
| Worker retries                   | Activity retry policy: two retries with backoff, then the page is skipped    |

### Temporal semantics

The workflow code is deterministic. It holds counters, budgets, and progress,
and decides what runs next. Every page fetch, LLM call, enrichment call,
database write, and clock read happens in an activity.

| Concern            | Rule                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Workflow ID        | `onboarding-<workspaceId>`                                                                                             |
| ID policies        | Conflict `USE_EXISTING` returns the active run to a second submit; reuse `ALLOW_DUPLICATE` permits a re-run afterwards |
| Deadline           | The child pipeline has a 15-minute execution and run timeout. When it fires, the parent records `partial`, not `failed` |
| Parent timeout     | 20 minutes, enough for the parent to finalize after the child times out                                                |
| Activity retries   | Maximum three attempts (two retries), exponential backoff from 2 seconds; a page that still fails is skipped           |
| Non-retryable      | A 4xx page response, an SSRF or robots refusal, and a schema mismatch after its own two retries                        |
| Cancel             | A `cancel` signal cancels the child; activities see it at their next heartbeat and stop within seconds                 |
| Heartbeats         | Crawl activities heartbeat after every page and every 5 seconds; the heartbeat timeout is 15 seconds                   |
| Progress           | A `progress` query on the parent returns stage, percent, page counts, and budgets; the child signals each change      |
| Worker             | The orchestrator registers the onboarding workflows and activities on their own `platform-onboarding` queue           |

The child exists so that the 15-minute deadline is a real Temporal execution
timeout and still ends in a reported state. A workflow that hits its own
execution timeout runs no more code, so the parent outlives the child and
writes the outcome.

Stages checkpoint to the database as they finish. When the child times out,
the parent reads the run row to report which stages completed. A cancelled or
timed-out run keeps every `PageKnowledge` row, profile field, and ICP field it
already wrote.

### Data model

Ent models, platform-named, each with `organization_id` on every row and every
query:

```ts
OnboardingRun {
  id
  workspaceId
  url
  status            // queued | running | completed | partial | failed | cancelled
  stage             // fast_path | crawl | classify | enrich | icp | brand | surfaces | done
  completedStages[] // stage names, for accurate partial reporting
  progress          // 0-100, never decreases
  pagesDiscovered
  pagesProcessed
  pagesSkipped      // unchanged content hash or cache hit
  pageLimit
  tokensUsed
  tokenBudget
  enrichmentCostMicros
  modelCostMicros   // what the run's model calls cost the platform
  fastPathMs
  error             // stable code plus a safe message
  idempotencyKey    // unique per workspace
  workflowId
  createdByUserId
  startedAt
  completedAt
  deadlineAt        // hard stop
}

PageKnowledge {
  id
  workspaceId
  runId
  url               // normalized; unique with workspaceId
  title
  contentHash       // sha256 of the extracted text
  pageType          // homepage | pricing | features | docs | changelog | about | other
  text              // extracted text, stored as data
  httpStatus
  etag, lastModified
  fetchedAt
}

IdealCustomerProfile {
  id
  workspaceId       // unique; one per workspace
  personas[]        // { role, seniority, teamSize }
  pains[]
  jobs[]            // jobs to be done
  buyingTriggers[]
  objections[]
  channels[]        // where the ICP reads and posts
  provenance        // field → { source, confidence, url, editedByUser, updatedAt }
}

EnrichmentRecord {
  id
  workspaceId
  domain
  provider          // site | github | appstore | exa
  field             // brand | firmographics | socials | apps | competitors | mentions
  value             // JSON
  confidence
  sourceUrl
  fetchedAt
  expiresAt         // fetchedAt + TTL
  costMicros        // USD micros per call
}
```

The ICP feeds copy generation (RFC 015), channel selection (RFC 020), and
content pillars (RFC 025). Every field is editable. A manual edit sets the
field's `editedByUser` flag, the shipped form of RFC 012's `lockedByUserAt`,
and blocks background overwrite.

`ProductProfile` keeps its shipped shape. Its per-field provenance gains a
`confidence` and a third source, `enrichment`, so the precedence below can be
enforced field by field.

### Progress model

Progress is a monotonic 0–100 derived from weighted stages, never from a
timer:

| Stage                        | Weight | Progress after |
| ---------------------------- | ------ | -------------- |
| Fast path complete           | 20     | 20             |
| Crawl                        | 35     | 55             |
| Classify and enrich profile  | 20     | 75             |
| Enrichment                   | 10     | 85             |
| ICP derivation               | 10     | 95             |
| Brand seeding                | 3      | 98             |
| Surface seeding              | 2      | 100            |

Within the crawl stage, progress interpolates on `pagesProcessed /
pagesDiscovered`. Progress never decreases, even when discovery finds more
pages mid-crawl; the denominator is fixed at discovery time and late
discoveries are queued for the next run. The workflow keeps the maximum it has
reported, and the row update only ever raises the stored value.

The UI polls the backend: the review screen through the same-origin tRPC
facade, API callers through `GET /api/v1/onboarding-runs/{runId}`. Both reach
one backend endpoint. While the workflow runs, the backend answers from the
`progress` query, and falls back to the row when Temporal is unreachable. Polling backs off from 1s to 5s
and stops on a terminal status. No realtime dependency is added.

After onboarding, a card in the bottom-right corner of every app page follows
the same run: how far enrichment has got, the stage it is on, and the pages
read, with a link to review the profile. It stays for half an hour after the
run ends, until dismissed, and workspaces without a run never see it.

## Enrichment

Enrichment fills what a product's own pages rarely say: firmographics,
social reach, app store presence, competitors, and what other people write
about the product. It runs only in the background agent and never blocks the
fast path.

### Provider boundary

Every source implements one Go interface:

```go
type EnrichmentProvider interface {
    Name() string
    Enabled() bool
    Enrich(ctx context.Context, subject Subject) ([]Result, error)
}
// Subject: domain, homepage URL, product name, homepage links.
// Result: field, value, confidence, source URL, cost in USD micros.
```

A provider is enabled by its own environment variable. A missing key disables
that provider and nothing else: the run records the provider as skipped and
completes.

### Providers

| Provider   | Data                                                                 | Configuration                                                    | Cost recorded        |
| ---------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- |
| `site`     | Logo, colors, fonts, social and community links, app store links, JSON-LD organization facts | Always on; reads the homepage already fetched | 0                    |
| `github`   | Stars and followers for the GitHub organization or repository the site links | Keyless; `PLATFORM_ENRICHMENT_GITHUB_TOKEN` raises the rate limit | 0                    |
| `appstore` | App Store listing, rating, rating count, and review snippets from the iTunes lookup and reviews feeds | Keyless; `PLATFORM_ENRICHMENT_APPSTORE_COUNTRY` (default `us`) | 0                    |
| `exa`      | Competitors and alternatives, what customers praise and complain about and where they talk, and company size, industry, funding, and headquarters, all as structured output with per-field citations | `PLATFORM_ENRICHMENT_EXA_API_KEY` (Exa API) | Exa's own `costDollars` per call |

`PLATFORM_ENRICHMENT_DISABLED` lists keyless providers to switch off.

Choices, against RFC 026's criteria. RFC 026 defines the search provider
boundary but names no vendor, so these are recorded here:

1. **No crawl vendor.** Our own fetcher on the platform SSRF guard covers
   scrape, site map, and brand extraction. A vendor would add cost and a
   second network path that our guard does not see.
2. **Exa** for everything third-party, in three structured searches a run:
   competitors and alternatives, the voice of the customer (praise,
   complaints, and channels), and firmographics. Every call sends an
   `outputSchema`, so Exa answers with `output.content` in that shape and
   `output.grounding` gives each field's citations and a low, medium, or high
   confidence, which becomes the stored confidence (capped as third-party).
   A reply without structured output counts as a failure, never as free
   text. Competitor names fill the profile's alternatives as enrichment; the
   rest reaches the ICP as fenced sources. One vendor and one key; Exa
   reports each call's cost, which is recorded as is. It implements RFC 026's
   `SearchProvider` boundary, so it stays swappable.
3. **GitHub and iTunes** are public, keyless, and first-party for the facts
   they hold. Google Play has no public ratings API; a Play link is recorded
   without a rating.

### Caching and cost

Results are cached in `EnrichmentRecord`, keyed by workspace, domain,
provider, and field, with a TTL per provider: 7 days for `site`, `github`, and
`appstore`, and `exa`. A cache hit makes no
call and costs nothing. Every call records its cost in USD micros, and the
run's `enrichmentCostMicros` is their sum.

The cache is per workspace, not per domain alone. RFC 026 and the tenant
rules below forbid a cross-tenant cache, because a shared entry would reveal
that another workspace looked at the same company.

### Merge and precedence

Enrichment results merge into `ProductProfile` and `IdealCustomerProfile`
using RFC 012's precedence, collapsed to three sources:

| Rank | Source                         | Overwrites automatically          |
| ---- | ------------------------------ | --------------------------------- |
| 1    | Manual user input              | never                             |
| 2    | First-party site (`automated`) | fields from rank 2 or 3           |
| 3    | Third-party enrichment         | only empty fields or other rank 3 |

Every field keeps its source and confidence. A third-party value never
replaces something the product's own site says, and nothing automated
replaces what the user typed.

### Untrusted text

Crawled pages, enrichment values, search snippets, and reviews are all
untrusted data. They enter the LLM only inside `<source trust="untrusted">`
fences with their markup defused, never in the system prompt, a tool
definition, or any instruction position. The extraction calls have no tools.
Text that matches an injection pattern is flagged, its source cannot be cited,
and its confidence is lowered. Enrichment output is data the workflow stores;
no field it returns selects a URL to fetch, a stage to run, or a budget.

## Concurrency and limits

| Limit                              | Value                                    | Enforced by                                  |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------- |
| Concurrent runs per workspace      | 1                                        | Workflow ID conflict policy                  |
| Concurrent runs platform-wide      | Worker activity concurrency              | `platform-onboarding` worker options         |
| Pages per run                      | 25 pro / 100 business / 100 enterprise   | Discovery cap, then the workflow's counter   |
| Requests per host                  | 1 per second                             | Crawler throttle in the activity             |
| Bytes per page                     | 5 MB                                     | Streamed abort                               |
| Total run wall clock               | 15 minutes                               | Child workflow execution timeout             |
| Tokens per run                     | Plan-scoped cap                          | Budget accumulator in the workflow           |
| Runs per workspace per hour        | 3                                        | Count of the workspace's recent run rows     |
| Model spend                        | Paid by the platform; no AI credits      | The token budget; cost recorded per run      |

Onboarding spends none of the workspace's AI credits: a new workspace should
not start its month with a dent. The platform pays, bounded by the token
budget and three runs an hour, and every run records its model cost
(`modelCostMicros`) beside its enrichment cost.

A second run request for a workspace with an active run returns the existing
run rather than starting a new one. The idempotency key is
`(workspaceId, normalizedUrl, hour)`, so an impatient double submit is free.

Hitting the deadline transitions the run to `partial`, not `failed`.
Everything extracted so far is kept and the UI says which stages completed. A
run that crawled 80 of 100 pages produced 80 pages of value.

The token budget and page limit are checked in workflow code before every
activity that would spend them. A run that exceeds either stops scheduling
work and reports `partial` with what it has.

## Retries

| Failure                    | Retry              | Notes                                    |
| -------------------------- | ------------------ | ---------------------------------------- |
| Page fetch 5xx or timeout  | 2×, backoff        | Per page; other pages continue           |
| Page fetch 4xx             | none               | Recorded with its status, skipped        |
| LLM schema mismatch        | 2×, error appended | Then the batch is skipped                |
| LLM rate limit             | 2×, backoff        | Counts against the run deadline          |
| Enrichment provider error  | 2×, backoff        | Then the provider is skipped             |
| Storage write failure      | 2×, backoff        | Then the run fails                       |
| Worker crash               | Temporal replay    | Resumes from history and row checkpoints |

Stages checkpoint to the run row, so a resumed workflow does not re-crawl pages
it already stored. Retries are idempotent because `PageKnowledge` upserts on
`(workspaceId, url)` and profile merges are governed by the precedence rules in
RFC 012.

A single page failure never fails the run. The run fails only when the fast
path produced nothing and the crawl produced nothing.

## Cancellation

A user can cancel from the onboarding screen. The backend sends the workflow
a `cancel` signal. The parent cancels the child, in-flight activities see the
cancellation at their next heartbeat, and the parent marks the run
`cancelled`. Cancelling keeps everything extracted so far and never rolls back
a profile.

Workspace deletion cancels any active run when it is requested, and the purge
deletes the workspace's `OnboardingRun`, `PageKnowledge`,
`IdealCustomerProfile`, and `EnrichmentRecord` rows.

## Security

All of RFC 012's crawl safety rules apply unchanged: SSRF rejection, pinned DNS
resolution, redirect re-validation, scheme allowlisting, size caps, robots
compliance, and prompt-injection handling. Every outbound fetch of a
user-supplied URL goes through the platform SSRF guard in
`services/internal/social/ssrf`, which checks each dialed
address, so DNS rebinding and redirect hops are covered. Redirects are capped
at 5, only `http` and `https` on standard web ports are allowed, and robots
are honored for our user agent.

Three additions specific to background execution:

1. **Untrusted content never becomes an instruction, and never becomes an
   action.** The background classifier has no tools. It reads text and returns
   JSON. Even a fully successful injection can only produce wrong field values
   in a profile that a human is about to review.
2. **`PageKnowledge` text is stored as data and rendered as text.** It is never
   rendered as HTML in the workspace UI, because it is third-party content that
   could contain markup.
3. **Workflow inputs carry identifiers only.** The workspace, run, and
   initiating member are workflow inputs; page content and model output never
   decide them.

Stored text is subject to workspace deletion and retention. A workspace that
deletes its data deletes its crawled pages.

### Authentication policy

Only public pages are read. Requests carry no cookies or credentials, links
with credentials in the URL are refused, and a page behind a login is recorded
as unreadable rather than worked around.

### Tenant isolation and authorization

Onboarding is unusual because much of it runs after the request that started it
has returned, so the usual "resolve tenancy from the session principal" rule
needs an explicit extension.

| Operation                     | Permission                              |
| ----------------------------- | --------------------------------------- |
| Start an onboarding run       | `workspace:update`                      |
| Read run status and progress  | `workspace:read`                        |
| Accept or correct the profile | `brand:manage`                          |
| Cancel a run                  | `workspace:update`                      |

The `workspaceId` on a background run is captured from the authenticated
session at start time and is carried in the workflow input. The worker treats
it as an already authorized value and never re-derives it from crawled
content, a model output, or a URL. This mirrors RFC 016's rule that
`workspaceId` is runtime-injected and never taken from model output, and it
matters more here because the model is reading attacker-controllable text: a
page that says "this site belongs to workspace X" must have no mechanism by
which it could be believed.

Three consequences follow:

1. Every write the worker performs is scoped to the captured `workspaceId`.
   `PageKnowledge` is unique on `(workspaceId, normalizedUrl)` and profile
   merges are governed by the precedence rules, so a run cannot write outside
   its own tenant even if extraction returns nonsense.
2. If the initiating member loses access or the workspace is suspended before
   the run completes, results are discarded rather than applied. Every apply
   activity re-checks the member's role and the workspace's state.
3. Crawled content is tenant-private. Two workspaces onboarding the same public
   URL each get their own `PageKnowledge` and `EnrichmentRecord` rows. Sharing
   a cache across tenants would leak which companies are evaluating which
   competitors, so the duplicated storage is accepted deliberately.

## Observability

- Every activity runs in a Sentry span, and every log line carries the
  workflow ID, workspace, run, and request ID. Activity errors are reported to
  Sentry with a safe message, never the page text.
- Fast-path latency at p50, p95, and p99, and its timeout rate by stage.
- Background run duration, and the completed, `partial`, and failed rates.
- Pages processed versus skipped, which measures incremental-crawl value.
- Tokens and model cost per run at p50 and p95, and budget-exhaustion count.
- Enrichment cost per run, by provider, and the cache hit rate.
- Onboarding funnel: URL submitted, profile reviewed, profile confirmed, first
  campaign generated.

The run row is the metric source: it records fast-path latency, status, page
counts, tokens, and enrichment cost, so a dashboard reads percentiles straight
from `onboarding_run`. The backend also writes one structured log event per
finished run and per fast path, for log-based alerting.

The funnel is the product metric. A run that completes perfectly but does not
lead to a confirmed profile has not onboarded anyone.

## Degradation

Onboarding must complete even when everything downstream is broken.

| Broken component     | Onboarding outcome                                              |
| -------------------- | --------------------------------------------------------------- |
| Site unreachable     | Fast path metadata only, plus the manual form                   |
| LLM provider down    | Empty profile plus the manual form; background run skips LLM stages |
| Enrichment provider  | That provider is skipped; the run completes                     |
| Temporal down        | Fast path completes; the run is recorded `failed` and can be re-run |
| Redis down           | AI credit checks fail closed, so LLM stages are skipped          |
| R2 down              | Profile completes; screenshots deferred                         |

The manual form is always reachable from the onboarding screen, not only after
a failure. Some founders will describe their product better than any crawler,
and forcing them through automation to get to a text field is a worse product.

## Acceptance criteria

1. A pasted URL returns a reviewable `ProductProfile` and ICP draft in under
   ten seconds.
2. The background run enriches both within a few minutes and reports progress
   the whole way.
3. A re-run on an unchanged site processes zero pages and performs zero LLM
   calls.
4. Crawler failure still yields a completed onboarding through manual entry.
5. A second submit while a run is active returns the existing run.
6. Cancelling mid-crawl keeps extracted data and reaches `cancelled` within
   seconds.
7. A run hitting its 15-minute deadline reports `partial` with accurate stage
   completion, not `failed`.
8. Progress never decreases during a run.
9. A workspace exceeding its page limit crawls exactly its limit.
10. A page returning 500 is retried twice, then skipped, and the run continues.
11. A run exceeding its token budget stops and reports a partial profile.
12. A page containing injected instructions changes no control flow.
13. Deleting a workspace cancels its active run and removes its `PageKnowledge`.
14. A run with no enrichment keys configured still completes.
15. An enrichment result never overwrites a field the user edited or the site
    supplied.

Workflow behavior (deadline, retries, cancel, dedupe, budgets, and the ID
policies) is tested in the Temporal test environment. The browser flow is
tested end to end with every external call served by local fakes.

## Rollout

Each step is its own pull request, in order:

1. This revision.
2. `OnboardingRun`, `PageKnowledge`, `IdealCustomerProfile`, and
   `EnrichmentRecord`, their migration, and the manual ICP form. Onboarding
   works fully manually.
3. The Go fast path behind the flag. Measure latency.
4. The Temporal workflow and its worker. Measure completion and partial rates.
5. The enrichment providers.
6. The REST routes and the review screen; the web fast path is removed.
7. The end-to-end test and the dashboard.

`ProductSurface` seeding stays behind its own flag, off by default, until
RFC 013 lands.

The whole feature sits behind one workspace feature, onboarding:agent, which
every paid plan includes and which is on by default. `PLATFORM_ONBOARDING_AGENT`
overrides it per environment: `enabled` (the default), `internal` (only
workspaces whose feature overrides grant it), or `disabled`. Rollback is
setting it to `disabled`, which makes onboarding manual-only at any step.

## Decisions

Decided 2026-10-18:

1. **Onboarding spends no AI credits.** The platform pays for its model calls,
   bounded by the token budget, and records the cost per run.
2. **Exa is the enrichment vendor** for competitors, mentions, and
   firmographics, always as structured output; the keyless site, GitHub, and
   App Store providers stay. The platform owns the Exa account, because
   enrichment is part of the product, and sets no spend ceiling.
3. **The agent is on by default** for every paid workspace.

## Open questions

1. **Page limits without a free plan.** There is no free plan any more. This
   revision uses 25 pages for Pro and 100 for Business and Enterprise. Should
   Enterprise get more?
2. **Token budgets.** Proposed: 120,000 tokens per run on Pro and 400,000 on
   Business and Enterprise, paid by the platform. Are those the right caps?
3. **End-to-end infrastructure.** The goal for this work asked for Temporal and
   Postgres in Testcontainers, but the `add-e2e-flow` skill reserves
   Testcontainers for dependencies Compose does not supply, and Compose
   already runs both. The end-to-end test uses the Compose stack. Is that
   acceptable?
4. **MCP tools.** The product backend has no MCP server; the only Go MCP
   server is the social port's. Should the onboarding operations wait for a
   product MCP server rather than be added to the social API's?
5. **Funnel events.** The web already sends onboarding funnel events to
   PostHog. Should the backend emit the server-side half (run completed,
   partial) to the same place?

## Out of scope

- Authenticated page capture. That gap needs its own RFC.
- Continuous re-crawling. GitHub events (RFC 022) update product context.
- Embedding-based retrieval over `PageKnowledge`.
