# RFC 027: Post Performance Analytics

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 014 and RFC 020
**Owners:** Engineering

## Decision

Ingest post performance through Postiz and normalize it across platforms. Do
not integrate each social network's analytics API directly.

Metrics are stored as time-series snapshots, not as mutable current values. A
post's engagement at 1 hour and at 7 days are different facts, and comparing
posts requires comparing them at the same age.

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

Concretely:

```ts
PerformanceSnapshot {
  id
  workspaceId
  scheduledPostId
  campaignPostId
  providerPostId
  platform
  observedAt
  ageMinutes              // observedAt - publishedAt, the comparison key
  impressions?, views?, likes?, comments?, shares?, clicks?, conversions?
  isFinal                 // no further polling expected
  completeness            // which metrics the platform actually returned
  providerPayloadHash
}

PostPerformanceRollup {
  campaignPostId
  platform
  at1h, at24h, at7d, at30d    // metric bundles at standard ages
  peakEngagementRate
  finalizedAt
}
```

Snapshots are append-only. Rollups are derived and recomputed, never
hand-edited. Storing only a current value would make "did our Tuesday posts
beat our Thursday posts" unanswerable, because a Tuesday post observed on
Friday has had longer to accumulate.

## Attribution

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

Each metric row links to its `Post`, `Creative`, `ContentAngle`, and
`Campaign` (RFC 014), so attribution queries are joins, not inference.

Attribution is by foreign key, resolved at publish time and frozen:

```text
PerformanceSnapshot
  → ScheduledPost → CampaignPost → ContentAngle → Campaign
                         │              │
                         │              └── pillar (RFC 025)
                         └── CreativeVariant → CreativeTemplate
                                             → SurfaceCapture → ProductSurface
```

Freezing attribution at publish time matters. If a campaign post's angle is
later reassigned, historical performance must remain attributed to the angle
that was actually published. Rollups therefore store denormalized attribution
alongside the keys.

## Provider metric mapping

A scheduled Trigger.dev task polls Postiz for publication metrics and upserts
snapshots. Platforms report different things under similar names.

| Canonical     | X                | LinkedIn            | Instagram         |
| ------------- | ---------------- | ------------------- | ----------------- |
| `impressions` | impressions      | impressions         | impressions       |
| `views`       | video views      | video views         | video views, reach |
| `likes`       | likes            | reactions (all)     | likes             |
| `comments`    | replies          | comments            | comments          |
| `shares`      | reposts + quotes | reposts             | shares            |
| `clicks`      | link clicks      | clicks              | not provided      |
| `conversions` | not provided     | not provided        | not provided      |

Mapping rules:

- A metric a platform does not provide is `null`, never `0`. The distinction
  between "nobody clicked" and "clicks are unavailable" changes every average
  computed from it.
- `completeness` records which metrics were present, so aggregates can exclude
  posts lacking a metric rather than treating absence as zero.
- LinkedIn reactions collapse into `likes` because the platform's reaction
  types are not comparable across platforms. Raw payloads are retained by hash
  so a richer breakdown remains possible later.
- `conversions` is unpopulated by any current provider. The field exists for a
  future first-party attribution mechanism and must not be presented as a real
  metric until one exists.

Cross-platform comparison of absolute numbers is meaningless: a LinkedIn
impression and an X impression are different events. Comparisons within a
platform are valid, and engagement *rate* is the only cross-platform figure
worth showing, always labeled as approximate.

## Polling

Polling frequency follows the shape of social engagement, which is
front-loaded:

| Post age      | Interval  |
| ------------- | --------- |
| 0–2 hours     | 15 min    |
| 2–24 hours    | 1 hour    |
| 1–7 days      | 6 hours   |
| 7–30 days     | daily     |
| Beyond 30 days| stop, finalize |

- Polling is batched per workspace and per provider to conserve rate limit.
- Snapshots are only written when a metric changed, so unchanged polls cost
  nothing in storage.
- Rate-limit responses back off and defer, never drop.
- A post whose metrics have not changed across three consecutive polls in the
  daily window is finalized early.
- A poll failure is retried on the next cycle. Missing one interval leaves a
  gap in the series, which is acceptable and visible.

Rollups compute at standard ages by interpolating from surrounding snapshots
when an exact-age snapshot is missing, with the interpolation marked.

## Late, missing, and revised data

Real analytics data is messy and the model must accommodate it:

- **Late data.** Platforms backfill. A snapshot arriving with an earlier
  `observedAt` than the newest one is stored in order; rollups recompute.
- **Decreasing metrics.** Counts can decrease when a like is withdrawn or spam
  is filtered. Decreases are stored as observed, never clamped. Clamping would
  hide platform corrections.
- **Deleted posts.** A provider reporting the post as missing finalizes the
  series and marks it `deleted_at_provider`, retaining history.
- **Missing publication.** A `ScheduledPost` with `UNKNOWN_DELIVERY` from RFC
  020 has no `providerPostId` and cannot be polled. It is excluded from
  aggregates rather than counted as a zero-performing post.
- **Duplicate payloads.** Deduplicated by `providerPayloadHash` per
  `(providerPostId, observedAt)`.

## Aggregation

Aggregates build a marketing knowledge base over time:

```text
"cash-flow educational posts"
        ├── LinkedIn → consistently strong
        └── X        → mediocre

"feature screenshots"
        ├── annotated → strong
        └── plain     → weak
```

Aggregation rules that keep the knowledge base honest:

- Aggregates compare at matched ages, defaulting to 24 hours.
- Every aggregate reports its sample size alongside its value.
- Aggregates over fewer than 5 posts are marked low-confidence.
- Posts missing the metric being aggregated are excluded, not zeroed, and the
  exclusion count is reported.
- Aggregates never mix platforms for absolute counts.

RFC 028 consumes these aggregates and is where sample-size discipline becomes
a product requirement rather than a reporting nicety.

## Reconciliation

Polling produces a local view of numbers a provider owns. Drift between the two
is inevitable, so it is checked rather than assumed away.

A daily reconciliation pass, per connected channel, over posts published in the
last 30 days:

| Discrepancy                                   | Resolution                                    |
| --------------------------------------------- | --------------------------------------------- |
| Provider count differs from the newest snapshot | Provider wins; a corrective snapshot is written |
| Post exists locally, absent at the provider   | Marked `deleted_at_provider`; series finalized |
| Post exists at the provider, absent locally   | Logged as unattributed; never invented         |
| Provider returns an error for a known post    | Left untouched; retried next pass              |

Two rules keep reconciliation from doing damage. The provider is always
authoritative for its own metrics, because the local copy is a cache and a
cache that argues with its source is a bug. And reconciliation only ever writes
a new snapshot; it never edits or deletes an existing one, so the history of
what was believed and when stays intact and a bad reconciliation run is
recoverable.

The third row matters more than it looks. A post published outside the platform
appears at the provider with no local record. It is deliberately not adopted:
inventing local records from provider data would let an external actor's
content enter a workspace's knowledge base and skew RFC 028's weights. It is
surfaced for a human instead.

Reconciliation reports drift as a metric rather than silently correcting it.
Persistent drift on one provider usually means the metric mapping is wrong, and
silent correction would hide exactly the signal needed to find that.

## Retention

| Data                 | Retention                                |
| -------------------- | ---------------------------------------- |
| Raw snapshots        | 90 days at full granularity              |
| Snapshots beyond 90d | Downsampled to daily                     |
| Rollups              | Indefinite while the post exists         |
| Provider payloads    | Hash only; bodies discarded after mapping |
| On workspace deletion| All of it                                |

Rollups are the durable record. A two-year-old post needs its 24-hour and
7-day numbers, not its 15-minute polling series.

## Authorization

| Operation                | Session permission | API-key scope   |
| ------------------------ | ------------------ | --------------- |
| Read post performance    | `workspace:read`   | `artifact:read` |
| Read aggregates          | `workspace:read`   | `artifact:read` |
| Trigger a manual refresh | `publish:manage`   | not permitted   |

Polling runs as a workspace-scoped service principal. Every snapshot is
workspace-scoped, and aggregates never cross workspaces. Each workspace learns
only from its own data, which RFC 028 restates as a product commitment.

## Failure behavior

| Failure                     | Behavior                                          |
| --------------------------- | ------------------------------------------------- |
| Provider unavailable        | Retry next cycle; gap in the series                |
| Provider rate limited       | Back off and defer the batch                      |
| Malformed payload           | Snapshot skipped; parse failure recorded          |
| Unknown metric field        | Ignored; raw hash retained                        |
| Post missing at provider    | Series finalized and marked                       |
| Connection revoked          | Polling stops; existing data retained             |
| Metrics never available     | Post shows "metrics unavailable", not zeros       |

Analytics failure never affects publishing. The two paths share only the
`providerPostId`.

## Security threats

Performance data is business intelligence. It reveals what a company is
shipping, how its market responds, and where it is struggling, so a leak across
tenants is a competitive harm even though no credential is involved.

| Threat                                      | Mitigation                                                  |
| ------------------------------------------- | ----------------------------------------------------------- |
| Snapshots attributed to the wrong workspace | Ingestion resolves the workspace from the stored post, never from provider payload |
| Provider payload used as an identifier      | `providerPostId` is matched against records this workspace owns |
| Metrics inflated to steer generation        | Snapshots are immutable; corrections append (see Reconciliation) |
| Aggregate queries crossing tenants          | Every aggregate is workspace-scoped at the query, not filtered after |
| Retention outliving its purpose             | Snapshots age out on the schedule in Retention                |

The rule that carries the most weight is that a provider response never
determines which workspace a snapshot belongs to. The provider is authoritative
about numbers and never about ownership, so a compromised or confused provider
account can corrupt a workspace's metrics but cannot read another workspace's.

## Observability

- Polling success rate and latency per provider.
- Share of published posts with any metrics, which is the coverage number.
- Snapshot volume and storage growth.
- Rate-limit proximity.
- Time from publication to first metrics.
- Count of posts excluded from aggregates by reason.

Coverage is the headline. A feedback loop built on metrics for 40% of posts is
a biased feedback loop, and RFC 028 must know the coverage before drawing
conclusions.

## Acceptance criteria

1. Published posts show normalized metrics in the campaign workspace, and an
   aggregate query answers "which creative type performs best on LinkedIn".
2. A metric a platform does not report is `null` and displays as unavailable,
   never as zero.
3. Aggregates exclude posts missing the aggregated metric and report the
   exclusion count.
4. Comparisons use matched post ages.
5. An aggregate over 3 posts is marked low-confidence.
6. Polling follows the decay schedule and stops at 30 days.
7. An unchanged poll writes no snapshot.
8. A decreasing metric is stored as observed.
9. Late-arriving data recomputes rollups correctly.
10. A deleted provider post finalizes its series and retains history.
11. An `UNKNOWN_DELIVERY` post is excluded from aggregates.
12. Duplicate payloads produce one snapshot.
13. Rate limits defer rather than drop.
14. Snapshots older than 90 days downsample to daily.
15. Attribution survives a later angle reassignment.
16. No aggregate mixes data across workspaces.
17. Provider outage does not affect publishing.
18. Reconciliation writes a corrective snapshot when provider counts differ,
    and never edits an existing snapshot.
19. A post deleted at the provider is finalized, not zeroed.
20. A provider post with no local record is reported, never adopted into
    the workspace knowledge base.

## Rollout

1. Ship the snapshot and rollup models with polling behind a flag, storing but
   not displaying data.
2. Verify mapping fidelity per platform against the platforms' own dashboards.
   A mapping error discovered after RFC 028 ships teaches the system the wrong
   lesson.
3. Display per-post metrics in the campaign workspace.
4. Ship aggregates with sample-size labeling.
5. Ship retention and downsampling.
6. Hand aggregates to RFC 028.

## Out of scope

- Recommendations from the data. RFC 028 covers the feedback loop.
- Website conversion attribution beyond click counts.
- Direct social-network analytics APIs.
