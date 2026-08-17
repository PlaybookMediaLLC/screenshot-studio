# RFC 029: Recurring Campaign Generation

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 025 and RFC 028
**Owners:** Product and Engineering

## Decision

Run a weekly planning cycle as the first meaningful autonomy level. The agent
prepares; the founder approves. This is not fully autonomous publishing.

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
- The output is one campaign in `ready_for_review` with a full week of posts.
- One batch approval (RFC 019) schedules the week. Rejection with a note
  regenerates the plan.
- A workspace can disable the cycle.

## Exit criterion

Each Monday a founder opens one screen, reads one plan, and approves seven
posts in one action.

## Out of scope

- Publishing without approval. RFC 030 introduces policy-scoped exceptions.
