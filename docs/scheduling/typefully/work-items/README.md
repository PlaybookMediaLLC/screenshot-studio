# Typefully backlog: work items

This folder turns the [Typefully changelog backlog](../changelog-features.md) into work items for Shots.

A changelog entry is a release note. It says what Typefully shipped. It does not say what Shots lacks, what code changes, or how to prove the work is done. A work item says all three.

| File | Content |
|---|---|
| [triage.md](triage.md) | Step 1 and Step 2 for all 109 entries: status, evidence, and epic |
| [polls.md](polls.md) | The first epic, written with the template below. Use it as the model. |

## Step 1: Triage each entry against Shots

Give each `TF-` entry one status. Write the evidence: a code path, or a line in RFC 037 or RFC 039.

| Status | Meaning | Next action |
|---|---|---|
| Exists | Shots does it today. | Mark it `[x]` in the backlog. No work item. |
| Partial | Shots does part of it. | Write a work item for the gap only. |
| Missing | Shots does not do it. | Write a work item. |
| Verify | The code does not show the answer. | Test it with a real account. Then set a status. |
| Later | RFC 039 defers it. | Keep the reason. No work item now. |
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
**Priority:** RFC 039 P1 to P5, or Later (reason), or Unranked
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
- Metering and plan gate (RFC 035)

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

1. The composer and Go use the same limits (RFC 039).
2. An update never publishes at once by accident (RFC 039, lesson 3).
3. A failed extra, such as a first comment, does not fail the post (RFC 039, lesson 4).
4. A channel without a feature shows that state, not empty data (RFC 039, lesson 5).
5. One idempotency key for each draft, channel, and version (RFC 037).

## Step 4: Set the order

1. Put each epic in an RFC 039 priority (P1 to P5), or in "Later" with the reason.
2. "Unranked" means that the epic needs a product decision before it joins the RFC 039 order.
3. Start provider app reviews first. RFC 039 says that the TikTok, Meta, and Google reviews take weeks.

## Step 5: Keep the items here

Issues are off in this repository. Each epic gets one file in this folder, in the format of [polls.md](polls.md).
