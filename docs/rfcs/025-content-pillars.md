# RFC 025: Content Pillars and the Weekly Calendar

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 021
**Owners:** Product and Engineering

## Decision

Derive content pillars from product understanding. Turn campaigns from
isolated launches into a calendar. This moves the product from "market my
launch" toward "give me this week's marketing."

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

Details:

- Pillars persist on the workspace and are editable. Onboarding (RFC 012)
  seeds them.
- The calendar is a view over `Post.scheduledAt` across campaigns, rendered
  in the campaign workspace (RFC 018).
- Workflow 3 (RFC 021) fills a week by pillar instead of generating an
  unstructured batch.
- Pillar balance is a constraint on generation: no week is all product
  announcements.

## Exit criterion

"Give me content for this week" produces a pillar-balanced week on the
calendar, with each post traceable to its pillar.

## Out of scope

- Performance-weighted planning. RFC 028 adds the feedback loop.
- Recurring automatic planning. RFC 029 covers the weekly cycle.
