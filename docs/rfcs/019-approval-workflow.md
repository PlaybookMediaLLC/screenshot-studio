# RFC 019: Campaign Approval Workflow

**Status:** Implemented (see `lib/tenant/campaign-status.ts`, `lib/tenant/campaigns.ts`, `lib/trpc/routers/campaign.ts`)
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 003, RFC 014, and RFC 018
**Owners:** Product, Engineering, and Security

## Decision

Make post states explicit and gate all publishing on human approval. AI never
publishes without approval in this phase.

Approval is a server-side state machine over `CampaignPost`. It is not a UI
convention, not a boolean flag, and not something a tool call can skip. The
same transition function serves the browser, the REST API, an API key, and any
future agent.

## Status of this document

This RFC is a backfill. The workflow shipped before the document described it
in full. Everything under "Shipped contract" records behavior that exists in
`main` today and must not be changed without a migration decision. Everything
under "Planned refinements" is proposed work that has not shipped.

Where the shipped behavior differs from the original sketch in this RFC, the
shipped behavior wins.

## Goals

- One authoritative transition table, enforced server-side, for every caller.
- Batch approval as the primary action, so a seven-post campaign is one click.
- A complete audit trail: who decided what, when, on which version.
- A hard guarantee that unapproved content cannot reach a provider.

## Non-goals

- Policy-based automatic approval. RFC 030 owns approval policies.
- Multi-stage or role-ordered approval chains, such as legal then marketing.
- Comment threads and inline review annotations.
- Approval of anything other than campaign posts and creative variants.

## Two approval objects

The platform has two distinct approval records, and conflating them is the most
common source of confusion:

| Object                       | Approves                          | Storage                                | Gate it enforces               |
| ---------------------------- | --------------------------------- | -------------------------------------- | ------------------------------ |
| `CampaignPost.status`        | The message: copy, channel, CTA   | Enum column on `campaign_post`         | Whether a post may be scheduled |
| `Approval` + `CreativeVariant.status` | The rendered asset       | `approval` row, unique per variant     | Whether a variant may publish   |

Both must be `APPROVED` before publication. `scheduleCampaignPost` checks the
post status. `createScheduledPost` independently re-checks the variant status
and its `Approval` row. The publication worker checks the variant a third time
immediately before calling the provider. The redundancy is intentional: an
asset approved at schedule time but archived before the scheduled instant must
not publish.

## State machine

### Campaign post states

```text
                    ┌──────────────────────────┐
                    │                          │
                    ▼                          │
   ┌───────┐   submit    ┌──────────────────┐  │ request_changes
   │ DRAFT ├────────────►│ READY_FOR_REVIEW ├──┘
   └───────┘             └────────┬─────────┘
       ▲                          │
       │                  ┌───────┼────────┐
       │                  │       │        │
       │             approve   reject  request_changes
       │                  │       │        │
       │                  ▼       ▼        ▼
       │           ┌──────────┐ ┌────────┐ ┌───────────────┐
       │           │ APPROVED │ │REJECTED│ │ NEEDS_CHANGES │
       │           └────┬─────┘ └────────┘ └───────┬───────┘
       │                │                         │
       │           schedule                    submit
       │                │                         │
       │                ▼                         │
       │         ┌───────────┐                    │
       └─ ─ ─ ─ ─┤ SCHEDULED │                    │
        (no path)└─────┬─────┘◄───────────────────┘
                       │              (via READY_FOR_REVIEW)
                  publish worker
                       │
                       ▼
                 ┌───────────┐
                 │ PUBLISHED │
                 └───────────┘
```

`REJECTED` and `PUBLISHED` are terminal. `SCHEDULED` is reversible only by
cancelling the underlying `ScheduledPost`, which is a publishing action, not an
approval action.

### Transition table

This table is the normative contract. It matches `campaignPostTransitions` in
`lib/tenant/campaign-status.ts` exactly.

| Decision          | From                      | To                 | Permission        | Actor kinds allowed      |
| ----------------- | ------------------------- | ------------------ | ----------------- | ------------------------ |
| `submit`          | `DRAFT`, `NEEDS_CHANGES`  | `READY_FOR_REVIEW` | `release:create`  | session only             |
| `approve`         | `READY_FOR_REVIEW`        | `APPROVED`         | `release:approve` | session only             |
| `reject`          | `READY_FOR_REVIEW`        | `REJECTED`         | `release:approve` | session only             |
| `request_changes` | `READY_FOR_REVIEW`        | `NEEDS_CHANGES`    | `release:approve` | session only             |

Any decision applied to a post outside its `from` set is rejected. There is no
force transition and no administrative override that skips a state.

Every decision is session-only today, including `submit`. `decideApproval` in
`lib/trpc/routers/campaign.ts` calls `requireActiveOrganizationPermission`,
which resolves through `requireActiveSessionOrganization` and therefore has no
API-key path at all. The permission still varies per decision, so a `creator`
can submit and cannot approve, but no actor kind other than a logged-in member
can drive the state machine.

For `approve`, `reject`, and `request_changes` this is a deliberate safety
property and should not change: approval is the human gate the whole platform
rests on. For `submit` it is an incidental consequence of sharing one procedure.
Machine submission is a reasonable future capability, since a generation job
that produces a draft and moves it to review is exactly what RFC 029 wants, and
it would need a separate procedure with an API-key path rather than a relaxation
of `decideApproval`. It is listed under planned refinements rather than
described here as though it already worked.

### Scheduling as a separate gate

`SCHEDULED` is not reachable through `transitionCampaignPosts`. It is set only
by `scheduleCampaignPost`, which requires all of:

1. the post exists in the caller's organization;
2. `post.status === 'APPROVED'`;
3. `post.creativeVariantId` is set;
4. `post.copy.length <= 3000`;
5. the target `ChannelConnection` is `ACTIVE` and owned by the organization;
6. the linked `CreativeVariant` is `APPROVED` with an `APPROVED` `Approval` row.

Separating approval from scheduling means an approver can approve without
holding publishing rights, and a publisher can schedule without holding
approval rights. The `approver` and `publisher` roles in
`lib/auth/permissions.ts` exist for exactly this split.

## Authorization

Approval decisions require `release:approve`. In the shipped role matrix that
is `owner`, `admin`, and `approver`. Submission requires `release:create`,
which is `owner`, `admin`, and `creator`. Scheduling requires `publish:manage`,
which is `owner`, `admin`, and `publisher`.

Three rules constrain who may decide:

1. **Machines may not approve.** An API key can create and submit content. It
   cannot approve it. The approval decision resolves the deciding user from the
   session principal; a principal without a user identity is refused. This is
   the mechanism that makes "AI never publishes without approval" structural
   rather than aspirational.
2. **Tenant isolation is enforced by query, not by input.** Every read and
   write filters on `organizationId` resolved from the principal. A supplied
   campaign ID selects an already authorized record; it never grants access.
   An unknown or foreign campaign returns `404`, never `403`, so campaign IDs
   are not enumerable across tenants.
3. **Self-approval is permitted by default.** A solo founder is the creator and
   the approver. Workspaces that need separation of duties configure it through
   RFC 030 policy, not through a hard-coded rule here.

## Batch semantics

Batch approval is the primary call, not an optimization. The contract:

- `postIds` omitted means "every post in this campaign eligible for this
  decision". This is the "Approve all 7 posts" button.
- `postIds` supplied means "exactly these posts". If any supplied post is not
  eligible, the entire call fails with `409` and nothing changes.
- Zero eligible posts fails with `409` rather than succeeding silently, so a
  double-clicked approve button reports a clear conflict instead of implying a
  second approval happened.
- The whole batch runs in one database transaction, so a batch is atomic.
- One audit entry records the batch with its decision and post count. The
  individual post IDs are returned to the caller.

The explicit-list mode is what makes "approve three and reject one" work: the
UI sends two calls, each atomic, each individually audited.

## Concurrency

The transition uses a single transaction with a status-filtered read followed
by a status-filtered `updateMany`. Two approvers acting simultaneously produce
one winner and one `409`, because the loser's rows no longer match the `from`
filter. No row-level lock is held across a user think-time window.

Optimistic concurrency on post content is a planned refinement, described
below. Today, editing a post's copy does not invalidate its approval. That is a
real gap and the highest-value item in the planned list.

## Audit events

Every transition writes to the tenant audit log inside the same transaction, so
a state change and its audit record commit or roll back together.

| Action                                   | Entity          | Metadata                          |
| ---------------------------------------- | --------------- | --------------------------------- |
| `product.campaign_created`               | `campaign`      | `angleCount`, `postCount`         |
| `product.campaign_post_status_changed`   | `campaign`      | `decision`, `postCount`           |
| `product.campaign_post_scheduled`        | `campaign_post` | `campaignId`, `scheduledPostId`   |
| `post.scheduled`                         | `scheduled_post`| connection and variant references |
| `post.cancelled`                         | `scheduled_post`| cancelling actor                  |
| `post.published`                         | `scheduled_post`| provider post ID                  |
| `post.publish_recovery_required`         | `scheduled_post`| `failureCode`                     |

Audit entries carry the actor, the request ID, and the outcome. They inherit
the retention policies and signed SIEM drains from RFC 003 without additional
work.

## Agent interaction

An agent run reaches approval and stops. It does not poll and it does not hold
a connection open. The durable-run pattern is:

1. The agent calls `requestApproval`, which submits posts to
   `READY_FOR_REVIEW` and records the run ID.
2. The Trigger.dev run creates a wait token and suspends. No compute is billed
   while it waits.
3. A human decides through the workspace UI or the REST API.
4. The decision completes the token and the run resumes with the outcome.
5. On `NEEDS_CHANGES`, the run reads the reviewer note and regenerates. On
   `REJECTED`, the run ends.

The wait has a bounded lifetime. A pending approval that is never decided
expires after 14 days; the run ends and the posts stay in `READY_FOR_REVIEW`
for manual handling. Expiry never auto-approves.

## Failure and recovery

| Situation                                       | Behavior                                                        |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Approver loses permission mid-review            | The decision call fails at authorization; no partial write       |
| Campaign deleted during review                  | `404`; cascade removes posts and their pending decisions         |
| Variant archived after post approval            | Scheduling fails `409`; publication worker cancels the post      |
| Connection revoked after scheduling             | Publication worker cancels the post and audits the cancellation  |
| Duplicate approve request                       | Second call returns `409`, not a second approval                 |
| Approval succeeds but scheduling fails          | Post stays `APPROVED`; the caller retries scheduling             |
| Worker crashes mid-publication                  | Stale `PROCESSING` posts are requeued or failed after 10 minutes |

The publication worker is deliberately suspicious of its own inputs. It claims
a post with a conditional `updateMany`, so exactly one worker owns a post. It
re-verifies eligibility after claiming. A claimed post whose variant is no
longer approved is `CANCELLED`, not published.

## Security threats

| Threat                                             | Mitigation                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Agent or API key self-approves generated content   | Approval requires a session principal with a user identity       |
| Cross-tenant approval by ID guessing               | Organization-filtered queries; unknown IDs return `404`          |
| Approved copy swapped for different copy           | Planned: content hash pinned at approval, verified at publish    |
| Approved variant swapped for a different asset     | Variant is referenced by ID and re-verified at publish time      |
| Replayed approval request                          | Status-filtered transitions make replay a no-op `409`            |
| Audit gap hiding an unauthorized approval          | Audit write shares the transaction with the state change         |

## Observability

Emit per workspace:

- count of posts in each state, sampled hourly;
- time from `READY_FOR_REVIEW` to a decision, at p50 and p95;
- approval rate, change-request rate, and rejection rate;
- count of posts sitting in `READY_FOR_REVIEW` for more than 72 hours;
- count of batch approvals and their average batch size.

Batch size is the product health metric. A workspace approving posts one at a
time is a workspace where batch approval failed to earn trust.

## Acceptance criteria

1. A campaign moves `DRAFT` to `READY_FOR_REVIEW` to `APPROVED` to `SCHEDULED`
   with one batch approval, and every transition appears in the audit log.
2. Approving 7 posts writes exactly one audit entry with `postCount: 7`.
3. A batch containing one ineligible post changes nothing and returns `409`.
4. An API-key principal receives an authorization failure on `approve`.
5. A `viewer` receives an authorization failure on every decision.
6. A campaign ID from another organization returns `404` for every decision.
7. Two simultaneous approvals of the same post produce one success and one
   `409`.
8. Scheduling a post whose variant lacks an `APPROVED` `Approval` row fails
   with `409`.
9. A variant archived between scheduling and the scheduled instant results in
   a `CANCELLED` scheduled post and an audit entry, not a publication.
10. `request_changes` returns a post to `NEEDS_CHANGES`, and `submit` returns
    it to `READY_FOR_REVIEW`.

## Planned refinements

These are not shipped. Each needs its own change with a migration.

1. **Version invalidation.** Store a content hash on `CampaignPost` covering
   `copy`, `callToAction`, `channel`, and `creativeVariantId`. Record the hash
   on approval. Editing an approved post returns it to `DRAFT` and clears the
   approval. Verify the hash again before handing off to the provider. Without
   this, an editor with `artifact:edit` can change approved copy after
   approval, and the audit log shows an approval of content that no longer
   exists. This is the most important open gap.
2. **Reviewer notes.** `CampaignPost` has no reason field. `request_changes`
   and `reject` should persist a note so the agent and the author know what to
   fix. `Approval.reason` already exists for variants; posts need the same.
3. **Decision attribution on the row.** Add `decidedByUserId` and `decidedAt`
   to `CampaignPost`. Today attribution is recoverable only from the audit log,
   which makes "who approved this" a log query rather than a field read.
4. **Notifications.** Submission should notify approvers, and a decision should
   notify the author. Today review is discovered by visiting the workspace.
5. **Publishing lock.** A short advisory lock spanning approval and scheduling
   would close the narrow window where a variant is archived between the two
   calls. The publication worker's re-check already prevents a bad publish, so
   this is a UX improvement rather than a safety fix.
6. **Per-channel caption limits.** The 3,000 character limit is global. X,
   LinkedIn, and Instagram have different real limits and the check should be
   channel-aware, sourced from the provider capability table in RFC 020.
7. **Machine submission.** `submit` shares `decideApproval` with the three
   review decisions, so it inherits a session-only path and no automated
   producer can move a draft to review. RFC 029's recurring generation needs
   this. The fix is a separate procedure carrying `release:create` with an
   API-key path, not a relaxation of `decideApproval`, so that `approve`,
   `reject`, and `request_changes` remain provably reachable only by a human.

## Out of scope

- Policy-based automatic approval. RFC 030 covers approval policies.
- Autonomy modes. RFC 031 builds on this machine and RFC 030's policies.
