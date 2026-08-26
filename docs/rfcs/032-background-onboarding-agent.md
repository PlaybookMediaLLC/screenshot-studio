# RFC 032: Background Onboarding Agent and ICP Extraction

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 004, RFC 011, and RFC 012
**Owners:** Product and Engineering

## Decision

Implement URL onboarding as a two-speed pipeline: a fast synchronous path that
returns a usable profile in seconds, and a background agent that deepens it
over minutes. Extract an explicit Ideal Customer Profile, not only a product
description. Model the structure on the Founder Inbox codebase
(`Oppulence-Engineering/cossistant`), which ships this pattern in production
form.

This RFC refines the pipeline design of RFC 012. The `ProductProfile` data
model, source precedence, safety rules, and extraction contract from RFC 012
stand unchanged. This RFC adds the ICP object, the execution architecture, the
progress model, and the operational limits.

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
2. **One vendor wrapper.** All crawler calls go through one service class. The
   vendor stays swappable.
3. **Manual beats scraped.** A user-typed description always wins over
   extracted content. Extracted values fill only empty fields.
4. **Cache on scrape.** A one-hour `maxAge` on scrapes makes page refreshes
   during onboarding free.
5. **Status on the domain object.** Progress, error, and completion timestamps
   live on the profile row. The UI polls or subscribes; it never inspects jobs.
6. **Incremental re-analysis.** Content hashes per source. Re-runs process only
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
URL submitted
   ↓
scrape homepage + map site        (parallel, cached)
   ↓
extract brand info                (name, description, logo, favicon, keywords)
   ↓
seed BrandProfile draft           (RFC 011)
   ↓
one LLM call → ProductProfile draft + ICP draft
   ↓
return drafts + discovered page count
```

The user lands on a review screen with a filled-in profile, not a spinner.

The fast path has a hard 10-second budget enforced by an abort controller.
Every stage has its own sub-budget, and exceeding one degrades rather than
fails:

| Stage             | Budget | On timeout                                            |
| ----------------- | ------ | ----------------------------------------------------- |
| Homepage scrape   | 4s     | Fall back to metadata-only fetch                      |
| Site map          | 4s     | Continue with homepage links only                     |
| Brand extraction  | 2s     | Skip; brand kit stays empty                           |
| LLM draft         | 6s     | Return the empty profile with the manual form         |

The two fetches run in parallel, so the budgets overlap. If everything times
out, the user sees a manual form in under ten seconds. That is a worse
onboarding than the happy path and a far better one than a spinner that never
resolves.

### Background agent (asynchronous, minutes)

```text
OnboardingRun created
   ↓
crawl discovered pages            (pricing, features, docs, changelog)
   ↓
store PageKnowledge rows          (one per page, content-hashed)
   ↓
classify → enrich ProductProfile
   ↓
derive IdealCustomerProfile       (personas, pains, buying triggers)
   ↓
seed ProductSurfaces              (RFC 013)
   ↓
mark run complete
```

Execution maps to our stack:

| cossistant                       | screenshot-studio                                         |
| -------------------------------- | --------------------------------------------------------- |
| BullMQ queues + Redis slot lease | Trigger.dev tasks (RFC 004) with queue concurrency limits |
| `emitToWebsite` realtime events  | Progress fields on `OnboardingRun`, polled by the UI      |
| Drizzle schema                   | Prisma models                                             |
| Plan checks in the worker        | Same hook; quota enforcement arrives with the billing RFC |

### Data model

```ts
OnboardingRun {
  id
  workspaceId
  url
  status        // queued | crawling | classifying | completed | failed | cancelled | partial
  stage         // current stage label for the UI
  progress      // 0-100
  pagesDiscovered
  pagesProcessed
  pagesSkipped        // unchanged content hash
  error               // stable code plus a safe message
  tokensUsed
  estimatedCostCents
  idempotencyKey      // unique per workspace
  triggerRunId
  startedAt
  completedAt
  deadlineAt          // hard stop
}

PageKnowledge {
  id
  workspaceId
  url
  title
  contentHash
  markdown
  category      // homepage | pricing | features | docs | changelog | other
  fetchedAt
  httpStatus
}

IdealCustomerProfile {
  id
  workspaceId
  personas[]    // { role, seniority, teamSize }
  industries[]
  companySize
  pains[]
  buyingTriggers[]
  objections[]
  wateringHoles[]   // channels where the ICP reads and posts
  toneGuidance
}
```

The ICP feeds copy generation (RFC 015), channel selection (RFC 020), and
content pillars (RFC 025). Every field is editable. Manual edits set the
`lockedByUserAt` flag defined in RFC 012 and block background overwrite.

### Progress model

Progress is a monotonic 0–100 derived from weighted stages, never from a
timer:

| Stage                | Weight | Progress after |
| -------------------- | ------ | -------------- |
| Fast path complete   | 20     | 20             |
| Crawl                | 40     | 60             |
| Classification       | 25     | 85             |
| ICP derivation       | 10     | 95             |
| Surface seeding      | 5      | 100            |

Within the crawl stage, progress interpolates on `pagesProcessed /
pagesDiscovered`. Progress never decreases, even when discovery finds more
pages mid-crawl; the denominator is fixed at discovery time and late
discoveries are queued for the next run.

The UI polls the `OnboardingRun` row. It never inspects Trigger.dev. Polling
backs off from 1s to 5s and stops on a terminal status.

## Concurrency and limits

| Limit                              | Value                                | Enforced by            |
| ---------------------------------- | ------------------------------------ | ---------------------- |
| Concurrent runs per workspace      | 1                                    | Unique active-run key  |
| Concurrent runs platform-wide      | Queue concurrency cap                | Trigger.dev queue      |
| Pages per run                      | 5 free / 25 pro / 100 business       | Discovery cap          |
| Requests per host                  | 1 per second                         | Crawler throttle       |
| Bytes per page                     | 5 MB                                 | Streamed abort         |
| Total run wall clock               | 15 minutes                           | `deadlineAt`           |
| Tokens per run                     | Plan-scoped cap                      | Budget accumulator     |
| Runs per workspace per hour        | 3                                    | Rate limiter           |

A second run request for a workspace with an active run returns the existing
run rather than starting a new one. The idempotency key is
`(workspaceId, normalizedUrl, hour)`, so an impatient double submit is free.

Hitting `deadlineAt` transitions the run to `partial`, not `failed`. Everything
extracted so far is kept and the UI says which stages completed. A run that
crawled 80 of 100 pages produced 80 pages of value.

## Retries

| Failure                    | Retry             | Notes                                    |
| -------------------------- | ----------------- | ---------------------------------------- |
| Page fetch 5xx or timeout  | 2×, backoff       | Per page; other pages continue           |
| Page fetch 4xx             | none              | Recorded with its status, skipped        |
| LLM schema mismatch        | 2×, error appended | Then the batch is skipped                |
| LLM rate limit             | 3×, backoff       | Counts against the run deadline          |
| Storage write failure      | 3×, backoff       | Then the run fails                       |
| Whole-task crash           | Trigger.dev retry | Resumes from stage checkpoints           |

Stages checkpoint to the run row, so a resumed task does not re-crawl pages it
already stored. Retries are idempotent because `PageKnowledge` upserts on
`(workspaceId, url)` and profile merges are governed by the precedence rules in
RFC 012.

A single page failure never fails the run. The run fails only when the fast
path produced nothing and the crawl produced nothing.

## Cancellation

A user can cancel from the onboarding screen. Cancellation sets the run to
`cancelled`, signals the Trigger.dev run, and keeps everything extracted so
far. Cancelling never rolls back a profile. In-flight fetches are aborted and
the browser or crawler slot is released.

Workspace deletion cancels any active run before removing rows.

## Security

All of RFC 012's crawl safety rules apply unchanged: SSRF rejection, pinned DNS
resolution, redirect re-validation, scheme allowlisting, size caps, robots
compliance, and prompt-injection handling.

Two additions specific to background execution:

1. **Untrusted content never becomes an instruction, and never becomes an
   action.** The background classifier has no tools. It reads text and returns
   JSON. Even a fully successful injection can only produce wrong field values
   in a profile that a human is about to review.
2. **`PageKnowledge` markdown is stored as data and rendered as text.** It is
   never rendered as HTML in the workspace UI, because it is third-party
   content that could contain markup.

Stored markdown is subject to workspace deletion and retention. A workspace
that deletes its data deletes its crawled pages.

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
session at enqueue time and is carried on the job payload. The worker treats it
as an already authorized value and never re-derives it from crawled content, a
model output, or a URL. This mirrors RFC 016's rule that `workspaceId` is
runtime-injected and never taken from model output, and it matters more here
because the model is reading attacker-controllable text: a page that says "this
site belongs to workspace X" must have no mechanism by which it could be
believed.

Three consequences follow:

1. Every write the worker performs is scoped to the captured `workspaceId`.
   `PageKnowledge` is unique on `(workspaceId, normalizedUrl)` and profile
   merges are governed by the precedence rules, so a run cannot write outside
   its own tenant even if extraction returns nonsense.
2. If the initiating member loses access or the workspace is suspended before
   the run completes, results are discarded rather than applied. Authorization
   is re-checked at apply time, not only at enqueue time.
3. Crawled content is tenant-private. Two workspaces onboarding the same public
   URL each get their own `PageKnowledge` rows. Sharing a cache across tenants
   would leak which companies are evaluating which competitors, so the
   duplicated storage is accepted deliberately.

## Observability

- Fast-path latency at p50, p95, and p99, and its timeout rate by stage.
- Background run duration, completion rate, and `partial` rate.
- Pages processed versus skipped, which measures incremental-crawl value.
- Tokens and cost per run at p50 and p95, and budget-exhaustion count.
- Onboarding funnel: URL submitted, profile reviewed, profile confirmed, first
  campaign generated.

The funnel is the product metric. A run that completes perfectly but does not
lead to a confirmed profile has not onboarded anyone.

## Degradation

Onboarding must complete even when everything downstream is broken.

| Broken component     | Onboarding outcome                                        |
| -------------------- | --------------------------------------------------------- |
| Crawler vendor down  | Fast path metadata only, plus the manual form             |
| LLM provider down    | Empty profile plus the manual form; background retries    |
| Trigger.dev down     | Fast path completes; background run queued and drains later |
| Redis down           | Rate limits fail closed for new runs; existing runs finish |
| R2 down              | Profile completes; screenshots deferred                   |

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

## Rollout

1. Ship `OnboardingRun`, `PageKnowledge`, `IdealCustomerProfile`, and the
   manual form. Onboarding works fully manually.
2. Ship the fast path behind a flag for internal workspaces. Measure latency.
3. Ship the background run. Measure completion and partial rates.
4. Enable for new workspaces with the manual form always reachable.
5. Seed `ProductSurface` rows last, once RFC 013 lands.

Rollback is a flag flip to manual-only onboarding at any step.

## Out of scope

- Authenticated page capture. That gap needs its own RFC.
- Continuous re-crawling. GitHub events (RFC 022) update product context.
- Embedding-based retrieval over `PageKnowledge`.
