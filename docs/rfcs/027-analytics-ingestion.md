# RFC 027: Post Performance Analytics

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 020
**Owners:** Engineering

## Decision

Ingest post performance through Postiz and normalize it across platforms. Do
not integrate each social network's analytics API directly.

## Data model

```text
PostPerformance
├── impressions
├── views
├── likes
├── comments
├── shares
├── clicks
└── conversions
```

Associate performance with the attributes that explain it:

```text
hook
angle
creative type
topic
feature
format
CTA
channel
time
```

## Design

- A scheduled Trigger.dev task polls Postiz for publication metrics and
  upserts `PostPerformance` rows.
- Each metric row links to its `Post`, `Creative`, `ContentAngle`, and
  `Campaign` (RFC 014), so attribution queries are joins, not inference.
- Aggregates build a marketing knowledge base over time:

```text
"cash-flow educational posts"
        ├── LinkedIn → consistently strong
        └── X        → mediocre

"feature screenshots"
        ├── annotated → strong
        └── plain     → weak
```

## Exit criterion

Published posts show normalized metrics in the campaign workspace, and an
aggregate query answers "which creative type performs best on LinkedIn."

## Out of scope

- Recommendations from the data. RFC 028 covers the feedback loop.
- Website conversion attribution beyond click counts.
