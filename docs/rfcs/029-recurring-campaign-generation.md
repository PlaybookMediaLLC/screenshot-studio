# RFC 029: Recurring Campaign Generation

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 025 and RFC 028
**Owners:** Product and Engineering

## Decision

Run a weekly planning cycle as the first meaningful autonomy level. The agent
prepares; the founder approves. This is not fully autonomous publishing.

The cycle's job is to make Monday morning a five-minute task. It succeeds when
a founder opens one screen, reads one plan, and approves seven posts in one
action. Everything in this RFC serves that, including the parts about what the
cycle refuses to do.

## Design

The weekly cycle:

```text
Every Sunday
     ↓
look at recent product changes
     ↓
look at performance
     ↓
look at previous content
     ↓
create next campaign
     ↓
generate assets
     ↓
generate posts
     ↓
schedule calendar
     ↓
ask founder:
"Approve this week's plan?"
```

Details:

- A scheduled Trigger.dev task runs the cycle per workspace.
- Inputs: GitHub-derived product changes (RFC 022), performance data
  (RFC 027), published history, and pillar balance (RFC 025).
- The output is one campaign in `READY_FOR_REVIEW` with a full week of posts.
- One batch approval (RFC 019) schedules the week. Rejection with a note
  regenerates the plan.
- A workspace can disable the cycle.

## Goals

- A reviewable weekly plan waiting when the founder wants it.
- Exactly one plan per week, never zero and never two.
- A cycle that degrades to a smaller plan rather than skipping a week.
- Cost that is predictable and capped per workspace.

## Non-goals

- Publishing without approval. RFC 030 introduces policy-scoped exceptions.
- Multiple cadences beyond weekly in the first version.
- Cross-workspace scheduling coordination.
- Replacing on-demand generation. Workflow 3 remains available any time.

## Configuration

```ts
RecurringPlanConfig {
  workspaceId
  enabled
  cadence               // weekly (only value in v1)
  runDayOfWeek          // default Sunday
  runLocalTime          // default 18:00
  timeZone              // from WorkspaceSettings
  postsPerWeek          // 3-7, default 5
  channels[]
  autoRegenerateOnReject
  pausedUntil           // vacation pause
  lastRunAt, nextRunAt
}
```

The founder chooses when the plan appears, because "Sunday evening" and
"Monday 7am" suit different people. The default is Sunday evening so the plan
is waiting before the week starts.

## Time zones and DST

Scheduling in local time across DST transitions is the most common source of
silent duplicate or skipped runs, so the rules are explicit.

- `nextRunAt` is computed by resolving the local run time in the workspace zone
  to a UTC instant, and stored in UTC.
- After each run, the next occurrence is recomputed from the local calendar,
  not by adding 168 hours. Adding a fixed interval drifts by an hour twice a
  year and eventually lands on the wrong day.
- Spring forward: a local run time that does not exist moves to the next valid
  local time that day.
- Fall back: an ambiguous local time uses the first occurrence, so the cycle
  runs once and not twice.
- Changing the workspace time zone recomputes `nextRunAt` and reports the
  change; it never fires a catch-up run.

## Locking and exactly-once execution

The cycle must produce exactly one plan per period, even with overlapping
schedulers, retries, and redeploys.

1. A period key identifies the run: `(workspaceId, isoYear, isoWeek)`.
2. A `RecurringPlanRun` row is inserted with a unique constraint on the period
   key. The insert is the lock; a duplicate insert loses harmlessly.
3. The winner claims execution with a conditional status update, the same
   compare-and-set pattern as RFC 020's publication claim.
4. A run stale beyond its lease is reclaimed only if it has no partial campaign;
   otherwise it is failed for inspection, since a duplicate week of content is
   worse than a missing one.
5. The generated campaign records its period key, so a second campaign for the
   same week is detectable and refused.

## Missed runs

Workers are down, deploys happen, workspaces are suspended.

| Delay since scheduled | Behavior                                                |
| --------------------- | ------------------------------------------------------- |
| Under 6 hours         | Run normally                                            |
| 6 to 48 hours         | Run, and shorten the plan to the remaining days          |
| Over 48 hours         | Skip; record the miss; the next period runs normally    |

No catch-up runs. Two weeks of downtime produce one plan for the current week,
not two plans. Backfilling last week's marketing plan is worthless, and
generating it costs money and confuses the calendar.

A skipped period is visible in the workspace with its reason.

## Duplicate prevention

Beyond the period lock, the plan must not duplicate content:

- Hooks used in the last 30 days are excluded, matching RFC 021's Workflow 3.
- Product changes already covered by an existing campaign are excluded.
- A `ChangeSuggestion` (RFC 022) already accepted is not re-planned.
- If an unreviewed plan from the previous period still exists, the cycle does
  not generate a second one. It surfaces the existing plan instead.

The last rule matters most. A founder who ignores two weeks of plans should
return to one stale plan and a note, not fourteen unreviewed posts. Piling up
unreviewed work is how an autonomous feature becomes something users turn off.

## Interaction with approval

The cycle produces `READY_FOR_REVIEW`, never `APPROVED`, and never
`SCHEDULED`. Approval is RFC 019's batch action.

This is a blocking dependency, not just a design preference. RFC 019's `submit`
decision is session-only today, because `decideApproval` resolves through
`requireActiveSessionOrganization` and has no API-key path. A background cycle
therefore cannot move its own output to `READY_FOR_REVIEW` with the shipped
surface. RFC 019's planned machine-submission procedure has to land before this
RFC can work at all, and it must be a separate procedure so that `approve`,
`reject`, and `request_changes` stay human-only.

| Founder action           | Effect                                                  |
| ------------------------ | ------------------------------------------------------- |
| Approve all              | Posts schedule at their planned times                   |
| Approve a subset         | Those schedule; the rest stay in review                 |
| Request changes with a note | Regenerates once with the note as guidance            |
| Reject the plan          | Campaign archived; the miss is recorded                 |
| No action by period end  | Plan expires and is archived, with a summary            |

Expiry rather than indefinite accumulation keeps the calendar honest. An
approved-but-unscheduled plan from three weeks ago describes a week that has
passed.

Regeneration on request-changes happens at most once per period, since an
unbounded regeneration loop is an unbounded cost loop.

## Freshness

A plan generated Sunday for a week that starts Monday can go stale:

- Product changes detected after generation but before approval are surfaced as
  "3 new changes since this plan was created", with an option to regenerate.
- Approving a plan older than 7 days warns that its context is stale.
- Post scheduling times are validated at approval; a time already past moves to
  the next valid slot rather than scheduling into the past.

## Budgets

| Limit                        | Value                                  |
| ---------------------------- | -------------------------------------- |
| Runs per workspace per period| 1                                      |
| Regenerations per period     | 1                                      |
| Posts per plan               | Configured, capped at 7                |
| Wall clock per run           | 20 minutes                             |
| Tokens per run               | Plan-scoped cap                        |
| Renders per run              | 2 per post                             |
| Platform-wide concurrency    | Queue cap, with runs spread over hours |

Recurring generation is the largest recurring cost in the product because it
runs forever for every enabled workspace. Runs are spread across a window
rather than firing simultaneously at midnight, both for cost smoothing and to
avoid a synchronized load spike.

A workspace exceeding its quota has the cycle paused with a notification rather
than failing silently every week.

## Degradation

The cycle produces something useful rather than nothing:

| Condition                    | Behavior                                            |
| ---------------------------- | --------------------------------------------------- |
| No new product changes       | Plan from pillars and evergreen topics              |
| No performance data          | Plan from default weights                           |
| Analytics unavailable        | Plan from editorial signals (RFC 028)               |
| Some copy generation fails   | Fewer posts, stated in the summary                  |
| All renders fail             | Posts without creatives, retryable inline           |
| Product profile missing      | Skip and prompt to complete onboarding              |
| No connected channel         | Plan still generates; scheduling prompts to connect |

Only a missing product profile skips the cycle, because generating marketing
for an unknown product is the one case where output would be actively wrong.

## Authorization and audit

| Operation                | Permission        |
| ------------------------ | ----------------- |
| Enable or disable        | `workspace:update`|
| Change configuration     | `workspace:update`|
| Pause                    | `workspace:update`|
| Review the generated plan| `release:approve` |
| Trigger a manual run     | `release:create`  |

The cycle runs as a workspace-scoped service principal that can create
campaigns and submit them for review, and cannot approve, schedule, or publish.

Audited events: cycle enabled and disabled, configuration changed, run started,
plan created, plan expired, run skipped with reason, and quota pause.

## Observability

- Runs scheduled, started, completed, skipped, and failed.
- Plan approval rate, and time from plan creation to decision.
- Share of plans expiring unreviewed, which is the disengagement signal.
- Posts per plan versus configured target.
- Cost per run and total recurring cost per workspace.
- Duplicate-period attempts, which must be zero.

Expiry rate is the health metric. Plans that expire unreviewed mean the cycle
is producing work nobody wants, and the correct response is to pause it and ask
rather than to keep generating.

## Failure behavior

| Failure                    | Behavior                                          |
| -------------------------- | ------------------------------------------------- |
| Worker crash mid-run       | Resumes from step checkpoints                     |
| Crash after partial campaign | Campaign completed on resume, never duplicated  |
| Lock contention            | One run proceeds; others exit cleanly             |
| Generation fails entirely  | Run marked failed; no partial plan is shown       |
| Workspace suspended        | Skipped; recorded                                 |
| Configuration invalid      | Cycle paused with a notification                  |

## Acceptance criteria

1. Each Monday a founder opens one screen, reads one plan, and approves seven
   posts in one action.
2. Exactly one plan is produced per period, verified under concurrent
   schedulers.
3. A DST transition produces exactly one run, on the correct local day.
4. A run 30 hours late produces a shortened plan for the remaining days.
5. A run 60 hours late is skipped with a recorded reason and no catch-up.
6. An unreviewed plan from the previous period suppresses a new one.
7. Plans expire at period end and are archived with a summary.
8. Request-changes regenerates once and not repeatedly.
9. No hook from the previous 30 days appears in a plan.
10. A product change already covered by a campaign is not re-planned.
11. The cycle never produces `APPROVED` or `SCHEDULED` posts.
12. A workspace without analytics still receives a plan.
13. A workspace without a product profile is skipped and prompted.
14. A crashed run resumes without duplicating the campaign.
15. Approving a plan with a past scheduled time moves it forward.
16. Disabling the cycle takes effect before the next period.
17. Exceeding quota pauses the cycle with a notification.

## Rollout

1. Ship configuration and scheduling with the cycle disabled everywhere.
2. Run in shadow mode internally: generate plans, do not surface them, and
   inspect quality and cost for several weeks.
3. Enable opt-in for workspaces that have approved at least one manual
   campaign, since the cycle should not be a first experience.
4. Measure expiry rate; iterate before broadening.
5. Add freshness prompts and regeneration.
6. Hand policy-scoped auto-approval to RFC 030 and mode gating to RFC 031.

## Out of scope

- Publishing without approval. RFC 030 introduces policy-scoped exceptions.
