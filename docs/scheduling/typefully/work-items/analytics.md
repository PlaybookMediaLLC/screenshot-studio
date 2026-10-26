# Epic ANALYTICS: Stored observations and reporting

This epic is reopened. Evidence is a provider observation, not a zero-filled chart or a successful mock request. See [coverage](coverage.md).

## WI-ANALYTICS-1: Store attributed provider observations

**Source:** TF-003, TF-065. **Gap:** Missing historical persistence behind existing adapters. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** Existing maintenance worker, provider analytics scopes, paid content feature.

### Problem and scope
Record actual account and published-post readings with workspace, social set, connection, subject, observation time and provider data dates. Collect recently published posts for 30 days and account history through the existing hourly maintenance task. Attribute Shots posts to their confirmed publication receipts; discover external posts only through the authorized account feed. Unsupported, unavailable, failed and genuine zero remain different states.

### Changes and evidence
- `services/internal/product/social_analytics.go` and `services/internal/social/tenantpublishing/analytics.go`: bounded collection, authorized provider attribution and real results.
- `services/ent/schema/platform_social_observation.go`, migration `20261102090000_platform_social_observation.sql`: unique workspace/kind/subject/day observations. Newer observations and current post metrics commit atomically.
- Provider adapters under `services/internal/social/integrations/social`: X reads followers and a bounded latest-original-post window; LinkedIn missing fields remain unavailable. Never invent historical percentage changes.
- Existing maintenance registration runs the collector; no second scheduler.

### Channel matrix
| Source | Stored result | Restriction |
|---|---|---|
| Supported account/post adapter | Actual dated series or named metrics | Token, scope and account eligibility required |
| Adapter with no metric support | Explicit unavailable observation | No fabricated zero |
| Provider read failure | Failed observation; bounded later retry | Does not invalidate publication |
| Posts created outside Shots | X latest 100 original posts within 30 days, deduplicated against Shots publication commands | Other providers without an observed-post feed remain explicitly unavailable |

### Acceptance criteria
1. Repeated/concurrent reads for the same day create one observation, with the newest result winning.
2. Failed reads retry after the bounded delay without overwriting a successful newer result.
3. Private sets and foreign workspaces remain invisible in dashboards and best-time calculations.
4. Publication age uses the confirmed publication timestamp, not draft creation or a fabricated default.
5. Shots post metrics require a confirmed publication receipt; external discovery requires an attributed provider feed result and never invents a scheduling command.

### Failure behavior
Provider failure is visible as a failed read; unsupported metrics remain unavailable. A batch continues across independent accounts. The collector never changes a publishing state or initiates publication.

### Verification and observability
PostgreSQL analytics tests cover attribution, daily uniqueness, concurrent replacement and unavailable results. `social_analytics_temporal_integration_test.go` executes the actual maintenance workflow twice on local Temporal/Postgres with a provider HTTP fixture. This proves scheduling/persistence, not live provider metrics. Observe worker counts, observation status and timestamps without credential/body logs.

## WI-ANALYTICS-2: Analyze and export a channel

**Source:** TF-003, TF-044, TF-065. **Gap:** Missing connected dashboard history/export. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** WI-ANALYTICS-1.

### Changes and scope
`components/write/analytics.tsx`, `components/write/account-metric-charts.tsx`, `lib/write/analytics.ts` render channel/date scope, weekly/monthly UTC buckets, post metrics, account observation charts, accessible tables and CSV. `app/[locale]/write/analyze/page.tsx` reads through the backend SDK; the web never reads Postgres. A date range is inclusive and limited to 366 days.

Account gauges and overlapping windows use the last reported value in a period, separately per connection. Post buckets use the latest cumulative reading for each post, explicitly labeled as snapshots rather than engagement earned in that week. Charts omit missing points. Profile-to-follower conversion is explicitly unavailable because the adapters do not supply that attribution.

### Acceptance criteria
1. A stored zero renders zero; a missing metric renders unavailable.
2. Weekly/monthly aggregation never sums daily cumulative follower totals.
3. The chart and table expose the same period/date/value and account identity.
4. CSV escapes quotes, newlines and spreadsheet formula prefixes and respects current filtering.
5. Reload and direct links preserve server date scope and tenant access.

### Failure behavior
An invalid range produces an actionable date error. No observations yields an explanatory empty state; read failures remain visible in row status. Unsupported profile conversion is not inferred by dividing unrelated totals.

### Verification and observability
`test/write-analytics.test.ts` tests aggregation, date bounds, zero/unavailable and CSV. `test/e2e/typefully-workitems.spec.ts` exercises stored observations, period selection, export and reload using explicitly labeled storage fixtures. Account charts, weekly/monthly switching and CSV passed browser assertions; the continuous lifecycle also verified maintenance-ingested metrics after actual local-worker publication. Use observation timestamps and status counts to diagnose stale charts.

## WI-ANALYTICS-3: Explicit, revocable public analytics

**Source:** TF-004. **Classification:** Exists: scoped public read and revoke passed the combined browser suite. **Priority:** Reopened. **Size:** M.

The current `develop` implementation adds an explicit per-account sharing control in `components/analyze/AnalyzeWorkspace.tsx`, backed by `services/internal/product/analytics.go`. This supersedes the earlier deferral. Sharing is off until an authorized member enables it; a public draft-review token is never an analytics grant.

**Dependencies and affected layers:** Existing connected-account analytics, the account's sharing settings, `lib/api/contracts/plan-analyze.ts`, authenticated settings routes and the separate public analytics token route. No account credentials or mutation controls enter the public report.

**Acceptance:** An authorized member enables sharing, opens the scoped report without a session, and revokes it. The previous URL then refuses access. Unsupported metrics remain unavailable. Draft-review links, other workspaces and private accounts cannot confer a public sharing grant.

**Failure and verification:** Revoked or unknown tokens return an unavailable state with no stale private report. `services/internal/product/plan_analyze_test.go` verifies scope and revocation; `test/e2e/plan-analyze.spec.ts` exercises enabling, public reading and revoke. Existing analytics audit events identify setting changes. Provider ingestion remains separately gated and is not certified by sharing a stored fixture.

## WI-ANALYTICS-4: Save a personal accent beside analytics access

**Source:** TF-003 ([requirements](../changelog-features.md)). **Gap:** Missing app accent preference. **Priority:** Reopened. **Size:** S.
**Depends on:** Existing personal preferences, Go/Ent and platform shell.

### Problem, changes and scope
A person can choose an app accent without changing teammates' preferences or exported artwork. `components/settings/AccentColorSettings.tsx` uses the existing preference save/error flow. `components/settings/PreferencesProvider.tsx` applies the color to workspace controls. `lib/settings/accent.ts` chooses black or white text by contrast. Go validates empty or six-digit hex and persists `accentColor`; the additive `20261102094000_platform_accent_color.sql` preserves all existing preference values and defaults to the standard palette.

### Acceptance and failure behavior
Apply, reload and reset the accent. A refused save restores the prior accent and reports failure. Cross-member preferences stay independent; stale versions conflict. Invalid CSS values cannot enter the property. Existing colors remain until a user explicitly chooses an accent.

### Verification and observability
`test/e2e/typefully-appearance.spec.ts` passed real save/reload/reset and refused-save restoration. `test/settings-accent.test.ts` verifies AA contrast over 4,096 sampled colors. `services/internal/product/user_accent_integration_test.go` passed persistence, member isolation, invalid values and stale-version rejection. Migration upgrade checks preserve an existing light theme/version while adding an empty accent. Existing preference audit/version fields identify updates; no new telemetry service.
