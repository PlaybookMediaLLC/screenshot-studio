# Shots Plan and Analyze implementation

Implementation audit: October 24, 2026. The assignment explicitly authorizes this scope despite the October 23 roadmap deferral. This is a Shots implementation of the behavioral specifications, not a claim about Typefully's internals or a live-provider certification. See the [80-row acceptance matrix](implementation-matrix.md) and [verification record](verification.md).

## Architecture and source map

| Surface                                                                   | Implementation                                                                                                                         | Reused authority                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Plan route, account selection, calendar, filters, slots, composer, detail | `app/[locale]/write/plan/page.tsx`, `components/plan/PlanWorkspace.tsx`, `QuickBody.tsx`, `useDraftSources.ts`, `lib/plan/calendar.ts` | PlatformShell, social sets, Plate, Write API, existing shortcuts and zoned-time utilities     |
| Placement, swap, Undo, unschedule                                         | `services/internal/product/calendar.go`, `content_draft_platform.go`                                                                   | Existing draft records, revisions, audit/events, publishing repository and Temporal scheduler |
| Creation, published reuse, deletion                                       | `content_drafts.go`, `content_draft_write.go`                                                                                          | Existing draft copy relationships, asset checks, permissions, approval rules                  |
| Schedule and retry                                                        | `content_draft_schedule.go`, `components/write/composer/schedule.tsx`                                                                  | Existing immutable scheduled posts, publication attempts, provider receipts and recovery      |
| Analyze dashboard, charts, hourly modes, rows, goals/sharing              | `components/analyze/AnalyzeWorkspace.tsx`, `MetricChart.tsx`, `Hourly.tsx`, `lib/analyze/report.ts`                                    | One typed account/date query; existing authenticated workspace shell                          |
| Chart image                                                               | `components/analyze/ChartShare.tsx`                                                                                                    | Existing DesignDocument schema, preview hook and scene renderer; PNG download                 |
| Analytics reads, settings, formulas                                       | `services/internal/product/analytics.go`                                                                                               | Go authorization, private social-set visibility, paid feature gates                           |
| Collection and reconciliation                                             | `analytics_ingestion.go`, `social/tenantpublishing/analytics.go`                                                                       | Installed social adapter registry and existing Temporal maintenance worker                    |
| HTTP and SDK                                                              | `services/internal/httpapi/plan_analyze.go`, `lib/api/contracts/plan-analyze.ts`, `app/api/v1/{calendar,analytics}`, backend SDK       | Existing service-token authentication, tenant access, Zod validation, OpenAPI generation      |
| Public read                                                               | `app/[locale]/analytics/public/[token]`, `app/api/analytics/public/[token]`                                                            | Internal authenticated Go endpoint, token checked on every request                            |

Paths in the table are repository-relative. No browser/server component directly accesses PostgreSQL. Database access in Playwright is test-fixture setup and verification only.

## Calendar contract

Visibility is a set of stable social-set IDs, independent of the source sidebar, date anchor, and view. Same-named accounts retain provider labels. Preferences are stored per workspace and user in localStorage; they do not change another teammate's settings. Status/platform/tag filters use OR within a category and AND between categories. An unavailable tag request has an explicit retry.

Flex derives its rendered week count from the viewport. Month includes adjacent dates. Week has seven hourly columns and minute-accurate positions. Mobile uses a queue. F/M/W select a view, V cycles, arrows change periods and T returns to today; text inputs and open dialogs retain their keyboard behavior. Empty account posting slots are a separate suggestion layer, available only in single-set focus, with an Edit schedule link.

The calendar display zone, social-set scheduling zone, original placement zone and stored UTC instant are separate. Changing display zone only changes presentation. Local time resolution uses IANA rules, rejects DST gaps and requires earlier/later selection for repeated hours. Any minute is accepted; quarter-hour options are suggestions. Creation converts the chosen displayed cell into the scheduling zone.

A planned draft has `plannedFor` and no executable publishing job. Its date passing does not publish it. Scheduling goes through the existing approval and publishing path. Unschedule cancels eligible scheduled jobs and retains the plan; remove-date clears the plan without deleting content. Processing, uncertain and confirmed publication records prevent a draft from being relabeled and planned again. Published reuse creates a new draft with a source relationship and preserves original receipts.

`calendarVersion` protects placements independently of the content version, preserving approvals when only a calendar date changes. Mutation requests carry both versions. Rows are locked in deterministic order; swaps are atomic. A durable receipt binds workspace, actor, request key and input hash. Retrying the same intent replays its result; changing intent under the same key conflicts. Undo carries versions of the resulting placements and cannot undo intervening changes. It is offered when the original date is still safely in the future (or undated); expired scheduled times require a new future time. Scheduled moves use the existing job replacement/recovery mechanism, never a second publication writer. Legacy date-edit paths also require the calendar version. Detail deletion uses expected content/calendar versions.

Planning and content changes require edit permission. Scheduling, unscheduling, retrying publication, analytics refresh, goals and sharing require publisher/admin/owner authority. Private-set visibility and subscription eligibility are checked server-side. Disabled controls explain permission restrictions.

## Analytics semantics

Reports have one account, inclusive local From/To dates, IANA zone, grouping, post scope, sort, direction and observation cutoff. The maximum range is two years. All includes individual roots and replies; Replies selects replies. The previous period contains the same number of local calendar days, including across DST. Account changes immediately discard old presentation data and abort stale requests.

| Metric                     | Definition                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Followers                  | Last observed follower total in each interval; never a sum. An interval without an observation stays missing.                                                                                                             |
| Follower growth            | Difference between consecutive observed intervals. A missing interval breaks the comparison; negative growth is valid.                                                                                                    |
| Published posts            | Confirmed individual provider publications known to Shots in the selected publication-date range. Continuations count individually; incomplete external history is disclosed.                                             |
| Impressions/profile clicks | Latest observed lifetime counters for posts published in the selected range. They are not engagement events received during that range. Views are not relabeled as impressions.                                           |
| Engagements                | Sum of returned likes, replies, reposts, profile clicks and link clicks. Missing components make this an explicitly partial total. Quotes, bookmarks and media views are not added.                                       |
| Engagement rate            | Derived engagements / impressions. Missing or zero impressions produce an unavailable rate, not infinity or zero.                                                                                                         |
| Comparison                 | `(current - previous) / previous * 100`; missing or zero previous values produce no percentage.                                                                                                                           |
| Hourly                     | Latest observed lifetime engagements grouped by each post's publication weekday/hour in the selected zone. Every cell retains samples, total, average and exact post IDs. This does not measure when engagement occurred. |

No best-time recommendation is claimed from sparse or unequal-age samples. Avg, Days and Heatmap expose the measurements; the 168-cell drilldown keeps the original date scope. This lifetime comparison has age bias, explicitly stated in the UI. Matched-age learning/attribution from the wider RFC 039 is not represented as complete.

Metric states distinguish loading, available (including zero), insufficient, unsupported, forbidden, failed and stale. Decorative skeletons have no factual numbers and are hidden from assistive technology. Invalid individual metric payloads fail locally; valid neighboring cards remain usable. Provider capabilities come from installed interfaces, not a hardcoded LinkedIn prohibition. The current personal LinkedIn adapter has no post-analytics interface; LinkedIn Page, Threads and Instagram post counters are handled when available and authorized. X currently supports account follower snapshots and bounded external-post import. Other adapters do not fabricate follower history or external post discovery.

## Collection, reconciliation and operations

The existing `social-analytics` Temporal maintenance job runs every 15 minutes. A connection normally becomes eligible after 45 minutes; actual cadence is the next maintenance tick plus queueing. Post due intervals are 15 minutes in the first two hours, one hour through the first day, six hours through seven days, then daily through 30 days. The connection cadence is an effective lower bound: this is not a guarantee of 15-minute collection. Older posts retain their last observation and are not routinely repolled.

Each batch considers at most 100 due connections and processes 20, with an eight-minute batch budget. Each account holds an eight-minute database lease, a seven-minute automatic budget, or a 25-second manual budget. Manual refresh has a one-minute minimum interval. Each pass reconciles at most 200 changed canonical publications, imports at most 1,000 eligible X posts from a 30-day overlap, and checks at most 100 due post IDs. Ineligible and unsupported connections are deferred for a day so they cannot starve eligible workspaces.

Canonical reconciliation uses source update timestamps and receipt publication times. Exact root/continuation IDs and positions survive partial thread publication. Provider-originated posts can later acquire canonical attribution. Import counters do not overwrite a richer observation or postpone its due poll. Counter snapshots are immutable and deduplicate identical payloads at the same observation time. Corrections, including decreases, remain new observations. Observation and collection timestamps and post age are separate. Newly imported history is not made visible to an older export cutoff.

Typed 401/403 failures mark permission unavailability; 404/410 mark deleted posts while retaining history; 429/420 obey retry guidance with bounded backoff. Other failures defer collection. Leases are released after cancellation, and active account state is rechecked before storing observations. X, Threads, Instagram and LinkedIn Page analytics propagate HTTP failures rather than treating error JSON as an empty success. Missing provider fields are omitted, while measured zero remains zero.

Maintenance uses the existing worker registration and logs connection ID/status or a deferred collection. It does not log access tokens or provider response bodies. `checkedAt`, `nextCheckAt`, lease expiry and per-post availability provide operational inspection. Monitor maintenance failures, sustained overdue accounts and database growth. Snapshot retention/compaction and RFC 039 matched-age rollups remain broader roadmap work; there is no hidden deletion of analytics history in this change.

## Goals, exports and privacy

Goal configuration is saved explicitly with its own version. Opening or cancelling does not write. Daily requires one confirmed root publication per eligible day; Weekly requires one per Monday-based eligible week. Replies, planned/scheduled/failed posts do not qualify. Weekend exclusion uses the goal's saved timezone. Goals begin on their effective date, do not retroactively award earlier history, and do not treat the current incomplete period as a broken streak.

CSV exports freeze `asOf`, reuse the exact query scope and fetch every page in stable sort order. Counters keep full numeric precision; UTF-8 BOM, CRLF, quoted strings and spreadsheet-formula escaping are tested from downloaded files. Chart and list export availability is independent. Post rows refer to exact provider IDs, including thread continuations; deleted/unavailable rows retain their status.

Public sharing defaults off. Explicit, versioned enable creates a random 192-bit token and an audit entry. Public responses remove internal account/post IDs, settings, goals and hourly/private controls, and include only confirmed posts. Revocation, inactive accounts and lost paid eligibility are checked on every read. Pages and responses use no-store; the public route also forbids indexing. Previously downloaded CSVs/images cannot be recalled. Chart-image creation changes no sharing setting and performs no publication.

## Database and rollout

Apply platform migrations in order before starting the new API/worker:

1. `20261102100000_plan_analyze.sql`: additive `content_draft.calendarVersion`, `calendar_mutation`, `analytics_account`, `analytics_post`, `analytics_snapshot`; tenant FKs, unique provider identity, observation deduplication, due/range indexes.
2. `20261102110000_analytics_discovered.sql`: discovery cutoff for reproducible pagination.
3. `20261102120000_analytics_reconciliation.sql`: incremental canonical reconciliation timestamp. Latest-observation lookups reuse the snapshot identity index.

Migration filenames follow the repository's existing later sequence; the audit date is not their execution date. All three were applied to disposable PostgreSQL databases and the local browser stack. Existing drafts default to calendar version 1. Existing publication records remain authoritative. No destructive backfill is required.

Plan/Analyze use the existing `content:drafts` feature/paid entitlement. `RUN_MAINTENANCE=true` on the existing product worker is required for automatic collection; manual refresh does not replace the worker. Keep public analytics off until an owner explicitly enables it. Deploy migrations, API and SDK/web together so old clients do not send legacy date edits without versions.

Local database, API, provider-fixture and browser evidence establishes application behavior. Production enablement still requires authorized provider accounts and scopes, provider quota/access-tier checks, a deployed worker, and a live publish/receipt/import smoke test. No live X/LinkedIn/Instagram/Threads publication or analytics request is claimed by the tests in this change. The repository's deliberately opt-in live Mastodon capability test is unrelated to certifying these surfaces.
