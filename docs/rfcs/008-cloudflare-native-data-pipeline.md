# RFC 008: Cloudflare Data Plane for Release Assets

**Status:** Proposed
**Date:** 2026-08-13
**Depends on:** RFC 002, RFC 003, RFC 005, RFC 006, and RFC 007
**Complements:** RFC 004 and RFC 006
**Owners:** Engineering, Security, and Operations

## Decision

Keep **Trigger.dev Cloud** as Screenshot Studio's durable workflow and
background-job orchestrator. RFC 004 remains in force for task execution,
schedules, durable waits, retry policy, queue concurrency, task visibility,
and provider handoff.

Use **Cloudflare** as the release asset data plane:

- **R2** stores all tenant source, derived, temporary, and quarantine media.
- **Workers** provide signed ingress, upload sessions, R2 event handling, and
  the internal result APIs used by media processors.
- **Cloudflare Queues** buffer R2 events and media work. They do not replace
  Trigger.dev task queues or own business state.
- **Cloudflare Containers** run heavy image inspection, thumbnailing, visual
  rendering, transcoding, and video encoding where a Worker is not suitable.
- **Hyperdrive** gives Workers a pooled, TLS-protected connection to the
  required PlanetScale Postgres cluster.

PlanetScale remains the system of record for authorization, releases, assets,
lineage, idempotency claims, audit logs, quotas, and the transactional outbox.
Trigger.dev remains the system that decides when a product workflow starts,
waits, retries, or hands an approved artifact to a connected provider.

Do not introduce Cloudflare Workflows in this phase. Running two durable
workflow schedulers would duplicate state and make cancellation, retries, and
audit evidence unclear. Cloudflare Queues move bytes and media jobs; Trigger
tasks coordinate business workflows.

## Why this boundary

RFC 006 correctly places tenant media in private R2, but its current task graph
places normalization, rendering, and media execution in Trigger.dev. That is
the wrong place for large R2 objects, FFmpeg, Sharp, safe decoders, and
container-level resource limits. Trigger.dev should coordinate those actions,
not carry or transform media bytes.

This split keeps every system on the job it handles best:

| System | Owns | Does not own |
| --- | --- | --- |
| Next.js RPC and Better Auth | Interactive requests, session authorization, release creation | Background work execution or large media upload proxying |
| PlanetScale Postgres | Business state, tenant isolation, idempotency, audit, outbox | Media bytes, tokens, or task payload blobs |
| Trigger.dev | Workflow runs, schedules, retry policy, task concurrency, provider handoff | R2 media processing or durable media storage |
| Cloudflare R2 | Private immutable source and generated objects | Approval, scheduling, or public authorization |
| Cloudflare Queues | R2 notifications and bounded media-work dispatch | Product workflow decisions or provider publishing |
| Cloudflare Workers | Edge ingress, R2 control, result persistence | CPU-heavy media decode or video encoding |
| Cloudflare Containers | Isolated media compute and deterministic output | Direct database access, provider tokens, or tenancy authority |

The application must never use a Trigger task as a binary transport. A task
passes stable IDs and version references to Cloudflare. A Container passes
structured result data and immutable R2 keys back to the application.

## Scope and non-goals

### In scope

- Private R2 upload, verification, quarantine, derivative generation, and
  deletion for source screenshots, video, and generated artifacts.
- R2 event-driven asset readiness.
- Cloudflare Container execution for long-running or resource-intensive media
  operations.
- The handoff contract between Trigger tasks and Cloudflare media work.
- Tenant isolation, idempotency, operations, cost attribution, and recovery.

### Out of scope

- Replacing Trigger.dev, its schedules, its durable waits, or its provider
  workflow tasks.
- Moving the Next.js editor, tRPC API, Better Auth, or PlanetScale to Workers.
- Replacing Steel Browser for authenticated captures. Cloudflare Browser
  Rendering may later support public non-authenticated capture only.
- Storing social provider credentials, browser credentials, or customer
  contacts in Cloudflare Queues, R2 metadata, or Containers.
- Adding a generic job table or generic workflow engine.

## Architecture

```text
Next.js RPC / signed webhooks
        |
        | PlanetScale transaction: aggregate + AuditLog + OutboxEvent
        v
Trigger.dev dispatch.outbox
        |
        +--> Trigger workflow task (business decision, schedule, provider handoff)
        |              |
        |              | stable aggregate and media-execution IDs only
        |              v
        |       Cloudflare Worker -> Cloudflare Queue -> Container
        |                                            |
Browser / Steel capture -> private R2 staging -> R2 event Queue
                                            |
                                            v
                                  Worker verifies object and writes outbox
                                            |
                                            v
                                      Trigger.dev process.asset
```

The path back from a Container is also durable. The Container writes an
immutable R2 object and calls an authenticated internal Worker result endpoint.
That Worker validates the object, atomically updates PlanetScale state, writes
an audit event and outbox event, then lets Trigger.dev start the next business
step. A Trigger task never waits for a Container process to finish.

## Cloudflare resources

Each environment gets separate resources with environment and region-free
names such as `ss-prod-*`. Development and production never share a bucket,
queue, database credential, or Cloudflare account token.

| Resource | Purpose | Rule |
| --- | --- | --- |
| `ss-<env>-pipeline-gateway` Worker | Webhook verification, upload-session creation, controlled multipart operations | It authorizes each request before it creates an R2 operation. |
| `ss-<env>-pipeline` Worker | R2 queue consumers, media dispatch, result callback, and reconciliation | It is the only Cloudflare component permitted to update media state in PlanetScale. |
| `ss-<env>-source` R2 bucket | Immutable original uploads and Steel captures | Private; keys begin with the tenant and aggregate ID. |
| `ss-<env>-derived` R2 bucket | Immutable generated images, videos, and exports | Private; artifacts refer to a versioned object key. |
| `ss-<env>-quarantine` R2 bucket | Failed verification and unsafe material | No editor or provider may read from it. |
| `ss-<env>-r2-events` Queue | R2 object-create notifications from staging prefixes | Filters prevent derived-output loops. |
| `ss-<env>-media` Queue | Bounded requests to inspect, transform, or render media | Payload contains only a `MediaExecution` ID. |
| `ss-<env>-render` Queue | Lower-concurrency visual and video rendering | Separate from verification so uploads cannot starve rendering. |
| `SS_MEDIA` Container binding | Heavy transforms, safe decoders, FFmpeg, and rendering | No direct PlanetScale or social-provider credentials. |
| `SS_DB` Hyperdrive binding | Pooled, encrypted Worker access to PlanetScale Postgres | Least-privilege database user; no schema migration role. |

R2 buckets use notifications on the staging prefix only. A media processor
writing to `derived/` must not create another media event. R2 source data is
kept private, and external download access is issued only after the application
has checked tenancy and artifact state.

## Data model and contracts

RFC 002 and RFC 006 remain the source for tenants, release inputs, assets,
artifacts, audit logs, and the transactional outbox. This RFC adds the smallest
state required to make Cloudflare execution observable and idempotent.

### Asset additions

Add the following nullable or state-specific fields to `Asset`:

- `uploadSessionId`: server-created session identifier for a browser upload.
- `r2Version`: the R2 object version or ETag that was verified.
- `verificationState`: `PENDING`, `VERIFYING`, `READY`, `QUARANTINED`, or
  `FAILED`.
- `quarantineObjectKey`: set only when validation moved an object to quarantine.
- `verifiedAt`: the time the application accepted the exact object version.

An asset is never `READY` because a browser completed an upload. It becomes
`READY` only after the R2 event consumer confirms the expected object and its
metadata.

### Media execution

Add one explicit `MediaExecution` record. It is a media-only execution ledger,
not a second workflow engine or generic job table.

| Field | Purpose |
| --- | --- |
| `id`, `tenantId`, `assetId`, `artifactId` | Tenant-scoped media ownership; exactly one target is required. |
| `operation` | `VERIFY`, `THUMBNAIL`, `RENDER_IMAGE`, `RENDER_VIDEO`, or `DELETE`. |
| `inputSnapshotHash` | Binds the execution to a precise approved input version. |
| `outputObjectKey` | Predetermined immutable R2 key for duplicate-safe output. |
| `state`, `attempts`, `failureCode` | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, or `CANCELLED` with a safe reason. |
| `containerInstanceId`, `startedAt`, `completedAt` | Operational evidence without storing a task payload blob. |

Keep the existing `triggerRunId` fields. A Trigger run starts or resumes the
business workflow, while `MediaExecution` records the Cloudflare media step
inside that workflow.

### Event envelope

Every outbox or queue message has `eventId`, `tenantId`, `aggregateType`,
`aggregateId`, `eventType`, `occurredAt`, `idempotencyKey`, and a small versioned
payload. Messages contain no binary content, signed URL, provider token,
browser credential, or tenant-controlled R2 key. Consumers persist the event
or claim before they perform side effects.

## Processing flows

### Release sources, changelogs, and signed webhooks

1. The Next.js API verifies the tenant, API key or session, and webhook
   signature.
2. It writes `SourceMaterial`, the business aggregate, `AuditLog`, and an
   `OutboxEvent` in one PlanetScale transaction.
3. The existing `dispatch.outbox` Trigger task sends the stable event to the
   appropriate Trigger workflow.
4. Trigger.dev normalizes the release and decides whether it needs media work.

This preserves RFC 004's retry and audit contract. Cloudflare does not decide
that a release should generate or publish content.

### Browser and remote uploads

1. The application creates an `Asset` in `PENDING` state and an upload session
   with a fixed staging object key. The caller cannot choose the tenant prefix
   or final object key.
2. The pipeline gateway validates membership, API-key scope, quota, content
   type, expected size, and multipart part limits before it creates or completes
   R2 multipart operations.
3. R2 emits an object-create notification for the staging prefix to
   `ss-<env>-r2-events`.
4. The pipeline Worker confirms the upload session and object version, changes
   the asset to `VERIFYING`, and writes `asset.object-created` to the outbox in
   one database transaction.
5. Trigger.dev receives the outbox event and starts `process.asset`. The
   browser completion response is advisory, never proof of asset readiness.

### Steel Browser captures

`capture.release` remains a Trigger.dev task. It requests a Steel capture, then
sends the output through the same controlled R2 staging path. No separate
capture-only artifact model is permitted. This makes manual uploads, API
uploads, and automated captures follow one verification and lineage path.

### Heavy media work

1. `process.asset` in Trigger.dev rechecks the asset state, tenant quota, and
   cancellation before it creates or claims a `MediaExecution`.
2. The task asks the pipeline Worker to enqueue the execution ID and returns.
   It does not wait for a queue consumer or Container process.
3. The Worker atomically claims the execution and starts the appropriate
   Container. The Container reads the approved R2 object through the bound
   service, checks magic bytes and decode limits, and writes only its
   predetermined derived key.
4. The Container calls the internal result endpoint with the execution ID,
   output key, content type, checksum, dimensions or duration, and safe error
   code. It never calls PlanetScale directly.
5. The result Worker verifies the derived object with R2, atomically updates
   `Asset` or `Artifact`, writes `AuditLog` and `OutboxEvent`, and completes the
   execution.
6. Trigger.dev receives the outbox event and starts the next business task, such
   as `plan.artifact-pack` or `draft.content-artifact`.

The output key and execution claim make duplicate R2 notifications, Queue
delivery, Container callbacks, and Trigger retries safe. A scheduled
reconciler repairs executions where a Container wrote its object but failed
before its callback.

## Trigger.dev and Cloudflare responsibility matrix

| Operation | Owner | Reason |
| --- | --- | --- |
| Normalize a release source | Trigger.dev | It is a business workflow step that may wait or retry. |
| Plan an artifact pack and draft copy | Trigger.dev | It coordinates brand rules, approvals, and user-visible status. |
| Capture an authenticated product flow | Trigger.dev + Steel | It needs workflow retries and a protected browser session. |
| Verify an uploaded object | Cloudflare Worker + Container when required | It is close to R2 and may need untrusted-media isolation. |
| Resize, inspect, render image, or transcode video | Cloudflare Container | It needs compute, media tools, and strict resource limits. |
| Persist media result and emit continuation event | Cloudflare Worker | It validates R2 output and writes the transactional outbox. |
| Schedule or publish a social post | Trigger.dev | It needs durable waits, provider-aware retry, and cancellation. |
| Reconcile a connected provider | Trigger.dev | It owns the provider integration lifecycle. |

In particular, `publish.scheduled-post`, `deliver.customer-communication`, and
`reconcile.provider` remain Trigger.dev tasks. Cloudflare Queues must never be
used as a post scheduler.

## Queue, retry, and recovery policy

Cloudflare Queues deliver at least once. Every consumer must therefore claim a
stable database record before it acts. The initial configuration is deliberately
small and is tuned from production measurements:

| Queue | Initial concurrency | Retry policy | Dead-letter action |
| --- | --- | --- | --- |
| R2 events | 10 consumers, batch 10 | 3 retries for transient R2 or database errors | Record `asset.event-dead-lettered`; alert operations. |
| Media | 4 consumers, batch 1 | 5 retries with bounded backoff | Mark the execution failed and require a user or operator retry. |
| Render | 2 consumers, batch 1 | 3 retries; low tenant concurrency | Mark the artifact attempt failed without blocking a release. |

Permanent validation failures are acknowledged after the worker moves the
object to quarantine and writes an audit event. Only transient failures retry.
Each queue has a Cloudflare dead-letter queue. An application reconciler reads
the dead-letter record, links it to the asset or execution, and starts a new
Trigger workflow only after an operator or safe automatic rule approves it.

Tenant fairness is enforced at the `MediaExecution` claim using tenant quota
and per-tenant active-execution limits in PlanetScale. Do not add Durable
Objects for rate limiting in the first version. Add them only if the database
claim becomes a measured contention point.

## Security and tenancy

- R2 buckets are private. Object keys are server-generated and include the
  tenant identifier, aggregate ID, and immutable version.
- Browser and API uploads use short-lived, single-asset upload sessions. The
  application checks tenant membership, API-key scope, byte quota, content
  type, size, and multipart bounds before R2 access.
- R2 event messages are treated as untrusted notifications. The Worker confirms
  the expected bucket, key, upload session, object version, and tenant-owned
  record before it changes state.
- Media Containers validate magic bytes, decode limits, frame and pixel limits,
  and duration limits. They have no social-provider credential, browser
  credential, public R2 list permission, or PlanetScale database credential.
- Webhooks continue to require the source signature and replay protection from
  RFC 005. Internal Worker and Container calls use service authentication and
  a narrow per-environment secret.
- Hyperdrive uses a least-privilege PlanetScale database role. Only the pipeline
  Worker can write pipeline state. Schema migrations run outside Worker runtime.
- Queue messages, audit events, logs, and traces contain IDs and safe metadata,
  never asset bytes, signed URLs, secrets, or customer social content unless it
  is already an approved artifact reference.

## Scheduling and publishing

Trigger.dev continues to own the publishing calendar. A Trigger task performs
the final authorization and idempotency claim before it sends an approved,
verified artifact to Buffer, PostBridge, Postiz, or another provider. It may
request a time-limited asset stream from the application after checking the
tenant and artifact version.

Cloudflare can create the media required by a post, but it cannot make a post
scheduled or published. Cancellation, approval reversal, provider disconnect,
and brand-kit changes remain business events in PlanetScale and Trigger.dev.

## Operations, cost, and observability

Every request, outbox event, queue message, `MediaExecution`, R2 key, Container
invocation, artifact attempt, and Trigger run carries a correlation ID. Store
`triggerRunId` on the business record and the media-execution ID in Trigger
metadata. Log the Cloudflare queue message ID and Container instance ID as
operational metadata only.

Monitor these service-level indicators:

- R2 upload completion to verified asset latency.
- R2 notification age, queue depth, retry count, and dead-letter count.
- Media execution start latency, duration, failure rate, stale-running count,
  output size, and output verification failures.
- Transactional outbox age and Trigger task start latency.
- Artifact-ready to provider-published latency, provider error rate, and
  tenant quota rejections.

Cost attribution is tenant-scoped: record source and derived R2 byte size,
Container CPU and memory duration, Queue operations, and Trigger task usage on
the asset, execution, and artifact records. Apply a tenant byte, transform,
render-minute, and active-execution budget before enqueuing expensive work.
Trigger.dev cost remains separate from Cloudflare media cost.

## Rollout plan

1. Provision development R2 buckets, Queues, Workers, Hyperdrive, and a
   non-production Container. Verify private access, notification filtering,
   dead letters, and database permissions.
2. Add `MediaExecution`, upload-session fields, fixed object keys, and the
   authenticated result contract. Do not change Trigger task ownership.
3. Route manual image uploads through the staging and verification path. Make
   `process.asset` delegate verification or thumbnail work to Cloudflare.
4. Add the image rendering Container with output verification, idempotency,
   operational dashboards, and a reconciler.
5. Add video rendering only after the image path meets its SLO. Set explicit
   input, duration, memory, and runtime limits before exposure to tenants.
6. Route Steel captures and repository-release media through the same staging
   path. Keep Trigger.dev as the workflow coordinator and scheduler.

No Cloudflare Workflows, second scheduler, generic job framework, or provider
publishing move is part of this rollout.

## Acceptance criteria

- A business workflow is visible in Trigger.dev from its start through every
  continuation; Cloudflare does not own a release or publishing schedule.
- A completed browser upload cannot produce a ready artifact until the expected
  private R2 object is verified.
- Duplicate R2 notifications, Queue deliveries, Container callbacks, and
  Trigger retries do not create a second derived object or artifact.
- A Container cannot write PlanetScale directly or access provider credentials.
- A failed or unsafe upload is quarantined, audited, and unavailable to the
  editor, artifact generator, and social provider.
- A dead-lettered event becomes an observable asset or execution failure with a
  controlled recovery path.
- A tenant cannot access another tenant's source, derived media, upload session,
  queue work, or usage data.
- Scheduled posts continue after media processing is delegated to Cloudflare,
  and their cancellations and approval checks still occur in Trigger.dev.

## External implementation references

- [Cloudflare R2 event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)
- [Cloudflare R2 multipart upload guidance](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare Queues retries and batching](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Cloudflare Queues dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/get-started/)
- [PlanetScale Postgres with Cloudflare Workers](https://planetscale.com/docs/postgres/tutorials/planetscale-postgres-cloudflare-workers)
