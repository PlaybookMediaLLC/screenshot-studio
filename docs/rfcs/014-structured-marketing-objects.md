# RFC 014: Structured Marketing Objects

**Status:** Partially implemented (`Campaign`, `ContentAngle`, `CampaignPost` exist; `Creative` linkage, `Performance`, and versioning do not)
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 011 through RFC 013
**Owners:** Engineering

## Decision

Model campaigns as first-class database objects before any agent exists. Chat
manipulates structured objects. We do not store campaigns as
`conversation.messages[]`. That is a trap.

The database is the source of truth for a campaign. A conversation is an input
method, replaceable by a form, an API call, or a scheduled job without changing
what a campaign is.

## Context

`Campaign`, `ContentAngle`, and `CampaignPost` ship today with tenant scoping,
a status enum, and audit coverage. `CampaignPost` links optionally to a
`CreativeVariant` and to a `ScheduledPost`. The object graph exists.

What is missing: campaign-level lifecycle rules, content versioning, the
generation-provenance fields that make regeneration auditable, and the
performance attachment point that RFC 027 needs.

## Data model

The system understands these concepts natively:

```text
Campaign
├── objective                    launch | feature | visibility | custom
├── audience
├── feature
├── messaging
├── status
├── source                       manual | recipe | agent | recurring
├── contentAngles[]
├── posts[]
└── performance (RFC 027)

ContentAngle
├── title
├── hook
├── position
└── rationale                    why this angle, for the founder

CampaignPost
├── channel
├── copy
├── callToAction
├── creativeVariantId
├── status
├── scheduledAt
├── scheduledPostId
├── contentHash                  pinned at approval
├── pillar                       RFC 025
└── generation provenance
```

All objects are workspace-scoped and covered by the existing RBAC and audit
infrastructure (RFC 003).

### Generation provenance

Every generated object records how it was produced:

```ts
GenerationProvenance {
  source            // manual | recipe | agent | recurring
  recipeId?
  recipeVersion?
  agentRunId?
  model?            // provider and model identifier
  promptVersion?
  inputRefs         // profile, brand, ICP, surface, performance versions used
  generatedAt
  editedByUserAt    // non-null once a human touched it
}
```

This answers three questions that will otherwise be unanswerable. Which model
wrote the post that performed well. Whether a founder edited it before
publishing, which decides whether performance credits the generator or the
human. Which inputs produced it, so a regeneration can reproduce or
deliberately vary them.

`editedByUserAt` also drives the RFC 028 feedback loop: heavily edited
generations are the strongest available signal that generation quality is poor,
and they are available long before any performance data.

## Campaign lifecycle

```text
DRAFT ──submit──► READY_FOR_REVIEW ──approve──► APPROVED ──► ARCHIVED
  ▲                      │
  └──── request_changes ─┘
```

The campaign status is derived, not independently editable. It is a rollup:

| Campaign status    | Condition                                          |
| ------------------ | -------------------------------------------------- |
| `DRAFT`            | Any post is `DRAFT` or `NEEDS_CHANGES`             |
| `READY_FOR_REVIEW` | Every post is at least `READY_FOR_REVIEW`, some undecided |
| `APPROVED`         | Every non-rejected post is `APPROVED` or beyond    |
| `ARCHIVED`         | Explicitly archived                                |

Deriving the rollup prevents the classic bug where a campaign says "approved"
while containing a draft post. Post status from RFC 019 is the only writable
approval state.

A campaign with every post rejected stays `DRAFT`, not `APPROVED`. Rejection is
not completion.

## Relationships and integrity

| Relationship                  | On delete    | Rationale                                  |
| ----------------------------- | ------------ | ------------------------------------------ |
| `Campaign` → `ContentAngle`   | Cascade      | Angles have no life outside their campaign |
| `Campaign` → `CampaignPost`   | Cascade      | Same                                       |
| `ContentAngle` → `CampaignPost` | Set null   | Deleting an angle orphans, not deletes     |
| `CampaignPost` → `CreativeVariant` | Restrict | A published creative cannot vanish        |
| `CampaignPost` → `ScheduledPost` | Set null   | Scheduling is a separate lifecycle         |

Deleting a campaign with published posts is refused. Published content has a
public record and a performance history; archiving is the correct action.
`ARCHIVED` hides a campaign from default lists and blocks new transitions
without erasing history.

## Versioning

Post copy is versioned so regeneration is non-destructive:

```ts
CampaignPostRevision {
  id
  postId
  revision            // monotonic
  copy
  callToAction
  creativeVariantId
  provenance
  createdAt
  createdBy
}
```

A regeneration creates a revision rather than overwriting. The post points at
its current revision. This gives three things a founder will want: undo, a
side-by-side comparison of two generated options, and an audit trail showing
exactly what was approved.

`contentHash` covers `copy`, `callToAction`, `channel`, and
`creativeVariantId`. It is pinned at approval and re-verified before scheduling
and before publishing. A post edited after approval fails the check and returns
to `DRAFT`. This closes the gap named in RFC 019's planned refinements and is
the reason versioning belongs in this RFC rather than later.

## Validation

Enforced at the domain service, so every caller is bound:

| Field                   | Rule                                                    |
| ----------------------- | ------------------------------------------------------- |
| `Campaign.name`         | 1–120 characters                                        |
| `Campaign.objective`    | Enum, or `custom` with a description                    |
| `ContentAngle.position` | Unique within the campaign, contiguous from 0           |
| `CampaignPost.channel`  | Must be a supported platform                            |
| `CampaignPost.copy`     | 1 to the channel's limit (RFC 020 capability table)     |
| `CampaignPost.copy`     | Must pass the prohibited-term filter (RFC 011)          |
| `CampaignPost.angleId`  | Must belong to the same campaign                        |
| `creativeVariantId`     | Must belong to the same workspace and be renderable     |
| Posts per campaign      | ≤ 50                                                     |
| Angles per campaign     | ≤ 10                                                     |

Angle positions are contiguous and are renumbered atomically on reorder, so a
drag-and-drop reorder cannot leave gaps or duplicates.

## Authorization

| Operation                     | Session permission | API-key scope     |
| ----------------------------- | ------------------ | ----------------- |
| List and read campaigns       | `workspace:read`   | `artifact:read`   |
| Create a campaign             | `release:create`   | `release:create`  |
| Edit post copy or angles      | `artifact:edit`    | `asset:write`     |
| Reorder or regenerate         | `artifact:edit`    | `asset:write`     |
| Submit for review             | `release:create`   | `release:create`  |
| Approve, reject, request changes | `release:approve` | not permitted    |
| Schedule                      | `publish:manage`   | not permitted     |
| Archive                       | `release:create`   | not permitted     |
| Delete an unpublished campaign | `release:create`  | not permitted     |

Every query filters `organizationId` resolved from the principal. Unknown or
foreign IDs return `404`.

## API contract

Campaign creation is a single atomic call that creates the campaign, its
angles, and its posts in one transaction, which is what a generator needs: a
partially-created campaign is worse than no campaign.

```ts
createCampaign({ name, objective, audience?, feature?, messaging?,
                 angles: [{ title, hook, rationale? }],
                 posts: [{ channel, copy, callToAction?, angleIndex?, pillar? }] })
```

Posts reference angles by index within the request, resolved to IDs server-side.
An out-of-range index fails the whole call with `400`. This exists today and is
the right shape.

Reads support cursor pagination and filtering by status, objective, source, and
date range. A campaign detail read returns angles ordered by position and posts
ordered by creation, with the current revision inlined.

Mutations accept an idempotency key. A generator retrying after a timeout must
not create a second campaign.

## Failure behavior

| Situation                                | Behavior                                        |
| ---------------------------------------- | ----------------------------------------------- |
| Partial creation failure                 | Whole transaction rolls back                    |
| Concurrent edits to one post             | Revision numbers serialize; both are retained   |
| Concurrent angle reorder                 | Last write wins on the full ordering, atomically |
| Creative variant deleted while referenced | Restricted; deletion fails                     |
| Copy exceeds the channel limit           | `400` naming the channel and its limit          |
| Regeneration fails mid-flight            | No revision is created; the post is unchanged   |

## Observability

- Campaigns created per workspace by source: manual, recipe, agent, recurring.
- Posts per campaign, and the share reaching `APPROVED`.
- Edit rate on generated copy, and edit distance distribution.
- Regeneration count per post before approval.
- Time from creation to full approval.

Edit distance on generated copy is the earliest available quality signal, and
it needs no analytics integration. A founder rewriting 70% of every generated
post is telling the system something long before any post is published.

## Acceptance criteria

1. A campaign with angles, creatives, and posts persists and round-trips
   through the tenant API with no LLM involvement.
2. Campaign status derives correctly from post statuses in every combination.
3. A post referencing an out-of-range angle index fails the whole creation.
4. Regenerating a post creates a revision and leaves the previous one readable.
5. Editing an approved post invalidates its approval and returns it to `DRAFT`.
6. `contentHash` mismatch blocks scheduling.
7. Deleting a campaign with published posts is refused.
8. Deleting an angle nulls its posts' references without deleting the posts.
9. Reordering angles leaves contiguous positions with no duplicates.
10. Copy exceeding a channel limit is rejected with the channel named.
11. Copy containing a prohibited term is rejected.
12. A repeated creation with the same idempotency key creates one campaign.
13. Every generated object records its model, prompt version, and inputs.
14. A campaign from another workspace returns `404`.

## Rollout

1. Add provenance fields and backfill existing rows as `manual`.
2. Add `CampaignPostRevision` and route edits through it.
3. Add `contentHash` and enable verification in report-only mode.
4. Promote hash verification to enforcing, which closes the RFC 019 gap.
5. Add the derived campaign-status rollup.
6. Add the RFC 027 performance attachment point when analytics ship.

## Out of scope

- Generation logic. RFC 015 adds the first recipe.
- Publication mechanics. RFC 020 connects Postiz.
- Cross-campaign calendar views. RFC 025 covers the calendar.
