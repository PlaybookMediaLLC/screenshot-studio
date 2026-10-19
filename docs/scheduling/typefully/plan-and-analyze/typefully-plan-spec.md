# Typefully Plan — functional reverse engineering

Inspection date: October 13, 2026. Surface: authenticated desktop Chrome, `https://typefully.com/calendar`.

This is a behavioral specification of the visible product, not recovered source code. **LIVE** means inspected in the application. **DOC** means stated in current official documentation but not executed. **PROPOSED** means an implementation design inferred from the behavior. No post was created, moved, planned, scheduled, published, or deleted during this Plan/Analyze inspection.

## 1. Product boundary

Plan is a calendar over content belonging to multiple social sets. A social set supplies account identity, provider connections, drafts, and scheduling configuration. The calendar adds dates, views, account selection, filters, and entry points into the writing and publishing workflow.

The important distinction is between assigning content a calendar position and committing it to automatic publication. These must be separate operations in an implementation.

**LIVE:** Plan is the middle primary navigation item between Write and Analyze. Its route is `/calendar`. Analyze uses `/grow`, and switches to a single selected social set. Plan can include several sets at once. Opening Plan from a LinkedIn account did not restrict the calendar to LinkedIn.

The inspected personal workspace had six entries, with three names repeated across X and LinkedIn. Therefore, names are insufficient identifiers. Account rows need an avatar, name, provider identity, and stable internal ID. The calendar should not confuse two identically named sets.

## 2. Screen structure

**LIVE:** The desktop screen has a fixed left navigation/sidebar and a calendar occupying the remaining width. In the observed 1,156-pixel-wide viewport, the sidebar was approximately 300 pixels wide.

The sidebar contains:

- Typefully menu, Search & Commands, and Toggle Sidebar.
- Write, Plan, Analyze.
- Workspace/group name, here Personal.
- Add-social-set action and an all-sets checkbox.
- A row per social set with identity, account focus action, draft-panel action, settings action, and visibility checkbox.
- Add social set, Create new team, Settings, Help, and a product update card.

The calendar header contains the visible period, Feedback, display timezone, Calendar filters, Display settings, view selector, previous-period control, Today, and next-period control.

The main content contains seven weekday columns. The form of the rows depends on the selected view. Dates before and after the focal month can appear as adjacent-month cells. Today's date receives a colored marker.

## 3. Account selection

**LIVE:** All six account checkboxes were checked in the initial calendar. Each row offered `Show only [name]`, `Show drafts for [name]`, and `Social set settings`. Checked visibility controls were labeled as an action to hide the corresponding account.

Selecting X Oppulence alone unchecked the other five accounts. The group checkbox became mixed/tri-state. The focused account exposed a way back to all social sets. This is a multi-selection model with a single-account shortcut, rather than six independent calendar pages.

A useful reconstruction has these independent values:

```text
visibleSocialSetIds: Set<SocialSetId>
draftSidebarSocialSetId: SocialSetId | null
workspaceGrouping: personal/team hierarchy
```

The draft sidebar and the calendar selection should not be conflated. Opening a draft list changes the sidebar surface; account filtering controls which content appears in the calendar. An Escape action during exploration returned the calendar to all-account selection; do not treat Escape as a harmless modal-only action without considering focus.

**Unverified:** selection persistence across fresh login, browser restart, or another device; handling of removed accounts; interactions across multiple teams.

## 4. Calendar views and navigation

**LIVE:** The view menu contains exactly these three current options:

| View | Menu shortcut | Visible behavior |
|---|---|---|
| Flex | F | Adapts the number of displayed weeks to available space |
| Month | M | A month arranged as day cells |
| Week | W | Seven day columns with hourly rows |

Flex initially displayed `Week of October 11`. Month changed the heading to `October 2026` and navigation labels to Previous month / Next month. Week showed October 11–17 with hourly labels spanning 12 AM to 11 PM. The week started Sunday in the inspected configuration.

Month included September 27–30 before October 1. Flex exposed dates outside the visible viewport in accessibility output; that does not prove that every returned week was simultaneously on screen. A reconstruction may virtualize or overscan rows, but the actual rendering strategy was not identified.

Today is a dedicated navigation button. Previous/next controls are contextual to the view. Switching views preserved the general date context during the inspection. Exact day anchoring when moving between views was not tested at month boundaries.

The three-view menu is current evidence. Older material describing other calendar layouts should not be used to add a current Kanban option without fresh verification.

## 5. Filters

**LIVE:** The filter menu has three categories:

| Category | Observed choices |
|---|---|
| Status | Planned, Scheduled, Published, Failed |
| Platform | Twitter, LinkedIn |
| Tags | Disabled empty state: no tags available |

Twitter and LinkedIn reflect the connected providers in this workspace. This is not proof that those are the only supported calendar platforms.

The controls expose a filtering surface, but populated-result behavior was not exercised because the calendar had no placed posts. The exact AND/OR semantics for multiple selected values, filter count badges, reset affordance, and URL persistence remain unverified.

**DOC:** Tags belong to a social set. The calendar gathers tags across visible sets; focused account scope narrows the options. Tag filters carry across calendar views. Calendar creation can assign or create tags. Display preferences are personal rather than changes for every teammate. [Tags & Metadata](https://support.typefully.com/en/articles/8717753-tags-metadata)

**PROPOSED:** Apply OR within one filter category and AND across categories unless product testing establishes different semantics. Represent an unavailable tag list separately from an active filter that happens to match no posts.

## 6. Display settings

**LIVE:** The menu exposed:

| Setting | Inspected state |
|---|---|
| Card density | Expanded selected; Compact alternative |
| Show platforms | Checked |
| Show tags | Checked |
| Week start | Sunday; Monday alternative |
| Show empty slots | Checked, available when one account was focused |

The empty-slot setting was absent from the all-accounts menu and appeared after focusing X Oppulence. With that account focused, weekday slots appeared at noon and 5 PM. These were this account's configured times, not a universal Typefully default. Each visible slot exposed an Edit schedule action.

Empty slots are not content objects. They are suggested calendar positions derived from an account schedule. They should remain distinguishable from a planned draft occupying a time and from a scheduled publication.

No display preference was deliberately changed other than selecting views for inspection. The view was restored to Flex at the end.

## 7. Timezone separation

**LIVE:** The header timezone button read New York. Its menu explicitly said Display timezone. It listed the user's New York timezone, the focused social set's New York timezone, GMT-04:00, and a Timezone settings entry.

The calendar date/time picker also displayed New York GMT-04:00. All inspected accounts happened to use the same visible timezone; a cross-zone shift was not executed.

**PROPOSED:** Maintain two separate concepts:

```text
socialSetSchedulingZone: IANA timezone
calendarDisplayZone: IANA timezone
plannedOrScheduledInstant: UTC timestamp
```

Render grid positions from the display zone. Resolve user-entered local publication times with an explicitly identified scheduling zone. Do not use a fixed offset as the authoritative timezone: New York's offset changes with daylight saving time.

Changing a display preference must not silently rewrite publication instants. A date boundary can change visually when zones change, so a post's source zone should remain available in its detail surface. These are implementation requirements, not claims about Typefully's private storage format.

## 8. Creating from an empty day

**LIVE:** Current and future day cells exposed Create draft. Historical cells did not expose that action in the inspected month. Clicking October 14 opened a quick composer with the selected date and a noon time.

The quick composer contains:

- Account selector with avatar and name.
- Drafts button for switching to existing content.
- Editable body area.
- Post-type menu.
- Tags menu.
- Date/time combo box.
- Open in editor checkbox, initially checked.
- Plan draft primary action.

For the selected X account, the type menu grouped Default → Post and X-specific choices → Post or Thread / Article. The presence of an Article option is verified; its validation and publication behavior were not tested here.

No text was entered and Plan draft was not submitted. Therefore, empty-body validation, autosave in this particular composer, default type persistence, tag creation, account-switch draft preservation, and the resulting editor navigation were not verified.

The UI wording was Plan draft. Some documentation uses Create draft for the same conceptual entry point. A faithful UI reconstruction should use the observed current label, with a separate behavioral contract for what creation does.

## 9. Choosing existing content

**LIVE:** Drafts opened a second modal headed Choose a draft. Its context line showed the destination date/time and account. It contained:

- Draft source choices: Drafts selected; Published available.
- Search field.
- Draft list grouped by edit recency, including Edited today.
- Snippet, provider icon, and relative edited time per item.
- Date/time control.
- Separate Plan and Schedule actions.
- Close.

Both actions were disabled until content was selected. The one available sample draft was listed. It was not selected or submitted. Clicking Close returned to the empty quick composer rather than necessarily leaving the whole calendar creation flow.

Published is a source option, but the handling of an already published item was not exercised. Do not assume that selecting it mutates the original post; duplication, reuse, and identity rules need a dedicated test.

This modal makes three choices explicit: which source content, which destination instant, and whether to plan or schedule. A reconstruction should not collapse its two commit buttons into one ambiguous Save action.

## 10. Date and time picker

**LIVE:** Expanding the picker showed a month calendar with previous/next month buttons, a selected date, a Today label, and disabled past dates. Below it was a Time list in 15-minute steps from midnight through 11:45 PM. Noon was selected. The bottom timezone button displayed the zone and offset.

The combo box was editable in the accessibility tree, but free-form date parsing was not tested. The 15-minute list is a suggestion granularity; it does not prove that arbitrary minutes are rejected.

**PROPOSED validation:** require a valid local date/time, resolve DST gaps and repeated times, prevent scheduling into the past, distinguish a past planned item from a failed publication, and display the resulting instant before commitment. Do not infer failure solely because a planning timestamp has passed.

## 11. Drafts sidebar

**LIVE:** Show drafts for X Oppulence replaced the account list with:

- Back to social sets.
- Workspace and account identity.
- Social set settings.
- Drafts and Posted tabs.
- Draggable content cards with snippet, provider, and edit recency.

The sample was marked draggable. Clicking it during inspection did not produce a visible editor transition. No drag was performed, so drop targets, pointer feedback, resulting status, and persistence were not directly verified.

A reconstruction should support browsing source content without losing the calendar context. The tab distinction also suggests that draft reuse and published-content reuse belong to this sidebar, but their exact commit semantics need verification.

## 12. Documented state semantics

**DOC, not executed:** Planned content has a date but does not publish automatically. Dashed cards distinguish it from scheduled content. Passing its date leaves it unposted and requires a new time before scheduling. Unschedule retains the date and returns content to planned; Remove date returns it to undated drafts. Planned content appears in Drafts, Queue, and the calendar, and occupies a posting slot. Edit permission allows planning; publish permission governs scheduling, unscheduling, and publication. The help page says planned status is not yet available through the public API or Zapier. [Planned Posts](https://support.typefully.com/en/articles/16213506-planned-posts)

**PROPOSED state representation:**

```text
draft:      content exists, no calendar commitment
planned:    content exists, calendar placement, no publish job
scheduled:  content exists, calendar placement, active publish job
published:  provider publication result recorded
failed:     attempted publication did not complete successfully
```

The labels Planned, Scheduled, Published, and Failed were visible in the filter. The representation above is a design proposal, not a recovered enum or database schema. Cross-platform partial publication could require child states; the inspected UI did not establish those rules.

## 13. Documented interactions not exercised

**DOC:** Moving a card preserves its publication state. Dropping onto another card from the same account swaps times, with Undo available. A content side panel supports provider previews, time changes, schedule controls, metadata, activity, duplication, copying, deletion, and editor navigation. Keyboard controls include V to cycle views, arrows for periods, and T for today. Mobile uses Queue. Scheduling uses the social set's zone even when calendar display differs. Suggested times use X engagement; optional natural timing varies publication by up to four minutes. [Scheduling and Calendar](https://support.typefully.com/en/articles/9210135-scheduling-and-calendar)

These behaviors were not executed because they require placed content or commit changes. Their interaction layouts, confirmation dialogs, errors, Undo duration, and persistence are still unknown.

## 14. Suggested implementation components

**PROPOSED:**

| Component | Responsibility |
|---|---|
| CalendarShell | Navigation, selected date, view, sidebar mode |
| SocialSetVisibility | Multi-selection, focus, group mixed state |
| CalendarQuery | Visible range, sets, status/provider/tag filters |
| FlexGrid / MonthGrid / WeekGrid | Date geometry and content placement |
| ScheduleSlotLayer | Available account times, separate from content |
| ContentCard | Identity, status, preview, provider/tag display |
| QuickComposer | New content with calendar context |
| ExistingContentPicker | Search/source selection and explicit action |
| DateTimePicker | Local date/time plus zone |
| CalendarDetailPanel | Inspect and act on placed content |
| CalendarMutationService | Plan/schedule/move operations with version checks |
| PersonalDisplayPreferences | Density, icons, tags, week start, timezone |

Keep UI preferences separate from account settings and publishing commands. A move operation should carry the intended original state/version to prevent a stale browser from overwriting a teammate's change. A publication command should enforce permissions server-side and be idempotent. These protections were not tested in Typefully; they are necessary engineering design choices for a comparable product.

## 15. Unknowns and remaining verification

The inspection did not establish network request shapes, internal endpoints, server jobs, schema, framework choices, persistence scope, rate limits, billing gates, mobile breakpoints, bulk operations, recurrence, approval chains, or campaign objects. No populated calendar card was available, so its exact text hierarchy and iconography were not observed.

Before claiming parity, test mixed-platform scheduled posts, same-time collisions, DST changes, network failure during moves, concurrent edits, permission downgrades, reconnect requirements, planned dates in the past, and partial publication failures. These are proposed coverage targets, not observed defects.

Companion artifacts: [Analyze specification](typefully-analyze-spec.md), [implementation checklist](typefully-plan-analyze-build-checklist.md), [Write specification](../write/typefully-write-spec.md), [Settings specification](../settings/typefully-settings-spec.md).
