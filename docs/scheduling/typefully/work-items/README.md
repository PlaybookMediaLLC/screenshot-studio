# Typefully backlog: work items

This folder turns the [Typefully changelog backlog](../changelog-features.md) into work items for Shots.

A changelog entry is a release note. It says what Typefully shipped. It does not say what Shots lacks, what code changes, or how to prove the work is done. A work item says all three.

| File | Content |
|---|---|
| [implementation-evidence.md](implementation-evidence.md) | Integration-branch implementation and verification evidence |
| [coverage.md](coverage.md) | Current 109-entry implementation and verification matrix |
| [execution.md](execution.md) | Executed checks, failures repaired, and release blockers |
| [triage.md](triage.md) | Historical October 19 baseline; current status is in coverage.md |
| [polls.md](polls.md) | POLL: cross-channel native polls |
| [x-options.md](x-options.md) | XOPT: X options and eligibility |
| [linkedin-options.md](linkedin-options.md) | LIOPT: comments, mentions, documents and reposts |
| [channels.md](channels.md) | CHAN: account connections and identity providers |
| [analytics.md](analytics.md) | ANALYTICS: stored observations, reports and exports |
| [collaboration.md](collaboration.md) | COLLAB: notifications, history and collaboration |
| [scheduling.md](scheduling.md) | SCHED: queues, calendar, timing and bulk workflows |
| [quotes.md](quotes.md) | QUOTE: native quotes, replies and finishers |
| [follow-ups.md](follow-ups.md) | FOLLOW: receipted follow-up automation |
| [media.md](media.md) | MEDIA: assets, frames, descriptions and ordering |
| [editor.md](editor.md) | EDITOR: paste, focus, numbering and performance |
| [previews.md](previews.md) | PREVIEW: channel previews and sharing |
| [organization.md](organization.md) | ORG: search, bulk operations and controlled experiments |
| [ai.md](ai.md) | AI: assistant, preferences and voice memo transcription |
| [agents.md](agents.md) | AGENT: APIs, MCP, webhooks and external clients |

## Authorized expansion

The 2026-10-24 assignment reopens the October 23 scheduling expansion. All 15 epics are in scope; historical P1/P5 rankings are not stopping boundaries. Existing API-key publishing/autonomous-approval restrictions, provider app review and deliberately controlled tags/pins remain in force. An **Exists** label requires feature-specific regression evidence; a local provider fixture is never a live certification. The original triage and changelog checkboxes are historical evidence, not the current completion record.

## Step 1: Triage each entry against Shots

Give each `TF-` entry one status. Write the evidence: a code path, or a line in RFC 013 or RFC 042.

| Status | Meaning | Next action |
|---|---|---|
| Exists | Shots does it today. | Execute meaningful regression checks and record the exact behavior in coverage.md. |
| Partial | Shots does part of it. | Write a work item for the gap only. |
| Missing | Shots does not do it. | Write a work item. |
| Verify | The code does not show the answer. | Test locally and with a permitted real account where available; record external blockers. |
| Later | RFC 042 defers it. | Record the product decision/dependency in the corresponding work item. |
| Skip | It is about Typefully, not about the product. | Keep the reason. No work item. |

## Step 2: Shape the work items

A work item is one change that a user can see. It ships alone. One person finishes it in one week or less.

1. Split bundles. An entry with many features becomes many items (for example, TF-002 and TF-001).
2. Merge chains. An "Extended by" chain becomes one epic (for example, TF-036 and TF-109).
3. Split by channel. Each channel has its own API, limits, and app review.
4. Do not split by layer. One item holds the contract, the Go validation, the adapter, the UI, and the tests.

## Step 3: Write each item with the template

```markdown
## WI-<EPIC>-<n>: <verb + user-visible object>

**Source:** TF-xxx (link)
**Gap:** Missing | Partial. Evidence: `path:line`
**Priority:** RFC 042 P1 to P5, or Later (reason), or Unranked
**Size:** S (2 days or less) | M (1 week or less) | L (split it)
**Depends on:** other work items, provider app reviews, RFCs

### Problem
Who needs it, and what they cannot do today.

### Scope
- In: ...
- Out: ... (and the reason)

### Channel matrix
| Channel | Supported | Limits | Notes |

### Changes
- Contract (zod): `lib/api/contracts/...`
- Go validation, with the same numbers: `services/internal/product/...`
- Provider adapter: `services/internal/social/integrations/social/<provider>/...`
- Data and migration
- UI: `components/drafts/...`
- Metering and plan gate (RFC 023)

### Failure behavior
What happens when the provider rejects it.

### Acceptance criteria
1. Each criterion is one testable sentence.

### Verification
- Unit, integration, and a manual test with a test account.

### Observability
The metric that proves it works in production.

### Open questions
```

Apply these rules from the RFCs to every item:

1. The composer and Go use the same limits (RFC 042).
2. An update never publishes at once by accident (RFC 042, lesson 3).
3. A failed extra, such as a first comment, does not fail the post (RFC 042, lesson 4).
4. A channel without a feature shows that state, not empty data (RFC 042, lesson 5).
5. One idempotency key for each draft, channel, and version (RFC 013).

## Step 4: Set the order

1. Put each epic in an RFC 042 priority (P1 to P5), or in "Later" with the reason.
2. The reopened assignment includes previously unranked feasible work; only explicit product/security and provider boundaries remain blocked.
3. Start provider app reviews first. RFC 042 says that the TikTok, Meta, and Google reviews take weeks.

## Step 5: Keep the items here

Issues are off in this repository. Each epic gets one file in this folder, in the format of [polls.md](polls.md).
