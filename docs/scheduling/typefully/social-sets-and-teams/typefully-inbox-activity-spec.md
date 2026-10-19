# Typefully Inbox and Activity — functional reverse engineering

Inspected October 13, 2026 in authenticated desktop Chrome. This is a behavioral specification, not a private API or source-code reconstruction.

**LIVE** means directly inspected. **DOC** means official written guidance. **PROPOSED** means an implementation recommendation. The account's Inbox, Activity, and Archive were empty. A populated per-draft Activity timeline was available and inspected. No comments, messages, notifications, or audit events were deliberately generated for this task.

## 1. Three concepts that must remain separate

| Surface | Scope | Function |
|---|---|---|
| Inbox | Personal notification surface | Collaboration-related updates |
| Activity notification tab | Account/publishing events | Operational notifications |
| Draft Properties → Activity | One draft | History of changes to that draft |

Archive is a third tab in the global notification panel. It is not a draft-history tab. Notification preferences are a separate settings surface that controls delivery channels and event categories.

The global Activity feed and the draft Activity timeline share a label but have different resources and layouts. A reconstruction should not place all draft edits into the account notification feed merely because both surfaces say Activity.

## 2. Global entry and layout

**LIVE:** A small tray/inbox-style icon sits in the top-left application chrome between Search & Commands and Toggle Sidebar. Its button lacked an accessible name in the inspected tree. Clicking it opens a tall floating panel over the current page.

At the earlier 1,156-pixel-wide viewport, the panel was approximately 360 pixels wide, anchored below the upper-left navigation controls. It overlapped the sidebar and left part of the main content, with a rounded white surface and shadow. It did not replace Analyze or change the route.

The panel header contains Inbox, Activity, Archive, and a sliders/settings icon. The three choices act as a single selected tab group even though accessibility exposed checkbox-like states and the DOM exposed pressed buttons. The selected tab has a highlighted segmented-control treatment.

Opening the panel initially selected Activity. That is the observed session state, not proof that Activity is the universal default for new users.

## 3. Tab behavior and empty states

**LIVE:** Inbox, Activity, and Archive were each selected. After loading, each showed No notifications. No rows, count badge, bulk action, search field, pagination control, or category filter was visible in these empty states.

Archive initially had a blank body during a transition. A later reopening showed its completed empty-state message. A reconstruction should distinguish loading from empty and avoid declaring “no notifications” before the query resolves.

The selected Archive tab survived closing the panel, opening settings, navigating to Write, inspecting a draft, and returning to Analyze within the same session. It was then restored to Activity, the initial selection. Persistence across page reload, a new browser, or another device was not tested.

Escape closed the panel and returned focus to the application. The background page remained available after dismissal. No notification was archived or marked read, because none was present.

## 4. What is known about populated notification rows

The actual populated global list was not observed. Therefore these details are unknown:

- Row layout, avatars, excerpts, timestamps, grouping, unread styling, badges.
- Whether opening the panel automatically marks notifications read.
- Whether row click both navigates and marks read.
- Per-row archive, restore, dismiss, or mark-unread actions.
- Bulk archive/mark-read controls and their empty-state visibility rules.
- Whether Archive contains all kinds of notification or only selected types.
- Pagination, retention, ordering, deduplication, real-time refresh, and read-state synchronization.
- Exact filters by social set or team, and behavior after access is revoked.

Archive's label is evidence that the category exists. It is not evidence of delete/restore semantics. Those should not be invented as verified behavior.

## 5. Notification-settings navigation

**LIVE:** Clicking the sliders icon in the notification panel closed the panel and opened the Settings modal directly on Notifications. The underlying Analyze route remained unchanged.

The settings sidebar included Your user, Notifications, Appearance, Billing, Install, Agents & Integrations, API, Experimental, Social Sets, and New team. These are neighboring destinations, not notification categories.

The Notifications page contains a delivery section followed by a category matrix. The current account had:

| Delivery surface | Observed state |
|---|---|
| Email | Account email displayed; Change button; master switch on |
| Slack | BETA label; DM explanation; Connect button |

The email address is omitted here because its specific value does not affect feature reconstruction. Change and Slack Connect were not pressed. No notification preferences were changed.

## 6. Preference matrix

**LIVE:** The current unconnected-Slack state showed an envelope/email column. It did not display an active Slack preference column in the observed matrix.

Comments had a group-level checkbox and three child preferences:

| Comment event | Observed email selection |
|---|---|
| Replies to your comments | On |
| New comments on your drafts | On |
| Mentions in comments | On |

The Comments group checkbox was on. Its exact partial-selection behavior was not tested.

Activity then listed all six personal social sets. Each group had an avatar/name, a group checkbox, and three event rows:

| Account event | Observed selection for every listed set |
|---|---|
| Post published | Off |
| Auto-retweet published | Off |
| Auto-plug published | Off |

The account-group checkboxes were also off. These are this account's observed settings, not a claim that every user's defaults are the same.

The matrix showed the auto-retweet and auto-plug labels even under sets currently containing LinkedIn rather than X. This demonstrates that settings presentation is not sufficient evidence that each event can occur on every connected provider.

Several checkboxes were unnamed in the accessibility tree, making screenshot confirmation necessary to identify their associated text and grouping. A comparable implementation should label both the event and its account/channel context for assistive technology.

## 7. Documented event and Slack DM semantics

**DOC:** Personal notifications cover new draft comments, replies, and mentions. Account events cover published posts, auto-plugs, auto-reposts, and publication failures. The Slack guide says failure alerts are always sent, while normal event delivery is configurable. Each member connects Slack individually; permissions are `chat:write` and `users:read`. A master control and per-event preferences exist; expired authorization offers reconnect. Self-manual publication does not notify its actor, while scheduled/automatic events can. Slack DMs are available across plans. The guide says connecting Slack auto-enables post-published alerts when the user has fewer than five sets. [Slack Notifications](https://support.typefully.com/en/articles/14298866-slack-notifications)

These rules were not tested end-to-end. In particular, the wording about mandatory failure alerts does not fully specify precedence against a master-off setting or a disconnected Slack channel. Do not infer that a delivery system can send to an unavailable channel.

The current app uses Auto-retweet while newer written material may say Auto-repost. Treat this as terminology drift around an event family until provider-specific rules are verified.

## 8. Slack DMs versus Slack channel notifications

The inspected settings entry explicitly describes DMs. That is a user-level connection. It should not be mistaken for posting to a team's shared Slack channel.

**DOC:** The team publishing integration can notify a chosen Slack channel when posts go live. Configuration is in Team settings, with a team channel or per-social-set destination and a per-draft opt-out. This is distinct from personal DM delivery. [Notify Slack Channels on Publish, in the official changelog](https://typefully.com/changelog)

No Slack authorization was initiated, no workspace selected, no channel configured, and no test message sent. The initial Connect button alone does not establish its requested OAuth scope set; the scope information above is attributed to the DM help article, not inferred from the button.

## 9. Comments as an Inbox event source

**LIVE:** The sample draft had a Show comments control. Opening it displayed an empty comments area prompting text selection or feedback-link sharing. A separate Share & Collaborate dialog contained Public link, off, and Internal link, with Only you can access for this private draft.

No text was selected for a new comment and nothing was submitted. The user-facing prompt establishes an inline-comment entry path without testing notifications.

**DOC:** Shared draft links let visitors see draft content and existing comments; commenting requires a free Typefully account. Comment stacks support replies, deletion, and resolution. Comments can originate from a text selection, a post's comment icon, or the documented keyboard shortcut. Draft feedback is not included in the published social post. [Share Your Drafts & Get Comments](https://support.typefully.com/en/articles/8717356-share-your-drafts-get-comments)

**DOC:** Teammate mentions use @ in comments. Comments support formatting such as bold, italic, lists, and quotes, with a drawer treatment on mobile. [Mentions and Slack update](https://typefully.com/changelog/mention-teammates-and-slack-notifications-136)

Mention targeting, self-mention suppression, resolving a comment's effect on Inbox, deleted-comment notification behavior, and external-reviewer visibility were not tested.

## 10. Draft Activity location

**LIVE:** In Write, Toggle Info Sidebar opened Draft Properties on the right. It contained draft title, tags, scratchpad, draft ID, word count, character count, reading time, and then Activity.

The Activity content arrived after the first sidebar snapshot. Opening Comments happened during that delay, but the screenshot showed Activity in Draft Properties. Comments are not the location of the audit timeline and were not proven to trigger its loading.

This distinction matters for reconstruction: the metadata sidebar owns the visible history section. The comments area is a separate surface that can be open beside it.

## 11. Populated draft timeline

**LIVE:** The existing sample draft showed two timeline entries:

- An actor avatar and short actor name followed by a 2 changes expansion control and relative time, approximately 54–56 minutes at inspection.
- Draft created with an older relative timestamp, approximately nine months.

Expanding 2 changes revealed two categories: X content and Numbering. The entry used a vertical timeline layout with a connector and bullet-like child items. The most recent visible event preceded the creation entry.

The timestamp rendered as a button. Clicking it produced no visible navigation or detail change. Exact-date tooltips, copying, and timestamp-format preferences were not established.

No full before/after text diff, restore button, version comparison, actor filter, event search, or export was visible in this inspected timeline. The change categories are not proof that Typefully stores or exposes complete historical document snapshots.

The existing event predates this request and includes work from the earlier editor inspection. This task did not edit the draft to manufacture activity. An audit record can remain even when a previous edit was undone; it should not be interpreted as proof of a current content difference.

## 12. Documented audit coverage

**DOC:** Draft Activity records who changed a draft, when, which areas changed—including content, tags, platforms, scheduling, and publishing—and the source. Automated work can carry API or MCP labels. The feature is described as available to team members. [Draft Activity release](https://typefully.com/changelog/draft-activity-130)

Only actor, time, grouped categories, and creation history were observed live. API/MCP badges, publication events, tag changes, and other actors were not present in the sample.

The UI's grouped “2 changes” does not reveal its coalescing algorithm. It could represent one save batch, a time window, or another grouping rule. Debounce intervals, append policy, retention, actor attribution during automation, and event delivery order remain unknown.

## 13. API and automation boundary

**DOC:** The v1-to-v2 migration guide lists Inbox/Activity notification reads and mark-read operations as unavailable in v2. Its v1 compatibility deadline was June 15, 2026, already past this inspection date. Do not use its old “continue using v1” advice as proof of current support. [API migration guide](https://support.typefully.com/en/articles/13133296-typefully-api-v1-v2-migration-guide)

**DOC:** Typefully's integration documentation describes webhook events for draft creation, publication, scheduling, status changes, tag changes, and deletion. [Typefully API overview](https://support.typefully.com/en/articles/8718287-typefully-api)

Webhooks are an automation channel; their existence does not establish an API for the in-app Archive or the full audit timeline. No private endpoints were probed and no API credentials were accessed. Endpoint availability should be checked against a current public reference before building an integration.

## 14. Proposed event architecture

The visible surfaces suggest separating at least four concerns:

```text
Domain event
  id, occurredAt, actor, source, resource, action, changedFields

Notification receipt
  eventId, recipientId, category, readAt, archivedAt

Delivery attempt
  receiptId, channel, destinationReference, status, retryCount

Notification preferences
  userId, channel, eventType, optionalSocialSetId, enabled
```

These are proposed fields, not recovered schema. Audit history is not a mutable notification receipt. Archiving an alert should not erase the event that explains who changed a draft. One event may produce many recipients and several delivery attempts.

For a comparable system, enforce access when creating a notification and again when opening its target. A stale notification may reference a moved set, deleted draft, or team the recipient has left. Return an intelligible unavailable-resource state without exposing content beyond current permissions.

## 15. Proposed delivery decision model

Recommended evaluation order:

1. Validate the domain event and its actor/source.
2. Resolve eligible recipients from current resource access and participation.
3. Apply event-specific suppression rules, including self-actions where appropriate.
4. Resolve channel connection and destination availability.
5. Apply documented preference and exception policy.
6. Create idempotent receipts and delivery jobs.
7. Record success/failure without duplicating the underlying audit event.

This order is a proposed implementation. The exact Typefully pipeline was not inspected. Mandatory failure alerts need an explicit precedence contract rather than ad hoc bypasses scattered across senders.

Use a stable event identifier for retries. A publication retry should not generate unlimited identical notifications. Store delivery failures separately from a failed social publication so the user can distinguish “post failed” from “alert could not be delivered.”

## 16. Proposed UI and accessibility requirements

Give the global trigger a descriptive accessible name, such as Notifications. Use a proper tablist or consistently named pressed controls. The settings icon should announce its destination. Account/category/channel checkboxes should each carry enough context to distinguish repeated names.

Represent loading, empty, failed, and permission-denied lists separately. Preserve the selected tab while loading without displaying another tab's rows under it. Provide keyboard focus restoration on dismissal. Keep unread count separate from archive count if both exist in the eventual design.

For draft history, label expandable groups with meaningful actions, expose timestamps as readable absolute values as well as relative display, and explain unknown automation actors. None of these recommendations proves the current product lacks every corresponding feature; only the unnamed controls were directly observed.

## 17. Final coverage and session state

Verified: global panel entry, all three tabs and empty states, same-session tab retention, notification-settings navigation, email master state, Slack connection entry, comment and per-set activity preferences, personal draft sharing off-state, comments empty state, Draft Properties timeline, grouped changes, and timestamp click behavior.

Not verified: populated notification rows, read/unread/archive mutations, outbound email or Slack, settings-save durability, invitation notifications, real-time subscriptions, team recipient expansion, audit retention, diff/version recovery, mobile interactions, or private implementation.

The global panel was closed with Activity restored as its selected tab. Draft comments and Info Sidebar were closed. The user's tab returned to Analyze for X Oppulence with the one-month range. No delivery settings, draft content, connections, teams, sharing controls, or publishing state were changed.

Companions: [Social sets](typefully-social-sets-spec.md), [Teams](typefully-teams-spec.md), [implementation checklist](typefully-social-teams-activity-checklist.md).
