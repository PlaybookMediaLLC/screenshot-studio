# RFC 041: The Write Workspace

**Status:** Accepted; implementation in progress (see the [coverage matrix](../scheduling/typefully/write/implementation-matrix.md))

**Date:** 2026-10-20

**Owners:** Product Engineering

**Depends on:** RFC 020 ([publishing](020-social-publishing.md)), RFC 037 ([content drafts](037-workspaces-and-content-drafts.md)), RFC 039 ([scheduling priorities](039-scheduling-feature-priorities.md))

## Decision

Drafts become **Write**: a first-class surface for writing, reviewing,
planning, and publishing social content. Write extends the content drafts of
RFC 037. It adds no second editor, no second scheduler, and no second
automation executor. The functional reference is the
[Typefully Write specification](../scheduling/typefully/write/typefully-write-spec.md)
and its [checklist](../scheduling/typefully/write/typefully-write-build-checklist.md).
The [coverage matrix](../scheduling/typefully/write/implementation-matrix.md)
records the state of each section and each verification case.

`/write` is the canonical route. `/drafts`, `/drafts/{id}`, `/drafts/calendar`,
and `/drafts/settings` redirect to their `/write` equivalents, so existing links
and bookmarks keep working.

## The model

```text
Workspace
└── Social set            a publishing identity: one account per platform
    └── Draft             kind, title, scratchpad, tags, pin, plan
        ├── Primary body  Plate JSON; posts start at post breaks
        └── Platform versions
            ├── synced    derived from the primary body when serialized
            └── manual    its own Plate body, never overwritten silently
```

### Social sets

A social set (`social_set`) groups a workspace's channel connections under one
identity. It holds a name and a colour, which need not be unique, the
connections it publishes to, at most one per platform, the ordered default
platforms for new drafts, an optional time zone, and writing preferences.

- The workspace's organization and membership stay the authority. A set adds
  only a visibility rule: `workspace` (every member, by role) or `restricted`
  (owners, admins, and the members it lists).
- Every workspace has one default set, created on first use with every active
  connection. Drafts written before sets existed have no `socialSetId` and
  belong to the default set; no row is rewritten.
- Go checks set access on every draft read and write, in lists, and in
  background work. A draft in a restricted set is not found for a member
  outside it.

### Draft kinds and targets

`content_draft.kind` is `standard`, `reply`, `quote`, `repurpose`, or
`article`. A thread is a standard draft with more than one post. A reply or
quote stores an explicit target (`platform`, `url`, `remoteId`), not a URL in
the text. A repurposed draft stores the published post it came from. Kinds are
offered only on platforms that support them (the capability registry).

### Platform versions

`content_draft.platformVersions` is a versioned document
(`schemaVersion: 1`). Each entry is a channel and a mode:

- **synced**: the version has no text of its own. It is serialized from the
  primary body each time, so an edit to the primary can never overwrite it.
- **manual**: the version has its own Plate body. Primary edits leave it alone.
  The entry records the primary's version and a hash of the primary's
  serialization when it was forked, so the composer can show "the primary
  changed since you wrote this" and offer a comparison.

Switching a manual version back to synced is an explicit decision that
discards its body. When the body carries comment threads, the composer names
how many and resolves them as orphaned, rather than moving them onto other
text.

Four things stay separate: the tab being edited (UI state only), whether a
connection is enabled for publication (`channelConnectionIds`), whether that
connection is healthy (its status and credential state), and the version's
mode. Changing tabs changes nothing that is saved.

The legacy `channelText` map still reads: a channel with text there and no
platform version is a manual version whose body is that text. The first save
by the new composer moves it into `platformVersions`.

Per-version options are stored with the version, typed per platform:

| Platform | Options |
| --- | --- |
| X | audience (everyone or a community, with share-to-followers), per-post reply settings, per-post disclosures (paid partnership, made with AI), numbering, finisher, follow-up automation |
| LinkedIn | visibility, first comment, poll, PDF document |
| Threads, Bluesky, Mastodon, Instagram | the options RFC 037 already validates |

### Posts with stable identity

A post starts at a `post_break` block. Every document starts with one, so the
first post has an identity too; the composer adds it when it opens an older
draft. Each break carries an `id`, and per-post settings (poll, reply settings,
disclosures) live on that break. Moving a post moves its break, its blocks, its
media, and its comment marks together; inserting a post renumbers nothing but
the visible numbers. Splitting a post makes a new break; merging two posts
keeps the earlier post's settings.

### Numbering and finishers

Numbering is configuration on the X version: on or off, start or end,
style (`#1`, emoji, `1.`, `1/`, `/1`, `1/9`, `1 of 9`), and how many posts to
skip at the start and end. It is applied when the version is serialized, for
the preview and for publication, and counted against the limit. The authored
text never contains it.

A thread finisher is a reusable template (`content_draft_finisher`, per social
set). Applying one appends a post. A finisher that quotes the first post holds
an unresolved reference until the first post is live; the publisher resolves it
to that post's id and never sends a quote of a post that does not exist.
Nothing promotional is ever inserted into a customer's draft.

## Organization, history, and sharing

- **Tags** are `content_draft_tag` rows scoped to a social set, with a colour.
  A draft keeps tag ids. Copying a draft to another set maps tags by name or
  drops them, as the person copying chooses.
- **Pinning** sets `pinnedAt`; pinned drafts sort first.
- **Activity** is the existing product activity stream, filtered to the draft:
  creation, content edits (one event per revision window), renames,
  destination changes, tag changes, review, sharing, planning, scheduling,
  publication, failures, recovery, and automation. Viewing writes nothing.
- **Backups** are `content_draft_revision` rows: immutable snapshots of title,
  body, platform versions, and kind, kept at most every ten minutes of editing
  and at every schedule, plan, and recovery. Retention: every snapshot of the
  last 30 days, then one a day for a year. Recovering a snapshot creates a new
  draft and leaves the source alone.
- **Duplicate and copy** create a new draft: new id, version 1, status draft,
  no share token, no guest comments, no discussions, no review, no plan, no
  scheduled posts. Copying to another set rechecks destinations and set access.
- **Comments** stay the discussion plugin's threads, saved with the draft. Go
  now refuses a save that edits or deletes another person's comment; resolving
  and reopening stay open to every editor.
- **Public links** stay the 24-byte share token. Turning one on is an explicit
  switch; copying the internal link never turns it on.

## Planning and publishing

Three operations, with different backend semantics:

| Operation | Effect |
| --- | --- |
| Save | Persists content. |
| Plan | Sets `plannedFor` and its time zone. No scheduled post exists, so nothing can publish. |
| Schedule | Creates the canonical scheduled posts (RFC 037), at an instant resolved in Go. |

Publishing now is a schedule at the current instant, reached only from a final
review dialog. Go resolves a local wall time in an IANA zone itself and
refuses a time that does not exist (a DST gap) or is ambiguous (a repeated
hour) unless the request says which. Queue slots are reserved under a
transaction-scoped advisory lock per workspace, so two "add to queue" requests
never take one slot. The natural posting offset (±4 minutes) is derived from a
hash of the draft id and version, so a retry or a reload keeps it.

Each destination is its own scheduled post with its own outcome. A failed
post can be retried by itself; a post whose outcome is unknown must be
reconciled first ("it is live" with its URL, or "it is not live"), so a retry
never publishes twice.

## Follow-up automation

The X follow-ups of RFC 037 run in the publishing workflow's follow-up step.
This RFC extends them:

- **Auto-retweet** rules: after N hours, or N days later at a local time;
  each repost is removed 12 hours later when the rule asks.
- **Auto-plug**: likes or reposts as the metric, a threshold, and a reply.
- **Auto-DM**: the configuration and the condition engine (follows-you
  required or optional, any or all of repost and reply, an optional reply-text
  match, personalization variables, a duration, a daily cap, recipient
  deduplication). Execution is **unavailable** until the X app holds the
  `dm.write` scope and a test account has sent a message; until then the
  dialog shows that reason and nothing is sent.

Every automation run is a `post_automation_run` row with a unique key per post,
rule, and occurrence, a status (pending, executed, failed, uncertain,
cancelled), and the provider's receipt. Cancelling stops pending runs and says
plainly that completed actions were not undone.

## Provider capabilities

A typed registry (`lib/write/capabilities.ts`, mirrored in Go) says what each
platform and account can do. Each entry is backed by the provider's
documentation, linked in the matrix:

| Capability | X | LinkedIn |
| --- | --- | --- |
| Threads | yes, 25 posts | no; joined into one post |
| Reply / quote | `reply.in_reply_to_tweet_id`, `quote_tweet_id` | reshare with commentary |
| Audience | community (`community_id`, `share_with_followers`) | visibility: anyone or connections (members) |
| Reply settings | following, mentioned users, subscribers, verified | n/a |
| Disclosures | `paid_partnership`, `made_with_ai` | n/a |
| Polls | 2–4 choices, 25 chars, 5 min–7 days, no media | 2–4 options, 30 chars, question 140, 1/3/7/14 days, no media |
| Documents | n/a | PDF up to 100 MB and 300 pages |
| Mentions | @handle text | organization and member annotations |
| Articles | `POST /2/articles/draft` then `/publish`; X Premium | n/a |
| Long posts | X Premium accounts only | n/a |

An account's X Premium status is the account's, read from X, never inferred
from the workspace's plan. Until it is read, the account is treated as
standard (280).

## Rollout

All schema changes are additive. Old composers keep working against the new
columns because Go ignores what it is not sent. The Write surface ships behind
`PLATFORM_CONTENT_DRAFTS`, as drafts do; capabilities that need provider
permissions (articles, LinkedIn documents and polls, DMs) each have a gate and
stay off until verified with a real account. Turning Write off hides the UI;
planned drafts never publish because they have no scheduled posts, and
scheduled posts keep running in Temporal as before.
