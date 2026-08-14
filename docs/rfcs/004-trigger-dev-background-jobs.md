# RFC 004: Trigger.dev Background Jobs at Scale

**Status:** Proposed
**Date:** 2026-08-13
**Depends on:** RFC 001, RFC 002, and RFC 003
**Owners:** Engineering and Operations

## Decision

Use Trigger.dev Cloud as Screenshot Studio's background-job orchestrator. It
owns task execution, schedules, retries, concurrency control, run visibility,
and durable waits. PlanetScale Postgres remains the system of record for all
business state, authorization, audit evidence, and task intent.

Do not run a home-grown database job queue. Use a small transactional outbox
only to guarantee that a committed business action reaches Trigger.dev. The
outbox is not an executor and it does not store browser or social credentials.

Use Cloudflare Queues only when measured Trigger.dev cost or required throughput
makes operating a queue consumer cheaper than managed orchestration. Keep the
outbox event contract independent so that change does not alter product state,
permissions, or task idempotency.

## Why this fits Screenshot Studio

The product needs jobs that can wait, retry, run at a controlled rate, and
provide a visible history:

- Capture a page through Steel Browser.
- Generate image, video, or localization variants.
- Wait until a scheduled publishing time.
- Publish one approved variant to a social provider.
- Retry provider throttles without duplicating a post.
- Reconcile a delayed or failed provider result.

These are workflows, not simple fire-and-forget messages. Trigger.dev provides
durable execution, retries, schedules, queues, and task run tracing without
adding another always-on service to the initial Fly deployment.

## Task boundary

Start with six tasks. Do not create a task for every small database update.

| Task | Trigger | Does | Does not do |
| --- | --- | --- | --- |
| `capture.release` | Approved capture outbox event | Re-read recipe, call Steel, store result | Accept a public URL or raw browser secret |
| `render.variant` | Asset-ready outbox event | Render one versioned creative variant | Change release approval |
| `publish.scheduled-post` | Within scheduling window | Re-check approval, call provider, save receipt | Publish an unapproved variant |
| `deliver.customer-communication` | Within delivery window | Render approved Markdown, send one channel delivery, save receipt | Store contacts or send an unapproved revision |
| `dispatch.outbox` | Short recurring worker tick | Submit undelivered outbox events to Trigger.dev | Perform the customer-facing side effect |
| `reconcile.provider` | Provider callback or timed retry | Resolve an unknown provider outcome | Guess that a post succeeded |

A task payload contains only stable IDs and version IDs, for example:

```text
organizationId, releaseId, captureJobId, recipeVersion, outboxEventId,
idempotencyKey, requestId
```

It does not contain a session cookie, password, browser step input, OAuth
token, signed R2 URL, or customer-provided HTML.

Each task fetches current state from PlanetScale before the side effect. A
delayed `publish.scheduled-post` task must stop if approval was withdrawn,
membership was revoked, or the connection was disabled after it was queued.

## Reliable triggering

### Transactional outbox

A user action that needs asynchronous work completes one PlanetScale
transaction:

```text
validate authorization
  -> update release / asset / scheduled-post state
  -> write AuditLog
  -> write OutboxEvent with a domain idempotency key
commit
```

`dispatch.outbox` submits the event to Trigger.dev and records the returned
Trigger run ID and delivery time. If the network call fails after commit, the
event remains pending and is retried. This prevents the common failure where
the app commits a scheduled post but crashes before it triggers the task.

The dispatcher claims a small batch with a lease, submits each event, and marks
it delivered only after Trigger.dev accepts it. It must be safe to run more
than once. It is a delivery bridge, not a second queue implementation.

### Idempotency

Use both application and Trigger.dev idempotency.

| Operation | Application key | Trigger.dev key and scope |
| --- | --- | --- |
| Capture a recipe version | `capture:<job-id>:<recipe-version>` | Same key, explicit `global` scope and 14-day TTL |
| Render a variant revision | `render:<variant-id>:<revision>` | Same key, explicit `global` scope and 14-day TTL |
| Publish a scheduled post | `publish:<scheduled-post-id>:<publication-version>` | Same key, explicit `global` scope and 14-day TTL |
| Deliver a customer communication | `deliver:<communication-id>:<document-revision>` | Same key, explicit `global` scope and 14-day TTL |
| Reconcile a provider result | `reconcile:<provider>:<external-id>` | Same key, explicit `global` scope and 14-day TTL |

Do not pass raw strings and assume global behavior. In current Trigger.dev
versions, raw keys default to run scope. Create explicit global keys for
business actions that must occur once across parent-task retries.

Trigger.dev clears a key when a run fails. The database record is therefore the
final duplicate guard. Before each side effect, atomically check and claim the
business record; after it succeeds, save the provider receipt or asset ID. A
retry that sees a completed record returns without calling Steel or a provider.

Use provider idempotency keys where the provider supports them. If a provider
does not support them, `PublicationAttempt` and reconciliation are required
before a retry can create a new post.

## Retries and failure classes

Tasks fail closed. Do not use one generic retry policy.

| Class | Examples | Action |
| --- | --- | --- |
| Retryable | Network error, timeout, 429, 5xx, temporary Steel capacity | Exponential retry with jitter and a bounded attempt count |
| Reconcile first | Provider accepted request but response was lost | Query provider by idempotency or external reference before retry |
| Permanent | Blocked URL, invalid recipe, removed approval, expired connection, unsupported media | Mark failed with safe code; notify user; no retry |
| Security | Private IP redirect, secret access failure, cross-tenant mismatch | Stop immediately, write security audit, alert operations |
| Unknown | Unclassified exception | Retry at most three attempts, then manual review |

The task error visible to the customer is a short failure code and request ID.
Detailed but redacted logs remain in Trigger.dev and application observability.
No task catches an error merely to mark success.

## Concurrency and fair use

Start deliberately below external capacity. Raise limits only after measuring
success, queue age, provider throttling, and Steel capacity.

| Queue | Initial global limit | Per-key limit | Key | Reason |
| --- | --- | --- | --- | --- |
| `capture` | 4 | 1 | `organizationId` | Stops one tenant consuming browser capacity |
| `render` | 8 | 2 | `organizationId` | Keeps media CPU and R2 writes bounded |
| `publish` | 10 | 1 | `channelConnectionId` | Preserves account order and provider limits |
| `customer-communication` | 4 | 1 | `audienceReference` | Prevents duplicate or overlapping audience sends |
| `reconcile` | 10 | 1 | `provider + externalId` | Avoids duplicate status calls |
| `dispatch` | 1 | none | n/a | Keeps outbox delivery simple |

The capture limit must also be no greater than available Steel browser
capacity. The publishing limit must be lower than every connected provider's
documented rate limit. Use Trigger.dev custom queues to share a limit across
related tasks, then use runtime concurrency keys for tenant and connection
fairness.

No task should create an unbounded fan-out. Batch up to 1,000 Trigger.dev task
submissions per API request where a fan-out is genuinely required, and cap
variants per release in product policy.

## Scheduling and long waits

Trigger.dev Cloud runs have a maximum queued lifetime of 14 days. Do not send a
direct delayed publication task further than 13 days into the future.

`ScheduledPost` and `CustomerCommunication` are durable schedules in
PlanetScale. `dispatch.outbox` selects due posts and customer communications
in a rolling seven-day window and creates the appropriate Trigger.dev task.
This supports a calendar months ahead without relying on one long-lived task.
A cancellation removes the item from the eligible window and cancels its known
Trigger run when one exists.

Tasks use Trigger.dev durable waits for normal short waits, polling intervals,
and retry backoff. Waiting time is checkpointed, which avoids holding compute
or concurrency for most of the delay.

## Scaling model

### First production phase

- Trigger.dev Hobby is sufficient for design partners and low traffic.
- Trigger.dev Pro is required before production needs more than Hobby's 25
  concurrent runs, 250,000 queued runs per production queue, or its support
  level provides.
- Run Steel separately from the Next.js application. Scale its browser
  capacity independently; task concurrency is the admission control.
- Keep PlanetScale in US East. Fly US West instances use the same primary
  database until a read-scaling design is justified.
- Store media in R2. Do not move binary payloads through Trigger.dev.

### Scale controls

Set and review these limits monthly:

| Control | Initial target | Action when breached |
| --- | --- | --- |
| Oldest queued capture | under 5 minutes | Increase Steel capacity or reduce capture concurrency |
| Capture completion p95 | under 2 minutes | Investigate source hosts, browser pool, and recipe quality |
| Publish start delay p95 | under 2 minutes | Increase provider-safe queue concurrency |
| Retry rate | under 2% | Classify provider and Steel failures before adding capacity |
| Duplicate publications | zero | Block rollout and investigate idempotency path |
| Outbox age | under 60 seconds | Investigate Trigger API, dispatcher, and credentials |
| Trigger spend | under 20% of capture-worker spend | Review the queue migration option |

Scale by queue and provider, not by one global environment limit. A burst from
one social network must not delay a capture or a different provider.

### Exit path when volume makes orchestration expensive

Cloudflare Queues is the first lower-cost alternative. Paid accounts include
one million queue operations per month and charge $0.40 per additional million
operations; a normal delivery uses write, read, and delete operations. It also
supports HTTP pull consumers, retries, delays, and dead-letter queues.

Move only the dispatch target, not business logic:

```text
PlanetScale transaction -> OutboxEvent -> dispatcher
                                       -> Trigger.dev today
                                       -> Cloudflare Queue later
```

The Fly worker still performs Steel and provider calls. It must keep the same
database claim, provider idempotency, audit, retry classes, and R2 handling.
Cloudflare Queues lowers queue cost but adds worker capacity, monitoring,
dead-letter operations, and on-call responsibility.

Consider self-hosted Trigger.dev only for a clear requirement such as data
residency, private networking, or sustained spend that exceeds the cost of its
operational burden. Do not self-host solely because the product has started to
scale.

## Cost model and budgets

Trigger.dev Cloud charges per run plus active compute time. The current
Small-1x rate is $0.0000338 per second, plus $0.000025 per run. Use this
formula:

```text
monthly Trigger cost =
  runs × $0.000025
  + active seconds × selected machine rate
  - included plan credits
```

A task that waits for Steel or a schedule should checkpoint rather than poll,
so the wait does not consume active compute. Steel browser compute, R2 storage,
social API usage, PlanetScale, and Fly are separate costs and must be tracked
separately.

Set Trigger.dev budget alerts at 75%, 90%, and 100%. Add a per-organization
capture and render quota before a customer can create an unbounded bill.

## Observability and operations

Every task logs and carries:

```text
Trigger run ID, task ID, environment, request ID,
organization ID (or a safe hash), aggregate ID,
idempotency key hash, attempt number, provider, outcome, duration
```

Do not log secret references, URLs with query credentials, cookies, R2 signed
URLs, social tokens, or unredacted browser input.

Monitor and alert on:

- outbox age, undelivered count, and dispatch error rate;
- task queue depth, queue age, run failure rate, and retry rate;
- Steel capacity, capture duration, blocked-network attempts, and host errors;
- provider throttling, unknown outcomes, and publication start delay;
- idempotency collisions and any duplicate side-effect signal;
- Trigger spend, plan limits, and quota exhaustion.

If Trigger.dev is unavailable, the application still commits business state and
outbox events. It shows work as queued, pauses new non-essential capture work
when the backlog threshold is reached, and retries dispatch after recovery.
An operator can backfill pending events by ID; the same idempotency rules apply.

## Security

- Store `TRIGGER_SECRET_KEY` only in server-side deployment secrets, scoped by
  Trigger.dev environment. Never expose it to the browser.
- Authenticate Trigger endpoints and task webhooks. Do not let a public route
  trigger a task based on untrusted customer payload.
- Re-authorize organization, approval, and connection state inside every task.
- Task payloads contain IDs only. Resolve secret references at execution time
  through the approved secret manager.
- Use separate Trigger.dev projects or environments for development, support,
  staging, and production. Never share production keys with preview builds.
- Treat Trigger.dev task logs as sensitive operational data; retain only what
  support and incident response require.

## Rollout

1. Add the Trigger.dev SDK and Next.js integration only with the first real
   `capture.release` task. Do not add an unused dependency now.
2. Add outbox, audit, and idempotency tables from RFC 002.
3. Deploy development and production Trigger.dev environments with separate
   keys and a single no-op health task.
4. Implement `capture.release`, then prove retry, cancellation, blocked-host,
   and cross-tenant test cases.
5. Implement `render.variant`, then `publish.scheduled-post` with one provider.
6. Set the initial concurrency, budget, and queue-age alerts before customer
   traffic.
7. Run a failure exercise: kill a dispatcher after commit, fail Steel mid-run,
   and lose a provider response. Confirm recovery creates no duplicate asset or
   post.

## Acceptance criteria

- A committed outbox event eventually maps to one Trigger.dev task run or a
  visible retryable dispatch failure.
- Replaying the same event does not duplicate a capture, render, or post.
- A task that waits longer than five seconds does not consume active worker
  capacity for the wait.
- A post scheduled more than 14 days ahead is stored in PlanetScale and enters
  Trigger.dev only inside the rolling window.
- A customer communication renders from one approved Markdown revision and is
  delivered at most once for its communication ID and document revision.
- One organization cannot exhaust all Steel or provider capacity.
- Revoked approval, membership, or connection state blocks an already-queued
  task before it creates a side effect.
- Trigger outage recovery and provider unknown-outcome reconciliation are
  tested before production publishing.
- Queue age, failure rate, budget, and duplicate-publication alerts are live.
