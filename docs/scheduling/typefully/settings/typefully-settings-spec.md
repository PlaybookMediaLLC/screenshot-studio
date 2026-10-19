# Typefully settings: functional reconstruction

Inspected 2026-10-13 in the signed-in Typefully web app at https://typefully.com/.

This is a reconstruction from visible UI and navigation, not access to Typefully source code, database, or private API contracts. **Observed** means the control or rule appeared in the live interface. **Proposed** means a design for implementing equivalent functionality. No settings were saved, accounts connected, credentials created, teams created, subscriptions changed, or posts published.

## 1. Settings architecture

Observed: settings use a modal over the editor. Opening Settings from the main Typefully menu can restore the last visited nested settings section. A Social Sets back button returns from a specific set to the parent settings navigation. Inspected navigation kept the page URL at `/`.

```
Settings
├── Your user
├── Notifications
├── Appearance
├── Billing
├── Install
├── Agents & Integrations
├── API
├── Experimental
├── Social Sets
│   └── Selected social set
│       ├── General
│       ├── Scheduling
│       ├── New Draft
│       ├── Public Profile
│       └── Writing Assistant
│           ├── Style Guide
│           └── Writing Samples
└── New team
```

The central object is a **social set**: a collection of social accounts for a person or brand. It supports cross-posting and can be shared through a team. A social set is distinct from the signed-in user and from an individual social account.

## 2. Account-level controls

| Section | Observed controls and behavior |
|---|---|
| Your user | Avatar/name; notification email with Change; timezone selector with Detect; authentication provider identity; Change to Email; Log out; Log out all sessions; Reset help tooltips; Request Account Deletion. |
| Notifications | Global email enable switch; email Change; Slack beta with Connect for DM notifications; comment preferences; activity preferences grouped by social set. |
| Appearance | Desktop navigation: Always compact, Dynamic, Always expanded. Theme: Light, Dark, System. Calendar first day: Monday or Sunday. Editor direction: left-to-right or right-to-left. Show Scrollbars switch. Safari note says reload to see scrollbar changes. |
| Billing | Current plan; View all plans; Billing portal; Update payment method; Cancel subscription. Inspected account displayed Creator Yearly. |
| Install | Mac app download; mobile instructions to add the website to the home screen. |
| Experimental | Feature descriptions and switches. Realistic preview in sidebar and Substack Notes appeared under Promoted, enabled and disabled for editing. |

Notification events observed:

- Replies to your comments.
- New comments on your drafts.
- Mentions in comments.
- For each social set: Post published, Auto-retweet published, Auto-plug published.

The DOM also exposes extra checkboxes around the comment and social-set groups. These may be group selectors; their behavior was not tested. Do not assume their semantics from DOM order alone.

**Timezone separation is explicit:** the user's timezone is for notifications and display. The social set's timezone is for scheduling, slots, and its calendar.

Account deletion is presented as a deletion request. Immediate deletion, review, grace period, and recovery were not inspected.

## 3. Social-set management

Observed list behavior:

- Personal sets appear as individual rows with avatar, name, platform indicator, add-platform action, and settings action.
- A row can show “Some accounts need attention” and a Manage platforms action.
- New social set is a separate action.
- Multiple sets can have the same visible name in the inspected account. Implement identity using IDs, not names.

General settings contain:

- Editable name and color picker.
- Connected account identity, Reconnect, and Remove actions.
- Add social account and a shortcut to default draft platforms.
- Ownership/sharing status; a private set can be moved to a team.
- Delete social set in a Danger Zone.

The add-account picker for the inspected X-connected set offered LinkedIn, Mastodon, Threads, Bluesky, and Substack. Twitter was disabled. This is consistent with one connection per platform in a set, but that constraint was not proven by submitting a second account.

New team opens a name field and a Create team button that is disabled while the field is empty. The description says teams share social sets for writing, reviewing, and scheduling. Member roles, invitations, permissions, and paid-plan gates were not inspected.

## 4. Scheduling

Observed controls:

- Timezone selector with region/city, current UTC offset, and Detect action.
- Weekly table: time rows and Monday–Sunday columns.
- Per-day checkboxes for each time row.
- Delete action for each time row.
- Add-time selector offering 15-minute increments across the day.
- Summary count of weekly posting slots.
- Natural Posting Times switch for new drafts.

The inspected set had noon and 5 pm enabled Monday–Friday: 10 weekly slots.

Explicit rules in the UI:

1. Editing the weekly schedule does not affect posts already scheduled.
2. Natural posting times introduce a small offset of ±4 minutes.
3. The natural-time preference applies to new drafts and can be overridden while scheduling an individual draft.

Proposed implementation:

- Store a named timezone and recurring local wall-clock slots separately from scheduled draft timestamps.
- Resolve the next available slot at scheduling time, then persist the resulting instant on the draft.
- Count enabled day/time combinations, not just time rows.
- Preserve already assigned timestamps when the slot template changes.
- Use an explicit draft override for natural-time behavior. Do not recompute jitter on each page load or retry.
- Define and test daylight-saving transitions, slot collisions, empty schedules, and timezone changes. These edge cases were not exercised in Typefully.

## 5. New-draft defaults

Observed:

- Connected platforms can be enabled or disabled as defaults for new drafts.
- Platform rows have reorder controls.
- The first/primary platform syncs content to the other platforms, according to the panel description.
- A Primary badge identifies the primary platform.
- Connect more accounts is available from this panel.
- X engagement defaults include Auto-Retweet and Auto-Plug, each with an Enable action when disabled.

Proposed implementation: copy defaults into each new draft rather than dynamically binding all existing drafts to current settings. Store enabled platform order and the primary platform explicitly. Define how sync behaves after editing a secondary platform independently; the live UI description does not establish this conflict rule.

The inspected set had only X connected, so multi-platform reordering and synchronization were not behaviorally tested. Engagement timing/threshold forms were not opened by enabling the tools.

## 6. Public profile and AI writing preferences

Public Profile states that every social set gets its own public profile. The inspected profile exposed a Make profile public switch, currently off. Additional public-profile fields behind that switch were not inspected.

Style Guide and Writing Samples both showed the same prerequisite: set up Writing Assistant. Open Writing Assistant closes the settings modal and opens the assistant sidebar for the selected set. The sidebar introduces writing-style learning and provides Create Assistant. Creation was not triggered.

Proposed model: assistant setup status, style-guide content, and writing samples belong to a social set. Actual editor fields, sample limits, generation steps, and AI usage gates remain unknown.

## 7. Integrations, API, and webhooks

Agents & Integrations lists:

- Claude, ChatGPT, MCP, Agent Skills, and Notion Agents.
- Slack, Zapier, and Raycast.

These are integration entry points. Connection methods and permission scopes were not inspected.

API settings expose:

- API documentation and Discord links.
- API Keys section and New API Key action.
- Webhooks section and Add webhook action.
- Development mode: displays IDs for social sets, drafts, and media; also available through the command bar.
- Debug logging: stores logs in this browser; the UI warns that they may contain draft, account, and API data and affect performance.
- Download logs, Clear logs, and stored-log count.

The Add Webhook form was opened and cancelled. It contains Name, Webhook URL, event checkboxes, Select All, Cancel, and Add Webhook. Submission was disabled with empty fields.

Observed webhook events and meanings:

| Event label | UI description |
|---|---|
| Draft Created | A new draft is created. |
| Draft Published | A draft is published to social media. |
| Draft Scheduled | A draft is scheduled for later publishing. |
| Draft Planned | A draft is planned on the calendar. |
| Draft Status Changed | A draft changes status, such as scheduled to published. |
| Draft Tags Changed | Tags are added or removed. |
| Draft Deleted | A draft is permanently deleted. |

These are UI labels, not verified wire-format event identifiers. Payloads, signatures, retry policy, delivery ordering, and key scopes were not inspected.

## 8. Proposed data model

This is an implementation design, not Typefully's actual schema.

| Entity | Suggested fields or relationships |
|---|---|
| UserPreferences | user ID, notification email, display timezone, theme, navigation layout, week start, text direction, scrollbar preference |
| NotificationPreferences | user ID, email enabled, comment-event flags, per-social-set activity flags, Slack destination reference |
| SocialSet | ID, name, color, owner reference, optional team reference, scheduling timezone, public-profile flag |
| SocialAccount | ID, social-set ID, platform, provider account ID, display identity, connection health, credential reference |
| WeeklySlot | social-set ID, day of week, local time, enabled state |
| DraftDefaults | social-set ID, ordered enabled platforms, primary platform, natural-time default, engagement defaults |
| Draft | ID, social-set ID, per-platform content, status, planned time, scheduled instant, draft-specific overrides |
| WritingProfile | social-set ID, setup status, style guide, writing-sample references |
| TeamMembership | team ID, user ID, role; exact role model must be designed separately |
| ApiKey | ID, owner, display label, hashed credential, creation/revocation metadata; exact scope model unknown |
| Webhook | owner, name, endpoint, subscribed events, secret reference, enabled state |
| WebhookDelivery | webhook ID, event ID, attempt number, response status, next retry time |

Keep billing entitlements separate from preferences. Recheck authorization server-side for ownership changes, connections, credentials, and team operations.

## 9. Persistence and interaction contract

Observed: most preference panels show individual controls without a general Save button. Creation forms have explicit submit/cancel actions. Several panels briefly render a loading state before content appears.

Inference: preference edits likely save immediately or on blur. **This was not tested.** Debounce timing, optimistic updates, rollback, refresh persistence, and offline behavior are unknown.

Proposed implementation requirements:

- Maintain selected settings section and selected social-set ID independently of editor content.
- Preserve unsent editor content when opening and closing settings.
- Support loading, empty, error, disabled, and disconnected-account states.
- For immediate saves, provide failure feedback and restore the prior value when persistence fails.
- Keep explicit form submission for new teams, connections, API credentials, and webhooks.
- Separate personal preferences from shared social-set configuration.
- Use stable IDs wherever display names can repeat.

## 10. Acceptance checks for a comparable implementation

These are proposed checks, not tests run against Typefully.

1. Changing user display timezone does not silently change a set's scheduling timezone.
2. Updating weekly slots leaves existing scheduled draft timestamps unchanged.
3. Two weekday-only time rows produce a count of 10 slots.
4. Draft creation applies the set's platform defaults and preserves platform order.
5. Updating draft defaults does not rewrite existing drafts.
6. A natural-time override is scoped to the draft and stays stable across retries.
7. Settings navigation and closing nested dialogs preserve editor content.
8. Two same-name social sets remain independently addressable.
9. Disconnected social accounts expose reconnect guidance and do not appear healthy.
10. A private set becomes team-accessible only through an authorized ownership/sharing operation.
11. Public-profile visibility is enforced by the server, including cached pages.
12. Webhook creation validates destination and event selection; delivery is retryable and deduplicable.
13. API credentials are not repeatedly exposed in lists or logs.
14. Failed preference saves do not leave the UI falsely showing a persisted value.
15. Theme, calendar week start, and editor direction produce the expected UI changes.

## 11. Coverage limits

Inspected all visible top-level settings sections, all six social-set sections, and the add-account, team-creation, webhook-creation, and assistant-entry screens. The inspected account had a paid Creator Yearly plan; the detailed social-set inspection used an X-only set.

Not verified: actual save behavior, server validations, network/API implementation, role restrictions, other plan entitlements, LinkedIn-specific connected-account options, post-connection flows, destructive confirmations, billing portal flows, active public-profile fields, configured AI assistant fields, and integration setup details. No claim is made that visible actions completed their underlying operation.
