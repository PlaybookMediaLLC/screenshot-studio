# Epic POLL: polls on more channels

- **Source:** [TF-036](https://typefully.com/changelog/polls-70) (X polls, Exists) and [TF-109](https://typefully.com/changelog/polls-linkedin-threads-mastodon) (Missing)
- **Priority:** RFC 042 P1, "More channels, with their options"
- **Goal:** A writer adds one poll to a draft. The poll goes out on every selected channel that supports polls.

## What exists

- A schedule target carries one poll for each channel connection (`ContentDraftScheduleTarget.Poll` in `services/internal/product/content_draft_schedule.go`).
- `pollSchema` allows 2 to 4 options of up to 25 characters, open 5 minutes to 7 days (`lib/api/contracts/content-drafts.ts:248`). It has no question field.
- Go rejects a poll on any channel except X: "Polls are for X posts." (`content_draft_schedule.go:240`).
- Go rejects an X poll with images (`content_draft_schedule.go:243`).
- Only the X adapter reads `PollDetails` (`services/internal/social/integrations/social/x/publish.go`).

## Channel matrix

The limits come from the Typefully changelog (TF-109). Check each one against the provider API docs before you build.

| Channel | Polls | Question | Options | Duration |
|---|---|---|---|---|
| X | Yes (today) | The post text | 2 to 4, up to 25 characters | 5 minutes to 7 days |
| LinkedIn | Yes | Separate, up to 140 characters | 2 to 4, up to 30 characters | 1 day, 3 days, 1 week, or 2 weeks |
| Threads | Yes | The post text | 2 to 4, up to 25 characters | 24 hours |
| Mastodon | Yes | The post text | Set by the server | Set by the server |
| Bluesky | No | — | — | — |
| Instagram | No | — | — | — |

## Work items

| Item | Size | Depends on |
|---|---|---|
| WI-POLL-1: Per-channel poll contract and Go validation | S | — |
| WI-POLL-2: Publish polls to LinkedIn | M | WI-POLL-1 |
| WI-POLL-3: Publish polls to Threads | M | WI-POLL-1 |
| WI-POLL-4: Publish polls to Mastodon with the server's limits | M | WI-POLL-1 |
| WI-POLL-5: Composer: write one poll, copy it to each channel, flag invalid options | M | WI-POLL-1 |
| WI-POLL-6: Show "polls not supported" on Bluesky and Instagram | S | WI-POLL-5 |

## WI-POLL-1: Per-channel poll contract and Go validation

**Gap:** Partial. The contract and Go accept X polls only.
**Size:** S

### Changes

- Add an optional `question` field to `pollSchema`. LinkedIn requires it. Other channels reject it.
- Replace the single rule set with one rule set for each channel, as in the channel matrix.
- Use the same numbers in `pollSchema` and in `checkDraftExtras`.
- Keep the current rule: a post with a poll has no images or video.

### Acceptance criteria

1. Each channel's limits are the same in the composer and in Go.
2. A LinkedIn poll without a question fails in both places, with the same message.
3. An X poll that is valid today stays valid.
4. A poll on Bluesky or Instagram fails with a clear message.

## WI-POLL-2: Publish polls to LinkedIn

**Gap:** Missing. The LinkedIn adapter does not read `PollDetails`.
**Size:** M

### Problem

A LinkedIn writer cannot add a poll in Shots. They must post the poll by hand on LinkedIn.

### Changes

- Add poll output to `services/internal/social/integrations/social/linkedin/post.go`.
- Map the duration to LinkedIn's four values.

### Failure behavior

A poll is the body of the post, not an extra like a first comment. If LinkedIn rejects the poll, the post fails and shows the provider error.

### Acceptance criteria

1. A valid LinkedIn poll publishes as a native poll.
2. A 141-character question fails before scheduling, in the composer and in Go.
3. A poll with an image fails before scheduling.
4. A retry of a scheduled poll post creates one post, not two (RFC 013 idempotency key).

### Verification

- Unit: the adapter's request body for a poll.
- Integration: schedule a poll draft through `/v1/content-drafts`.
- Manual: publish a poll to a test LinkedIn account.

### Open questions

1. Does the Shots LinkedIn app have the scope that polls need?
2. Do LinkedIn pages (RFC 042 P1) take polls the same way?

## WI-POLL-3 to WI-POLL-6

Write these items with the [template](README.md#step-3-write-each-item-with-the-template) when WI-POLL-1 starts.

Notes for the authors:

- **Threads:** check that the Threads API accepts polls for the app's permissions.
- **Mastodon:** read the limits from the server's instance configuration. Do not use fixed numbers.
- **Composer:** carry the options to each channel. Keep the duration for each channel. Flag an option that a channel does not accept before the user publishes.

## Observability

- The publish success rate for poll posts, by channel.
- The number of poll validation failures, by channel and rule.
