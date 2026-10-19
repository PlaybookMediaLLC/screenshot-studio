# Typefully Analyze — functional reverse engineering

Inspection date: October 13, 2026. Authenticated route: `https://typefully.com/grow`.

This specification combines direct desktop interaction, a populated public Typefully analytics page, and official documentation. It does not claim access to private source code, internal API contracts, or database structures.

Evidence labels: **LIVE** = observed in the user's authenticated UI; **PUBLIC** = observed in Typefully's public example; **DOC** = official documentation; **PROPOSED** = a suggested implementation, not an observed internal design.

## 1. Functional scope

Analyze is an account-scoped analytics workspace with overview cards, expanded time-series charts, publication statistics, time-of-day engagement exploration, posting goals, CSV export controls, and sharing surfaces.

**LIVE:** It uses the primary navigation label Analyze, route `/grow`, and browser title Analytics | Typefully. The sidebar contains the same social-set identities as Write and Plan. Here the account controls are single-selection: choosing another account transfers the selected state rather than combining accounts.

The account identity in the main header links to the external provider profile. An Analytics platform control is present. Only the selected account's available platform was exposed in the inspected states; a set containing several analytics-capable providers was not available for testing.

Plan's all-account calendar is not evidence of an all-account analytics aggregate. No cross-account total, account-comparison chart, campaign report, or saved report builder was observed.

## 2. Platform support and unsupported state

**LIVE:** X accounts opened the analytics dashboard. Selecting LinkedIn Oppulence opened a dedicated unavailable-feature screen with the heading “LinkedIn analytics are coming,” an explanation that impressions, engagement, and growth are being developed, and an Upvote to be notified button.

The button was not clicked. This is a feature-availability state, not a zero-data analytics report. A comparable implementation needs a capability check before rendering metrics.

This finding is narrower and more reliable than inferring coverage from marketing language about multiple social platforms. LinkedIn publishing support does not establish LinkedIn analytics support. Bluesky, Threads, Mastodon, and Substack analytics were not inspected in the authenticated account.

## 3. Evidence contexts

Three contexts supplied different coverage:

| Context | What it established |
|---|---|
| X Oppulence | Overview, empty post list, chart controls, grouping, goals, image sharing, public-share switch, error state |
| X Solomon AI | Another account also had zero engagements and no post rows over the selected year |
| LinkedIn Oppulence | Feature unavailable / coming state |
| Public Typefully X stats | Real overview totals, chart data, populated post table, thread markers, per-post actions |

The public example is [Typefully's public analytics page](https://typefully.com/stats/typefully-typefully-vPV3m). It was reached through Typefully's own analytics material. Its metrics belong to Typefully, not the user's accounts. Counts below are time-bound observations, not a report on the user's performance.

## 4. Overview cards

**LIVE:** The authenticated overview exposes seven areas:

| Card | Inspected behavior |
|---|---|
| Followers | Expands into a chart; loaded value 1 for X Oppulence |
| Impressions | Expand control present; this account's expansion triggered an error |
| Published Posts | Expand control present; loaded value 0 |
| Profile Clicks | Expand control present; unavailable/loading-looking card in this account |
| Engagements | Expands into a chart; loaded value 0 |
| Hourly Engagement | Expands into Avg / Days / Heatmap views |
| Posting Streak | Opens goal setup; settled streak 0 days in the inspected state |

**PUBLIC:** The public page showed five overview cards: Followers, Impressions, Published Posts, Profile Clicks, Engagements. It did not show the authenticated hourly-engagement and posting-goal surfaces in the observed overview.

The loaded public one-month snapshot displayed 42.21K followers, 7.94K impressions, 8 published posts, 37 profile clicks, and 124 engagements. Some cards showed percentage changes, including 0.2%, 2130%, and 4033%. The exact comparison-period rule and denominator handling were not established.

Expanded public Impressions showed the exact total 7,940, while the overview abbreviated it. A reconstruction needs both a full numerical value and a presentation formatter.

## 5. Loading placeholders must not become reported metrics

**LIVE + PUBLIC:** Early accessibility snapshots exposed plausible numbers before data settled. Examples included 1,000, 20%, 9 AM, and a 14-day streak. Screenshots and later state reads showed loading/blurred placeholders or different settled values.

For X Oppulence, Followers eventually became 1, Engagements became 0, and the post list showed an empty-state message. Impressions and Profile Clicks retained placeholder-looking content in the inspected account.

This is a significant analysis constraint: extracting text alone can produce false performance claims. The placeholder content is not evidence of 1,000 impressions, a 20% change, a best time of 9 AM, or a 14-day streak.

**PROPOSED rendering contract:**

```text
loading       → skeleton, inaccessible as a factual metric
ready         → finite numeric value, including legitimate zero
insufficient  → explanation / missing-data marker
unsupported   → feature availability screen
failed        → error with scoped retry
```

Use an explicit status rather than truthiness checks. Zero must render as a valid number. Missing data must not be coerced to zero. Hide decorative placeholder numbers from assistive technology so they cannot be announced or exported as facts.

## 6. Date range controls

**LIVE:** A preset control and separate From / To buttons appear with both overview and chart states. The presets are:

- 7 days, 14 days, 1 month, 3 months, 6 months, 1 year.
- Current week, Last week, Current month, Last month.

The observed one-month range was September 14–October 13, 2026. One year was October 14, 2025–October 13, 2026. Selecting one year changed the URL to `/grow?d=1y`; restoring one month produced `/grow?d=1m`.

This establishes a URL representation for these presets. It does not establish parameter names for custom dates or every other control. From and To are explicit buttons, but their custom-date interaction and validation were not exercised.

The chosen year range and expanded Engagements view survived account switches during the session. Returning to the route from Plan also retained this view state. Storage location and persistence across reload/login were not identified.

**PROPOSED:** Use one query object for the cards, chart, and post list. Cancel or ignore stale results after rapid account/range changes. Avoid allowing a previous account's chart to remain visibly labeled as the new account while loading.

## 7. Expanded chart anatomy

**LIVE:** Followers and Engagements showed:

- Overview back button.
- Metric label, with contextual help links on inspected metrics.
- Full numerical heading.
- Grouping control or label.
- Chart-specific Download as CSV.
- Chart-specific Share.
- Chart axes and plotted series.
- Shared date range and post list below.

Followers also exposed a Cumulative switch, initially on. Daily and Weekly appeared in its grouping menu for the one-month interval. After selecting one year, grouping became Monthly and the choices included Daily, Weekly, and Monthly.

This establishes adaptive default grouping for the inspected transition. It does not establish the complete threshold table for every date range, whether a manual grouping overrides future defaults, or the precise bucketing timezone.

The Engagements year chart rendered a zero line. A hover tooltip showed a month with Engagements 0. A valid zero series was therefore distinguishable from the unavailable impressions surface.

**PUBLIC:** Expanding Impressions worked on Typefully's populated page. It displayed a daily chart with dates and numerical axis labels. The grouping there was a Daily label, and no authenticated chart Share button appeared in that observed expanded view. Public and private chart controls should not be assumed identical.

Published Posts and Profile Clicks have overview expand controls, but their detailed private chart behavior was not tested. Do not claim they share every Followers option, particularly Cumulative.

## 8. Metric definitions and data freshness

**DOC:** Analytics support X, excluding community posts. Impressions count views. Engagements sum likes, reposts, replies, profile clicks, and link clicks; media views/opens are excluded, so totals can differ from X. Engagement rate is engagements divided by impressions. Profile conversion is new followers divided by profile visits, an approximate measure with limited attribution and initial missing history.

Followers refresh every 45 minutes. X posts import every two hours. Post statistics refresh hourly during the first two hours, every six hours within two days, and once more on day three. Posts can originate in Typefully or directly on X. Missing older history may require support assistance. [Analytics Page & Metrics](https://support.typefully.com/en/articles/8718148-analytics-page-metrics)

The above are vendor-documented rules, not timings measured in this session. Profile conversion was documented but was not a separate card in the observed current overview. Do not add it to the visible dashboard solely because the help page defines it.

**PROPOSED:** Store raw counters separately from derived rates, retain collection timestamps, and expose freshness independently of publication time. Use null for undefined rates when impressions are zero unless a deliberate product rule specifies another representation. The observed UI alone does not establish that denominator rule.

## 9. Hourly engagement

**LIVE:** Clicking Hourly Engagement opened three modes with New York GMT-04:00 shown as timezone context:

| Mode | Visible contract |
|---|---|
| Avg | Engagement by hour across an average day |
| Days | Hourly engagement for a selected weekday; Mon–Sun controls |
| Heatmap | Weekdays against 24 hourly positions; cell-oriented exploration |

Monday was selected in Days. The account lacked enough data and displayed a message asking the user to check back in a few weeks. This is an insufficient-history state rather than a chart proving that every hour performs equally.

Heatmap displayed weekday rows and hour columns from 0 through 23. Its explanatory text said a cell could reveal tweets that received engagement at that time. No cell drilldown was executed because this account lacked useful data.

The exact calculation, minimum-history threshold, weighting of old posts, normalization, timezone conversion, treatment of DST, and heat intensity scale are unknown. A builder must not invent a statistically precise “best time” formula and attribute it to Typefully.

**PROPOSED:** Keep the underlying engagement-time matrix separate from its color mapping and recommendation algorithm. The matrix should retain sample counts so a dark cell with few observations does not imply a robust recommendation. This is an implementation recommendation, not observed functionality.

## 10. Posting streak and goal setup

**LIVE:** The streak surface opened a setup dialog headed Grow faster with streaks. It offered Daily and Weekly choices, a Don't count weekends switch initially on, and Set this goal.

No goal was submitted. This establishes a setup flow, not the full streak rules. Required post count, grace periods, timezone cutoffs, whether replies count, reset rules, goal editing, reminders, and historical backfill were not tested.

The streak belongs to a motivation/consistency feature alongside analytics. It should not be confused with engagement performance or a promise of follower growth.

**PROPOSED:** Separate goal configuration from computed progress. Persist goal mutations only after the explicit submit action; opening the modal should not create a goal.

## 11. Post list — empty state

**LIVE:** The bottom section is headed Posts and contains All and Replies choices, a CSV button, and sorting controls. On the inspected empty X accounts it displayed “No posts found for the selected time period.” The post-list CSV action was disabled.

At the same time, a zero-valued expanded Engagements chart had its own enabled CSV button. These are separate export scopes and enablement conditions. The disabled list export does not mean every analytics export is disabled.

All and Replies are rendered as checkbox-like controls, but their exact mutual-exclusion rules were not tested. The UI label All alone is insufficient to prove whether replies are included, excluded, or combined with another filter.

## 12. Post list — populated state

**PUBLIC:** Typefully's public example supplied real rows. The visible columns were Post, Impressions, Likes, Replies, Reposts, Bookmarks, and Eng. rate. Each header exposed a sort action.

A row contained:

- External View published post link.
- Content excerpt with active links.
- Relative publication time.
- Optional Thread marker and post count.
- Numeric counters, with compact display for larger values.
- Engagement rate formatted as a percentage.
- Post actions menu.

One thread row displayed Thread · 2 and 1.3K impressions; its accessible metric text preserved 1,253. Another showed Thread · 3. Individual continuation posts also appeared separately in the visible table, so it would be incorrect to assume every row represents an entire aggregated thread.

The inspected Post actions menu included View on X and a More stats area with Total engagements, Quotes, and Profile clicks. Those values belonged to the selected row. No edit or delete operation appeared in that public menu.

Private owner-specific post actions could differ. The user's empty accounts could not establish those actions. Pagination, infinite scrolling, row expansion, unavailable/deleted-post behavior, and media previews were not fully exercised.

## 13. Sorting and metric selection

**LIVE:** The sort menu contained Latest, Impressions, Likes, Replies, Reposts, Bookmarks, and Engagement rate. A More stats grouping contained Total engagements, Quotes, Profile clicks, and Link clicks.

**PUBLIC:** Column headers also exposed direct sort buttons. The default menu label was Latest.

Sort direction toggling, tie-breaking, additional-column behavior after choosing a More stats option, and pagination consistency were not tested. A reconstruction should separate sort key, sort direction, and displayed columns, rather than assuming one selection necessarily changes all three.

## 14. CSV exports

**LIVE + PUBLIC:** Chart-level and post-list Download as CSV controls exist. A populated public post list enabled its export. The empty private list disabled it. Expanded charts can enable export for a valid zero-valued series.

No CSV file was downloaded in this inspection. Therefore, headers, encoding, delimiter, timestamp format, timezone, number precision, full-versus-visible row scope, and filename are unknown. These must remain explicit verification gaps.

**PROPOSED:** Export the selected account/range/filter scope consistently, include unambiguous timestamp semantics, escape spreadsheet formulas in user-authored text fields, and preserve full numeric precision. These are recommended build requirements rather than assertions about Typefully's existing output.

## 15. Public analytics sharing

**LIVE:** The header Share analytics control opened a Public analytics popover explaining link-based access. Enable public analytics page was off. It was left off; no public access was enabled.

**PUBLIC:** The example page had account identity, five metric cards, date controls, populated posts, CSV actions, and a Typefully promotional footer. It did not expose the private workspace's left navigation. The example URL contains a readable account component and a suffix; its construction and access mechanism were not reverse engineered.

The fact that the example is publicly shared does not justify exposing the user's account. In a reconstruction, public sharing must be an explicit account-scoped state transition. Revocation behavior, caching after revocation, selectable metric privacy, and search-engine indexing remain unverified.

## 16. Chart image sharing

**LIVE:** Chart Share is different from the header's public-analytics switch. Clicking Share on the Engagements chart showed Creating image, then an Edit Image modal with a preview and these controls:

| Control | Observed initial value |
|---|---|
| Color | `#174CC4` |
| Frame | 120 |
| Inset | 0 |
| Radius | 20 |
| Shadow | 60 |
| Gradient | 75 |
| Rotation | 0 |

The modal also had Crop, Close, and Create. A temporary chart preview carried Typefully branding. The units and slider ranges were not shown in the inspected accessibility output and must not be assumed.

The modal was closed without changing controls or clicking Create. The destination after Create—download, new draft, clipboard, or another step—was not verified. Clicking the initial Share button alone generated a preview; it did not visibly publish anything or enable the public analytics page.

## 17. Observed failure and recovery

**LIVE:** Expanding Impressions on X Oppulence replaced the analytics route with an application error boundary:

```text
TypeError: Cannot read properties of undefined (reading 'map')
first named stack frame: impressions
```

The recovery surface offered Try again, Reload Typefully, Reset Typefully (logs out), and Contact support. Try again did not visibly recover. Reloading the tab restored analytics. Reset and Contact support were not used.

This is one observed reproduction in this account/context, not a claim that all Impressions charts fail. The public Typefully Impressions chart worked. The evidence is consistent with an unhandled absent-data case, but source-level root cause was not established.

**PROPOSED remediation:** guard absent series, validate metric payloads, make individual cards/charts fail independently, and preserve navigation/account context. A missing impressions series should not crash the complete route. Add regression coverage for undefined, null, empty, and valid-zero series.

## 18. Suggested data and component model

**PROPOSED, not recovered internals:**

```text
AnalyticsQuery
  socialSetId, provider, from, to, timezone
  metric, grouping, cumulative, postScope, sort

MetricResult
  status, value, comparison, points[], collectedAt, coverageStart

PostMetrics
  providerPostId, sourceUrl, publishedAt, excerpt, threadMetadata
  impressions, likes, replies, reposts, bookmarks
  quotes, profileClicks, linkClicks, engagements, engagementRate

HourlyEngagementResult
  timezone, weekdayHourCells[], sampleCounts, availability

GoalConfiguration
  cadence, excludeWeekends, effectiveDate

PublicAnalyticsConfiguration
  enabled, publicIdentifier, visibilityPolicy
```

Use separate components for account capabilities, overview cards, date range, chart shell, metric renderer, grouping selector, post table, sort selector, hourly modes, goal setup, public-sharing controls, and chart-image editing. Separate fetching from rendering so a slow or invalid metric cannot invalidate the full dashboard.

The proposed model intentionally does not name private Typefully endpoints, tables, SDKs, chart libraries, or frontend frameworks. None were established through this inspection.

## 19. Coverage and session outcome

Verified directly: account switching, unsupported LinkedIn state, overview controls, date presets, one-month/year transition, grouping choices, follower cumulative control, zero engagement chart, hourly modes, goal setup, public sharing off-state, chart image editor, empty post list, populated public rows, post menu, sorting choices, and one error/recovery path.

Not verified: actual export files, custom date selection, setting a goal, enabling public sharing, Create from chart images, private populated-row actions, complete metric formulas beyond vendor documentation, live refresh timing, paid-plan gates, mobile UI, permissions across teams, or internal implementation.

The user's tab was returned to X Oppulence's one-month overview at `/grow?d=1m`. Plan was restored to Flex and all-account visibility. No post or schedule was committed, no goal set, and public analytics remained disabled.

Companion artifacts: [Plan specification](typefully-plan-spec.md), [implementation checklist](typefully-plan-analyze-build-checklist.md), [Write specification](../write/typefully-write-spec.md).
