# RFC 020: Postiz Publishing Abstraction

**Status:** Implemented (see `lib/tenant/postiz.ts`, `lib/tenant/publishing.ts`, `lib/tenant/scheduled-posts.ts`)
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 005 and RFC 019
**Owners:** Engineering

## Decision

Keep Postiz as the social infrastructure. Do not build direct Twitter,
LinkedIn, or Instagram integrations. Hide Postiz behind one application-owned
abstraction so it stays replaceable.

The application owns scheduling, state, idempotency, retries, and recovery.
The provider owns only the final network call. If Postiz disappeared, the
`ScheduledPost` lifecycle would be unchanged and a replacement adapter would
implement one function.

## Status of this document

This RFC is a backfill. The scheduling and publication path shipped before the
document described it in full. The "Shipped contract" sections record behavior
in `main` today. "Planned refinements" records proposed work that has not
shipped, including OAuth account connection, which the original version of this
RFC described as if it existed.

## Goals

- One provider seam, narrow enough to re-implement in a day.
- Exactly-once publication in practice, with no silent duplicate posts.
- Durable scheduling that survives worker crashes and deploys.
- A stored receipt linking every published post to its provider post ID.

## Non-goals

- Direct social-network API integration of any kind.
- Cross-posting fan-out from one call to many networks.
- Analytics ingestion. RFC 027 covers performance.
- Provider-specific composer features such as threads, polls, or carousels
  beyond a single image.

## Layers

```text
Campaign post (approved)
        │
        ▼
scheduleCampaignPost            application scheduling decision
        │
        ▼
ScheduledPost row               durable state, idempotency key, timing
        │
        ▼
publishDueScheduledPosts        claim, verify, attempt, record
        │
        ▼
publishPostizPost               the only provider-aware function
        │
        ▼
Postiz HTTP API                 upload media, create post
        │
        ▼
X / LinkedIn / Instagram
```

Only the bottom two layers know Postiz exists. `lib/tenant/postiz.ts` is the
entire provider surface: 130 lines, two schemas, one exported publish function,
one exported credential-reference validator.

## Provider contract

A scheduler provider implements one operation:

```ts
publish(input: {
  organizationId: string
  destinationId: string      // provider integration ID
  platform: string           // 'x' | 'linkedin' | 'instagram' | ...
  caption: string
  asset: { objectKey: string; mediaType: string }
  providerSettings: unknown  // opaque, provider-validated
  secretReference: string    // env var name, never a secret value
}): Promise<string>          // provider post ID
```

Failures raise a typed provider error carrying an HTTP status or `null` for
transport failures. The caller classifies retryability from that status. A
provider adapter must not retry internally, must not write to the database, and
must not log the credential or the caption.

Adding Buffer or Post Bridge means writing this one function plus a capability
row. It does not mean touching the state machine.

## Provider capabilities

Capability limits are a per-platform table, resolved before a post is
scheduled rather than discovered at publish time.

| Platform  | Caption limit | Media                    | Notes                            |
| --------- | ------------- | ------------------------ | -------------------------------- |
| X         | 280           | 1 image                  | Long-form needs a paid tier      |
| LinkedIn  | 3,000         | 1 image                  | First 140 characters are visible |
| Instagram | 2,200         | 1 image, requires media  | Caption-only posts are invalid   |

The shipped implementation enforces a single global 3,000-character limit in
`scheduleCampaignPost`. That is permissive for X and strict for nothing. The
planned refinement replaces it with this table. Until then, an over-length X
caption fails at the provider rather than at scheduling, which is a worse
error location but not a correctness failure.

## Credential handling

The shipped model is deliberately conservative. `ChannelConnection.secretReference`
stores an environment variable **name**, not a secret. The name must match
`^POSTIZ_(?:API_KEY|OAUTH_TOKEN)(?:_[A-Z0-9_]+)?$`. The publish path reads
`process.env[secretReference]` at call time.

This gives three properties:

1. No provider credential is ever written to PlanetScale.
2. A database dump contains no usable publishing capability.
3. The regex prevents a tenant-supplied reference from reading an arbitrary
   environment variable such as `DATABASE_URL`. This is the important guard: the
   reference is tenant-influenced input used as an environment lookup key, and
   without the pattern check it would be an environment-variable disclosure
   primitive.

The cost is that connections are operator-provisioned rather than
self-service. Multi-tenant OAuth is the planned refinement below.

## Scheduling contract

`createScheduledPost` requires an idempotency key and enforces uniqueness on
`(channelConnectionId, idempotencyKey)`. The flow:

1. Look for an existing post with the same key. If found, return it with
   `created: false`. The call is safely repeatable.
2. Verify the connection is `ACTIVE`, `postiz`, and organization-owned.
3. Verify the variant is `APPROVED` with an `APPROVED` `Approval` row.
4. Insert the row as `SCHEDULED` and write `post.scheduled` to the audit log in
   the same transaction.
5. If a concurrent insert wins the unique constraint, catch `P2002`, re-read,
   and return the winner. The race resolves to one row, never to an error.

`scheduleCampaignPost` supplies a fresh UUID per call. REST callers may supply
their own key through the `Idempotency-Key` header. The default publish time
comes from `WorkspaceSettings.defaultPublishTime` in the workspace time zone
when no explicit time is given.

## Publication lifecycle

```text
SCHEDULED ──claim──► PROCESSING ──success──► PUBLISHED
                          │
                          ├──retryable (429, attempts < 3)──► SCHEDULED
                          │
                          ├──permanent failure──► FAILED
                          │
                          └──ineligible at publish time──► CANCELLED

SCHEDULED ──user cancel──► CANCELLED
```

### Claiming

```ts
updateMany({
  where: { id, status: 'SCHEDULED', scheduledFor: { lte: now } },
  data: { status: 'PROCESSING' },
})
```

A claim succeeds when exactly one row is updated. This is a conditional
compare-and-set, so two workers processing the same due post produce one owner
and one no-op. No distributed lock service is required.

### Re-verification after claiming

After claiming, the worker re-loads the post with its connection and variant
and re-checks eligibility:

- `channelConnection.status === 'ACTIVE'`
- `variant.status === 'APPROVED'`
- `variant.approval.status === 'APPROVED'`
- the workspace is operational, meaning not suspended or pending deletion

Failing any check cancels the post and writes `post.cancelled`. Approval can be
revoked and a connection can be disabled between scheduling and the scheduled
instant, and the system must honor the newer decision. Nothing publishes on the
strength of a check performed hours earlier.

### Attempts

Each provider call creates a `PublicationAttempt` row before the call and
completes it after. The attempt is the durability record: a row with
`completedAt = null` means the outcome of a network call is unknown.

Retry policy is narrow by design:

- Retry only `429` responses, and only up to 3 attempts.
- Every other failure, including timeouts and `5xx`, is terminal for that post.

The reason is that a social post is not idempotent at the provider. Postiz's
create-post endpoint accepts no idempotency key, so a retried request after an
ambiguous failure can produce a duplicate public post. A duplicate post is
worse for a founder than a failed post, because the failure is recoverable and
the duplicate is embarrassing. The policy deliberately biases toward
under-delivery. A `429` is safe to retry because it is a definitive refusal:
the provider states that it did nothing.

### Stale recovery

A sweep runs before each processing batch and handles workers that died while
holding a claim, using a 10-minute threshold:

| Condition                                          | Interpretation                     | Action                                    |
| -------------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `PROCESSING`, stale, **no** open attempt            | Died before calling the provider   | Return to `SCHEDULED` for a clean retry   |
| `PROCESSING`, stale, **has** an open attempt        | Died with an in-flight call        | Mark `FAILED` with `UNKNOWN_DELIVERY`     |

The second case is the ambiguous one and it fails closed. The attempt row is
completed as `FAILED`, the post is `FAILED`, and
`post.publish_recovery_required` is audited so an operator can check the
account and decide. The system never guesses that an in-flight call did not
land.

### Cancellation

`cancelScheduledPost` succeeds from `DRAFT`, `SCHEDULED`, and `FAILED`. It
returns `409` from `PROCESSING` and `PUBLISHED`, because the provider call may
already be in flight or complete. Cancelling an already-`CANCELLED` post
returns the post unchanged rather than erroring, so a repeated cancel is safe.

There is no unpublish. Removing a published post is done in the social network,
not here.

## Media handling

The worker reads the asset from the private R2 bucket using the tenant-scoped
object key, uploads it to Postiz as multipart form data, and references the
returned upload in the post payload. The asset bytes never pass through a
public URL, and the provider never receives a signed link into the bucket.

`providerSettings` is stored per connection as opaque JSON, validated as a
string-keyed JSON record, and merged with `__type: platform` at publish time.
Platform-specific requirements live in that blob so the state machine stays
platform-agnostic.

## Receipts and lineage

A successful publish stores `providerPostId` on the attempt, sets the post to
`PUBLISHED`, and audits `post.published`. The full chain is queryable:

```text
Release → Asset → CreativeVariant → Approval
                        │
                        ▼
                  CampaignPost → ScheduledPost → PublicationAttempt
                                                         │
                                                  providerPostId
```

RFC 027 joins performance data onto `providerPostId`. Lineage is a set of
foreign keys, so attribution is a join rather than an inference.

## Failure matrix

| Failure                            | Detection                    | Behavior                              |
| ---------------------------------- | ---------------------------- | ------------------------------------- |
| Postiz unreachable                 | fetch throws, 15s timeout    | Attempt fails, post `FAILED`          |
| Postiz `429`                       | status check                 | Requeue, up to 3 attempts             |
| Postiz `4xx` other                 | status check                 | Post `FAILED`, no retry               |
| Postiz `5xx`                       | status check                 | Post `FAILED`, no retry               |
| Malformed provider response        | Zod parse failure            | Post `FAILED`                         |
| Missing credential env var         | lookup returns undefined     | Post `FAILED` before any network call |
| Invalid secret reference pattern   | regex check                  | Post `FAILED` before any lookup       |
| Asset missing from R2              | storage read throws          | Post `FAILED`                         |
| Connection revoked before publish  | eligibility re-check         | Post `CANCELLED`                      |
| Approval revoked before publish    | eligibility re-check         | Post `CANCELLED`                      |
| Workspace suspended                | operational check            | Post `CANCELLED`                      |
| Worker crash before provider call  | stale sweep, no open attempt | Requeued to `SCHEDULED`               |
| Worker crash during provider call  | stale sweep, open attempt    | `FAILED` with `UNKNOWN_DELIVERY`      |

## Security threats

| Threat                                        | Mitigation                                              |
| --------------------------------------------- | ------------------------------------------------------- |
| Arbitrary environment variable disclosure     | Strict regex on `secretReference`                       |
| Credential leakage through logs               | Errors carry status codes only, never bodies or tokens  |
| Cross-tenant publication                      | Connection and variant queries filter `organizationId`  |
| Publishing unapproved content                 | Eligibility re-checked immediately before the call      |
| Duplicate public posts                        | Claim CAS, unique idempotency key, no ambiguous retries |
| Publication from a suspended workspace        | Operational check inside the worker                     |
| Provider response injection into stored state | Zod parses the response before persistence              |

## Observability

Per workspace and per platform:

- posts by status, and the age of the oldest `SCHEDULED` post past its time;
- publication success rate and attempt count distribution;
- provider latency at p50 and p95, and timeout count;
- `UNKNOWN_DELIVERY` count, which should be near zero and alerts when not;
- count of posts cancelled by eligibility re-check, split by reason.

Scheduling lag, meaning `publishedAt - scheduledFor`, is the user-visible
quality metric. A founder who scheduled 9:00 and published at 9:40 experienced
a broken product even though every state transition was correct.

## Acceptance criteria

1. An approved post schedules, publishes at its scheduled time, and stores a
   `providerPostId`.
2. Cancelling before publish prevents the publication and audits the cancel.
3. Cancelling a `PROCESSING` post returns `409`.
4. Two identical schedule calls with the same idempotency key create one row.
5. Two workers claiming the same due post produce one publication.
6. A `429` requeues and succeeds on a later attempt; a fourth `429` fails the
   post.
7. A `500` fails the post without a retry.
8. A revoked connection cancels the post instead of publishing it.
9. A variant whose approval is revoked after scheduling is cancelled.
10. A `secretReference` of `DATABASE_URL` is rejected before any lookup.
11. A worker killed mid-call leaves the post `FAILED` with `UNKNOWN_DELIVERY`
    and an audit entry.
12. No log line, error message, or audit entry contains a provider token.

## Planned refinements

1. **Postiz OAuth connection.** Replace operator-provisioned env-var references
   with the Postiz OAuth 2.0 flow. Users connect once; the platform stores an
   encrypted refresh token in a secrets manager and keeps `secretReference` as
   an indirection. This changes credential storage, not the state machine. Until
   it ships, self-service publishing is blocked and this is the single largest
   gap in the RFC 021 chargeable milestone.
2. **Per-platform capability enforcement.** Move the caption limit and media
   requirements into the capability table above and validate at schedule time.
3. **Future-dated provider scheduling.** The adapter currently sends
   `type: 'now'` with the current timestamp, so our worker owns timing entirely.
   Handing `scheduledFor` to Postiz would reduce lag but move timing authority
   to the provider and complicate cancellation. Keep worker-owned timing unless
   measured lag justifies the change.
4. **Reconciliation sweep.** A periodic job that lists recent provider posts and
   reconciles them against `PublicationAttempt` rows would resolve
   `UNKNOWN_DELIVERY` automatically instead of leaving it for an operator.
5. **Connection health checks.** Probe connections on a schedule and mark them
   `DISABLED` before a scheduled post discovers the failure.
6. **Threads and multi-image posts.** Requires a payload model richer than one
   caption plus one image.

## Out of scope

- Performance ingestion. RFC 027 covers analytics.
- Any direct social-network API integration.
