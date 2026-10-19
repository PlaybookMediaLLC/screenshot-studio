# Typefully Plan + Analyze — implementation and verification checklist

Prepared October 13, 2026. Read with [Plan](typefully-plan-spec.md) and [Analyze](typefully-analyze-spec.md).

These are acceptance criteria for a comparable implementation, not a claim that 80 tests were run against Typefully. Evidence refers to the accompanying specifications. **Live** means the control or behavior was observed; **Doc** means vendor documentation; **Proposed** means engineering coverage still needed. Even a Live row may include edge cases not executed during inspection.

## 1. Scope and dependency order

1. Establish social-set identity, provider capabilities, content identity, and permissions.
2. Implement distinct draft, planning, and publication responsibilities.
3. Build calendar views and read queries before enabling mutations.
4. Add creation, placement, and publication actions with validation and recovery.
5. Build analytics loading/empty/unsupported/error states before filling charts with data.
6. Add post statistics, grouping, time-of-day views, exports, and optional sharing.

Avoid treating visual similarity as functional parity. Calendar placement can cause a future external publication; analytics errors can produce false reports. Their state contracts matter as much as the layout.

## 2. Calendar acceptance criteria

| ID | Acceptance criterion | Basis |
|---|---|---|
| P01 | Plan opens the calendar while retaining the shared application navigation. | Live |
| P02 | Identically named X and LinkedIn accounts remain distinguishable. | Live |
| P03 | All-account selection shows every selected set without mixing identities. | Live |
| P04 | Account focus selects only that set and exposes a return to all. | Live |
| P05 | Group checkbox reflects all, none, and mixed selections correctly. | Live |
| P06 | Individual checkboxes can form an arbitrary subset. | Live controls; result coverage needed |
| P07 | Draft sidebar mode can be entered and exited without losing calendar context. | Live |
| P08 | Drafts and Posted sources are visually distinct. | Live |
| P09 | Cards show source identity, snippet, and recency without requiring an editor. | Live |
| P10 | Flex adapts to viewport space without claiming off-screen overscan is visible. | Live |
| P11 | Month includes adjacent-month cells and a recognizable current date. | Live |
| P12 | Week provides seven day columns and hourly placement. | Live |
| P13 | View switching preserves a sensible date anchor. | Live partial; boundary tests needed |
| P14 | Previous/next labels and increments match the selected view. | Live controls |
| P15 | Today restores the appropriate current period. | Live control; action test needed |
| P16 | Status, platform, and tag filters do not overwrite account selection. | Live controls; Proposed interaction |
| P17 | An unavailable tag list differs from a filter returning zero matches. | Live empty state; Proposed distinction |
| P18 | Display density, provider icons, tags, and week-start controls exist. | Live |
| P19 | Single-account focus can reveal empty configured slots. | Live |
| P20 | Empty slots are not mistaken for real planned or scheduled content. | Live distinction |
| P21 | Multi-account display does not expose the single-account empty-slot setting. | Live |
| P22 | Display timezone and scheduling timezone remain separate values. | Live menu; Doc semantics |
| P23 | Changing display timezone does not alter publication instants. | Proposed |
| P24 | Quick composer receives the chosen date and account context. | Live |
| P25 | Quick composer exposes text, type, tags, date/time, and Open in editor. | Live |
| P26 | X content type choices include ordinary posts/threads and Article. | Live |
| P27 | Existing-content picker supports search and Drafts/Published sources. | Live |
| P28 | Plan and Schedule are separate actions and are disabled without selection. | Live |
| P29 | Closing the picker returns safely without committing content. | Live |
| P30 | Date picker identifies Today/selection, disables past dates, and shows zone. | Live |
| P31 | Quarter-hour suggestions do not accidentally establish undocumented minute restrictions. | Live list; Proposed validation |
| P32 | Empty-content, invalid-time, and disconnected-account errors are explicit. | Proposed |
| P33 | Planning and publication follow the documented state rules in Plan §12. | Doc; execute full lifecycle before parity claim |
| P34 | Moving, swapping, and Undo follow the documented contract in Plan §13. | Doc; not executed |
| P35 | Detail-panel operations enforce role permissions and preserve provider context. | Doc surface; Proposed enforcement tests |
| P36 | Stale edits and concurrent moves cannot silently overwrite newer work. | Proposed |
| P37 | Publication retries are idempotent and do not create duplicate external posts. | Proposed |
| P38 | DST gaps, repeated hours, zone changes, and month boundaries are deterministic. | Proposed |
| P39 | Multiple provider results can represent partial success without losing successful IDs. | Proposed |
| P40 | Mobile behavior and keyboard shortcuts are checked against the documented contract. | Doc; not executed |

## 3. Analytics acceptance criteria

| ID | Acceptance criterion | Basis |
|---|---|---|
| A01 | Analyze opens account-scoped analytics and shows the selected identity. | Live |
| A02 | Switching accounts never relabels stale results as current-account data. | Live selection; Proposed race test |
| A03 | LinkedIn uses an unavailable-feature state in the inspected product version. | Live |
| A04 | Unsupported, missing, loading, zero, and failed data have distinct representations. | Live states; Proposed normalization |
| A05 | Skeleton numbers are hidden from factual extraction and assistive announcements. | Observed problem; Proposed fix |
| A06 | Seven private overview areas match the inspected feature inventory. | Live |
| A07 | Compact totals retain full values for detail and accessibility. | Public |
| A08 | Percentage comparisons define baseline and zero-denominator behavior. | Public values; Proposed formula contract |
| A09 | Date preset choices match the observed list. | Live |
| A10 | One-month and one-year choices update the query and date labels consistently. | Live |
| A11 | Custom From/To inputs reject inverted or invalid ranges. | Live controls; Proposed validation |
| A12 | Cards, chart, table, and export share one explicit account/date scope. | Proposed |
| A13 | Expanded chart provides Overview navigation and metric-specific controls. | Live |
| A14 | Daily, Weekly, and Monthly grouping works across applicable ranges. | Live menu; full aggregation tests needed |
| A15 | Follower cumulative mode is distinct from interval growth. | Live switch; computation test needed |
| A16 | Valid zero series render without becoming an unavailable state. | Live |
| A17 | Missing impressions data cannot crash the complete analytics route. | Observed failure; Proposed fix |
| A18 | Metric help links lead to the relevant definitions. | Live links |
| A19 | Metrics and freshness rules follow the documented definitions in Analyze §8. | Doc; not measured |
| A20 | Time-series aggregation does not sum cumulative follower totals. | Proposed |
| A21 | Hourly Avg, Days, and Heatmap are separate modes. | Live |
| A22 | Days exposes seven weekday choices and maintains a selected day. | Live |
| A23 | Heatmap provides 24 hour positions for each weekday. | Live |
| A24 | Heatmap drilldown resolves the intended cell's posts and date context. | Live explanatory control; not executed |
| A25 | Insufficient engagement history does not produce a confident best-time claim. | Live empty state; Proposed recommendation rule |
| A26 | Goal setup separates Daily/Weekly cadence and weekend handling from submission. | Live |
| A27 | Cancelling goal setup leaves the prior configuration intact. | Live exit; persistence test needed |
| A28 | Empty post lists show explanation and disable list export. | Live |
| A29 | Populated rows expose counters, relative time, provider link, and thread markers. | Public |
| A30 | Thread roots and continuation rows are not double-counted by an assumed rollup. | Public structure; Proposed aggregation test |
| A31 | Sort menu supports the observed main and additional metric choices. | Live |
| A32 | Header sorting and menu sorting stay consistent across pagination. | Public controls; Proposed behavior test |
| A33 | Post action metrics belong to the selected row, with correct external destination. | Public |
| A34 | CSV scope, headers, precision, encoding, and escaping are verified from actual files. | Controls observed; download not tested |
| A35 | Chart export and post-list export have independent availability. | Live |
| A36 | Public analytics remains private until the explicit enable operation. | Live off-state; enable/revoke not tested |
| A37 | Public page excludes private workspace controls and honors revocation. | Public layout; Proposed revocation test |
| A38 | Chart Share opens image editing without silently enabling public analytics. | Live |
| A39 | Image controls preserve crop, color, frame, inset, radius, shadow, gradient, rotation. | Live controls; output not tested |
| A40 | Retry/reload recover failures without requiring logout or losing unrelated work. | Live recovery; Proposed scoped-error improvement |

## 4. Observed defect and uncertainty register

| Finding | Evidence | Practical implication |
|---|---|---|
| Impressions expansion crashed private analytics | X Oppulence; undefined `.map`; reload recovered | Add missing-series regression test and local error boundaries |
| Placeholder values appeared in accessibility text | Private/public loading states; screenshot mismatch | Never report them as account metrics; hide decorative numbers accessibly |
| LinkedIn analytics unavailable | Dedicated coming screen | Capability gating must precede metrics rendering |
| Private accounts had no populated rows | Empty across the inspected year | Public page fills table coverage, not private owner actions |
| Quick composer labels differ from some documentation | Current Plan draft vs documented Create draft | Follow live labels; use docs for explicitly marked semantics |
| Display timezone differs conceptually from account zone | Current menu and current scheduling guide | Older “all times use account timezone” descriptions need this qualification |
| Public API planning parity cannot be assumed | Current Planned Posts help article | Verify supported integration contract before implementing automation |

The first row is an observed product failure. Other rows are evidence limits, product capabilities, or documentation differences; they are not all bugs.

## 5. Proposed service boundaries

This is a suggested architecture, not Typefully's internal API.

| Boundary | Input | Output / invariant |
|---|---|---|
| Calendar read | Range, display zone, visible sets, filters | Content placements and separate available slots |
| Calendar placement | Content ID, target instant, expected version | New placement or explicit conflict |
| Publication command | Content ID, action, instant, caller permission | Idempotent job/transition result |
| Account capability read | Set/provider | Supported analytics and publication actions |
| Analytics read | Account, provider, range, grouping | Typed values, availability, coverage, freshness |
| Post analytics read | Scope, sort, cursor | Stable rows and pagination metadata |
| Export | Explicit query snapshot | Reproducible file corresponding to that scope |
| Sharing configuration | Account, explicit enable/revoke action | Public-access state with auditable change |
| Chart image generation | Chart snapshot and presentation settings | Preview/artifact with a separate next action |

Do not infer that a Typefully private endpoint exists for each boundary. Do not use guessed internal endpoints as an implementation plan.

## 6. Minimum fixtures for parity testing

Use a dedicated test workspace with two identically named social sets, two timezones, X and LinkedIn capabilities, an empty account, a populated account, and an unsupported provider. Add undated drafts, placed plans, scheduled items, published roots/replies, failed publications, and one cross-provider partial failure.

Analytics fixtures should include zero counters, absent fields, a newly connected account, incomplete older history, high counts requiring abbreviation, identical sort values, zero impressions with engagements, follower decreases, a two-post thread, and a DST boundary. Test user-authored text beginning with spreadsheet formula characters in exports.

Use reader, editor, publisher, and administrator roles. Test mutation permissions at the service boundary, not merely by hiding buttons. These fixtures and tests were not created in the user's production account.

## 7. Session handoff

The inspection stopped before commit actions. No calendar post was created or moved; no publication was scheduled; no goal was submitted; no public analytics switch was enabled. The chart image preview was closed before Create. CSV file content remains unverified.

Final navigation state: Plan restored to Flex/all accounts; active user tab returned to X Oppulence Analyze, one-month overview. Temporary research tabs are not deliverables.

The specifications are sufficient to define a reconstruction backlog, but they do not prove complete parity in publication, permissions, exports, or unavailable-data edge cases. Resolve those explicit gaps with a disposable test workspace before declaring an implementation equivalent.
