# RFC 025: Content Pillars and the Weekly Calendar

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 018 and RFC 021
**Owners:** Product and Engineering

## Decision

Derive content pillars from product understanding. Turn campaigns from
isolated launches into a calendar. This moves the product from "market my
launch" toward "give me this week's marketing."

A pillar is a persisted, weighted object, not a prompt adjective. Weights are
data so that RFC 028 can adjust them from performance and so that a founder can
adjust them by hand.

## Design

Pillars derived per workspace:

```text
Product content
Founder content
Educational content
Problem content
Customer content
Industry content
Build-in-public content
```

Example weekly plan:

```text
MON  Educational insight
TUE  Product feature
WED  Founder POV
THU  Product workflow
FRI  Customer problem
```

## Goals

- Weeks that look varied rather than like seven product announcements.
- A calendar that reads across campaigns, not one campaign at a time.
- Pillar weights that are inspectable, editable, and later learnable.
- Every post traceable to the pillar that motivated it.

## Non-goals

- Performance-weighted planning. RFC 028 adds the feedback loop.
- Recurring automatic planning. RFC 029 covers the weekly cycle.
- Cross-workspace pillar benchmarks.
- Editorial calendar features such as briefs, assignments, and deadlines.

## Data model

```ts
ContentPillar {
  id
  workspaceId
  key                  // stable: product | founder | educational | problem
                       //         customer | industry | build_in_public | custom
  label                // editable display name
  description          // guidance passed to generation
  weight               // 0-100, relative share of a plan
  enabled
  minGapDays           // minimum days between posts in this pillar
  requiresProof        // customer and industry pillars need a source
  position
}

PillarAssignment {
  postId
  pillarId
  assignedBy           // recipe | agent | user
  confidence
}
```

Pillars seed from onboarding (RFC 012 and RFC 032). Product intelligence
determines which pillars make sense: a workspace with no customers yet gets
`customer` disabled and `build_in_public` weighted up. A workspace with a
detailed docs site gets `educational` weighted up.

Every pillar is editable. `key` is stable so weight learning survives a rename.

## Calendar

The calendar is a view over `CampaignPost.scheduledAt` and proposed dates
across all campaigns, rendered in the campaign workspace (RFC 018).

```text
/calendar?week=2026-W35
/calendar?month=2026-08
```

- Week view is the default and the planning unit.
- Posts render by day and time in the workspace time zone.
- Posts from different campaigns are visually distinguished, because a week
  legitimately mixes a launch with routine content.
- Drag to reschedule, subject to the state rules below.
- Pillar is shown per post, so imbalance is visible without a report.

### What can move

| Post status        | Draggable | Effect                                        |
| ------------------ | --------- | --------------------------------------------- |
| `DRAFT`            | yes       | Updates the proposed date only                |
| `READY_FOR_REVIEW` | yes       | Updates the proposed date only                |
| `APPROVED`         | yes       | Updates the proposed date only                |
| `SCHEDULED`        | yes       | Cancels and re-creates the scheduled post      |
| `PUBLISHED`        | no        | Fixed; it is a historical record               |

Moving a scheduled post requires `publish:manage` and is audited as a
cancellation plus a new schedule, because that is what actually happens at the
provider. Presenting it as a simple move would hide a real state change.

## Conflict rules

Deterministic and checked at plan time:

| Rule                          | Default                                    |
| ----------------------------- | ------------------------------------------ |
| Posts per channel per day     | 1                                           |
| Posts per day across channels | 3                                           |
| Minimum gap on one channel    | 4 hours                                     |
| Pillar repeat gap             | `minGapDays`, default 2                     |
| Hook similarity               | No near-duplicate within 30 days            |
| Quiet days                    | Workspace setting, default weekends off     |

A conflict is a warning, not a block. A founder launching a product may
deliberately post three times in a day, and a planner that refuses is a planner
that gets worked around. Automatic planning respects the rules; manual action
overrides them with a visible warning.

## Balance and selection

Filling a week is a deterministic algorithm, not a model decision:

1. Compute the target mix from enabled pillar weights and the slot count.
2. Subtract pillars already covered by scheduled posts in the window.
3. Order slots by pillar priority and `minGapDays`.
4. For each slot, select a topic:
   - `product` draws from recent releases, GitHub changes (RFC 022), and
     uncovered `ProductSurface` entries;
   - `educational` and `problem` draw from `ProductProfile.problems` and ICP
     pains, excluding topics used recently;
   - `customer` requires a stored proof point, and the slot is skipped when
     none exists;
   - `founder` and `build_in_public` draw from recent product activity.
5. Assign the surface and creative type per pillar.
6. Generate copy for the assembled plan through the RFC 015 steps.

The model writes the copy. The plan structure, pillar mix, and topic selection
are code. This is the same separation as RFC 015, applied to planning.

`requiresProof` prevents the worst failure mode of automated marketing: a model
inventing a customer quote or a metric. A pillar that needs evidence and has
none is skipped, and the founder is told why.

## Measuring balance

Balance is reported, not merely intended:

- Actual versus target pillar mix over rolling 30 and 90-day windows.
- Longest gap per pillar.
- Share of weeks meeting their target mix within a tolerance.
- Count of skipped slots by reason, which surfaces missing proof points.

Drift is expected: launches legitimately skew a week toward `product`. The
report exists so drift is a visible choice.

## Authorization

| Operation                | Permission        |
| ------------------------ | ----------------- |
| Read pillars and calendar| `workspace:read`  |
| Edit pillars and weights | `brand:manage`    |
| Move a draft post        | `artifact:edit`   |
| Move a scheduled post    | `publish:manage`  |
| Set quiet days           | `workspace:update`|

Pillar weights are brand-level decisions, so they sit behind `brand:manage`
rather than `artifact:edit`. A creator composes within the plan; an admin sets
the plan.

## Time zones

All planning uses the workspace time zone from `WorkspaceSettings`.

- Proposed dates store a local date and time plus the zone, resolved to UTC at
  scheduling.
- A DST transition shifts the resolved UTC instant, preserving local time,
  which is what a founder means by "9am Tuesday".
- A local time that does not exist on a spring-forward day moves to the next
  valid time; an ambiguous fall-back time takes the first occurrence.
- Changing the workspace time zone re-resolves future proposed dates and warns
  about already-scheduled posts rather than silently moving them.

## Failure behavior

| Situation                          | Behavior                                        |
| ---------------------------------- | ----------------------------------------------- |
| Not enough topics for a full week  | Fewer posts, with the shortfall explained       |
| A pillar has no eligible topic     | Slot skipped, reason recorded                   |
| Every pillar disabled              | Planning refuses with a setup action            |
| Conflict with an existing post     | Warning, alternative slot offered               |
| Drag onto a quiet day              | Warning; permitted                              |
| Reschedule fails at the provider   | Post returns to `APPROVED`; the move is undone  |

## Acceptance criteria

1. "Give me content for this week" produces a pillar-balanced week on the
   calendar, with each post traceable to its pillar.
2. Onboarding seeds pillars with weights justified by product intelligence.
3. A workspace with no customers has `customer` disabled by default.
4. The weekly plan matches target weights within tolerance when enough topics
   exist.
5. No pillar repeats inside its `minGapDays`.
6. No hook repeats within 30 days.
7. A `customer` slot with no stored proof point is skipped with a reason, and
   no customer quote is invented.
8. Dragging a draft post updates its proposed date only.
9. Dragging a scheduled post cancels and re-creates the schedule, audited.
10. A published post cannot be moved.
11. A conflicting placement warns and is permitted.
12. A DST transition preserves local posting time.
13. Changing the workspace time zone warns about scheduled posts.
14. The balance report shows actual versus target over 30 days.
15. Editing weights changes the next generated plan.
16. A `creator` cannot edit pillar weights.

## Rollout

1. Ship the pillar model with sensible defaults and no calendar. Tag posts with
   pillars.
2. Ship the read-only calendar view across campaigns.
3. Add drag rescheduling with the state rules.
4. Add balance-aware selection to Workflow 3.
5. Add the balance report.
6. Hand pillar weights to RFC 028 for performance-driven adjustment.

## Out of scope

- Performance-weighted planning. RFC 028 adds the feedback loop.
- Recurring automatic planning. RFC 029 covers the weekly cycle.
