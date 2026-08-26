# RFC 018: Campaign Workspace

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 014, RFC 017, and RFC 019
**Owners:** Product and Engineering

## Decision

Build a campaign workspace UI and make it more important than chat. AI
manipulates the workspace. The workspace is not merely the output of AI. This
is an architectural distinction, not a styling choice.

The test of the distinction: every action available through chat is available
without chat, and the workspace is fully usable with the copilot panel closed.

## Design

Layout:

```text
┌─────────────────────────────┬───────────────────┐
│ Campaign                    │ Copilot           │
│                             │                   │
│ Recurring Invoices Launch   │ "Make this more   │
│                             │ founder-focused." │
│ [X] [LinkedIn] [Instagram]  │                   │
│                             │                   │
│ ┌────────┐ ┌────────┐       │                   │
│ │ Asset  │ │ Asset  │       │                   │
│ └────────┘ └────────┘       │                   │
│                             │                   │
│ Monday                      │                   │
│ X post                      │                   │
│                             │                   │
│ Tuesday                     │                   │
│ LinkedIn                    │                   │
└─────────────────────────────┴───────────────────┘
```

Capabilities:

- View a campaign's angles, creatives, posts, and schedule in one place.
- Edit copy inline. Open any creative in the full editor.
- Regenerate one asset or one post without touching the rest.
- Address the copilot about the selected object ("make this more
  founder-focused").

The workspace reads and writes the structured objects from RFC 014. The
copilot manipulates the same objects through the tools from RFC 016.

## Goals

- One screen where a founder reviews and approves a whole campaign.
- Edits that never silently lose work.
- Selection-aware copilot, so "make this shorter" has an unambiguous referent.
- Batch approval as the primary action, matching RFC 019.

## Non-goals

- Calendar planning across campaigns. RFC 025 introduces content pillars and
  the weekly calendar.
- Real-time multiplayer editing with live cursors.
- Replacing the creative editor. The workspace links into it.
- A mobile authoring experience. Review on mobile; author on desktop.

## Information architecture

```text
/campaigns                          list, filter, search
/campaigns/[campaignId]             overview: angles, posts, assets
/campaigns/[campaignId]/posts/[postId]   post detail, inline in a panel
/campaigns/[campaignId]/review      the approval view
/campaigns/[campaignId]/history     revisions and audit
```

URL rules:

- The selected object is in the URL, so any state is linkable and shareable.
  Sending a teammate "look at this post" must be a URL, not instructions.
- Panels are routes, not hidden component state, so back and forward work.
- Filters and sort live in the query string.
- Refreshing any URL restores the same view.

The campaign overview is the default. The review view is a focused mode that
strips editing affordances and presents posts for a decision, because reviewing
and authoring are different tasks and mixing them makes both slower.

## Object selection and the copilot

Exactly one object is selected at a time: the campaign, an angle, a post, or a
creative. The selection is in the URL. The copilot receives the selection as
explicit context, so "make this more founder-focused" resolves without
guessing.

The copilot panel:

- Shows the selected object's identity at the top, so the referent is visible.
- Is collapsible, and the workspace is fully functional collapsed.
- Streams reasoning and tool steps (RFC 017).
- Applies results by refreshing from the database, never by patching the UI
  from stream content.

With nothing selected, the copilot operates on the campaign. With a post
selected, an ambiguous instruction asks whether the user meant the post or the
campaign, once.

## Editing, autosave, and concurrency

Inline copy editing autosaves on a debounce and on blur. The rules:

- Every save creates a `CampaignPostRevision` (RFC 014) rather than
  overwriting, so nothing is unrecoverable.
- Saves carry the revision the edit was based on. A mismatch means someone else
  changed the post, and the UI shows both versions and asks which to keep. It
  never silently discards either.
- A save failure keeps the local text, shows an explicit unsaved state, and
  retries. Text a founder typed is never dropped for a network error.
- Editing an `APPROVED` post warns that saving will return it to `DRAFT` and
  invalidate the approval, which is required by RFC 014's content hash.
- Editing is blocked on `SCHEDULED` and `PUBLISHED` posts, with an explanation
  and an offer to cancel the schedule.

Concurrency is optimistic with visible conflict resolution. Two founders in one
workspace editing one post at once is rare; silently losing one of their edits
is unacceptable.

Presence indicators show who else is viewing the campaign. That is enough
awareness to avoid most collisions without building collaborative editing.

## Regeneration

Regeneration is scoped to the selected object and never cascades:

| Target        | Effect                                                     |
| ------------- | ---------------------------------------------------------- |
| One post copy | New revision; the creative is untouched                    |
| One creative  | New asset; the post copy is untouched                      |
| One angle     | New angle text; posts keep their existing copy             |
| Whole campaign| Explicit confirmation; creates revisions for everything     |

Whole-campaign regeneration is the only destructive-feeling action and is the
only one that confirms. Everything else is reversible through revision history,
so confirming it would be friction without safety.

Regeneration shows the previous version alongside the new one, with keep and
discard actions. A founder who regenerates and prefers the original must not
have to undo through history.

## Approval in the workspace

The review view implements RFC 019:

- Batch approval is the primary button: "Approve all 7 posts".
- Per-post approve, reject, and request-changes are secondary.
- Selecting a subset enables "Approve 3 selected".
- Rejection and change requests require a note, which is the planned
  `reason` field from RFC 019.
- Posts blocked by the prohibited-term filter show the matched term and cannot
  be approved until edited.
- Approval state is visible per post at a glance, with the decider and time.

A user without `release:approve` sees the review view read-only, with the
decision controls absent rather than disabled-with-a-tooltip. Showing a
disabled button for a permission a user will never hold is noise.

## Empty and error states

| State                        | Presentation                                           |
| ---------------------------- | ------------------------------------------------------ |
| No campaigns                 | The three RFC 021 workflows as the primary actions     |
| Campaign with no posts       | Generate action plus manual add                        |
| Post with no creative        | Placeholder with generate and attach actions           |
| Creative render in progress  | Skeleton with progress; the post stays editable        |
| Creative render failed       | Failure reason plus retry, inline                      |
| Stale product screenshot     | Badge with capture age and a re-capture action         |
| No brand kit                 | Banner offering setup; generation still works          |
| No connected channel         | Approval works; scheduling shows a connect action      |
| Campaign fully published     | Read-only with performance placeholders (RFC 027)      |
| Load failure                 | Retry with the last known content, not a blank screen  |

The empty campaign list is the most important screen in the product, because it
is where a new founder lands after onboarding. It shows generated work per RFC
021, not an invitation to type into a chat box.

## Performance

- The campaign overview loads in under 1 second at p95 for a 50-post campaign.
- Creatives lazy-load with correct aspect-ratio placeholders, so the layout
  never shifts.
- Inline edits apply optimistically and reconcile on save.
- The campaign list paginates by cursor.
- Long campaigns virtualize the post list.

## Accessibility

- Every action is keyboard reachable, including approve, reject, and select.
- Selection changes are announced, and the copilot's referent is in its
  accessible name.
- Streaming output is announced politely rather than assertively, so a screen
  reader is not interrupted continuously.
- Approval state is conveyed by text and icon, never by color alone.
- Focus returns to a sensible anchor when a panel closes.

## Authorization

The workspace renders what the member's role permits:

| Role      | Sees            | Can do                                      |
| --------- | --------------- | ------------------------------------------- |
| `viewer`  | Everything      | Read only                                    |
| `creator` | Everything      | Create, edit, regenerate, submit for review |
| `approver`| Everything      | Approve, reject, request changes             |
| `publisher`| Everything     | Schedule and cancel approved posts           |
| `admin`   | Everything      | All of the above plus brand and settings     |

Every read is workspace-scoped. Server-side authorization is authoritative; the
UI's role awareness is presentation only.

## Version history

The history view shows, per post, every revision with its author or generator,
its provenance, and a diff against the previous revision. Any revision can be
restored, which creates a new revision rather than rewriting history.

Audit events from RFC 019 render in the same timeline, so "who approved this
and what did it say when they approved it" is one view. That question is the
whole reason approval and versioning were specified together in RFC 014.

## Acceptance criteria

1. A founder edits, regenerates, and rearranges a campaign entirely in the
   workspace. Chat is optional at every step.
2. Every view has a shareable URL that restores the same state on reload.
3. Back and forward navigate panel state correctly.
4. An inline edit survives a network failure and reports its unsaved state.
5. Concurrent edits to one post surface a conflict with both versions.
6. Editing an approved post warns and returns it to `DRAFT` on save.
7. Editing a scheduled post is blocked with an offer to cancel the schedule.
8. Regenerating one post leaves every other object unchanged.
9. Regeneration offers keep and discard against the previous version.
10. "Approve all 7 posts" issues one batch call and one audit entry.
11. A user without `release:approve` sees no decision controls.
12. A post blocked by the prohibited-term filter cannot be approved.
13. The empty state presents the three RFC 021 workflows.
14. A failed render shows a reason and an inline retry.
15. A 50-post campaign loads in under a second at p95.
16. Every action is reachable by keyboard.
17. Restoring an old revision creates a new revision.
18. A campaign from another workspace returns `404`.

## Rollout

1. Ship read-only campaign views over the existing objects.
2. Add inline editing with revisions and conflict handling.
3. Add the review view and batch approval.
4. Add regeneration.
5. Add the copilot panel, after the workspace is complete without it. Building
   the panel first would produce a chat product with a viewer attached, which
   is the outcome this RFC exists to prevent.
6. Add history and the audit timeline.

## Out of scope

- Calendar planning across campaigns. RFC 025 introduces content pillars and
  the weekly calendar.
