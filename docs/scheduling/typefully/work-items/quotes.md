# Epic QUOTE: Native quotes and thread continuation

Native provider semantics are required. A text link is not a successful native quote.

## WI-QUOTE-1: Quote and reply to supported external posts

**Source:** TF-001, TF-025, TF-108. **Gap:** Partial channel coverage. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M per provider. **Depends on:** Verified provider identity, read/write scopes and target permissions.

### Channel matrix
| Channel | Native behavior | Gate |
|---|---|---|
| X | Quote/reply by numeric status ID | Verified app/account eligibility and write access |
| LinkedIn | Authorized reshare/reference and company mentions | Provider resource URN and appropriate member/page scopes |
| Bluesky | Quote as `app.bsky.embed.record` or `recordWithMedia` | Resolve handle → DID, fetch record and use strong URI/CID |
| Mastodon | `quoted_status_id` | Instance API version ≥7; resolve on connected instance; public/unlisted target; `quote_approval.current_user=automatic` |
| Threads | Supported ordinary thread replies; no asserted native finisher quote | No fabricated quote compatibility |
| Instagram | No external native quote workflow | Explicit unavailable capability |

### Changes and evidence
`lib/write/publication.ts`, draft kind/target controls, `server/internal/social/tenantpublishing/options.go`, Bluesky `quote.go` and Mastodon `quotes.go` serialize native references. Mastodon sends credentials only to the connected instance, validates the resolved URL/URI exactly, and checks target permission before mutation. The provider's quote state is carried in `PostResponse`, `ThreadProgress.quotes` and the existing JSON receipt; no new table is needed. `components/drafts/DraftPosts.tsx` reports the state **when published** rather than promising subsequent federation approval.

### Acceptance criteria
1. A malformed/denied/mismatched target fails before publishing.
2. A Bluesky media quote preserves both media and the strong record reference.
3. Mastodon old/manual/denied/missing-policy cases fail closed; missing state is unconfirmed.
4. A confirmed post with a pending/rejected quote remains published and shows that qualification.
5. Thread continuation answers the last confirmed part; a partial failure never republishes the root.
6. Pasting a supported post URL offers an explicit conversion to a quote; do not claim this complete until that composer handoff is verified.

### Failure behavior and verification
Publication uncertainty remains `UNKNOWN_DELIVERY`; no blind second POST. Confirmed quote approval is independent of the main receipt. Adapter fixtures cover Bluesky URI/CID, native payloads, Mastodon capability/permission/state handling; tenant/worker tests preserve root and reply quote receipts, including a single-post quote. Live federation and provider publication remain unverified. Paste-to-quote conversion remains a composer gap. Audit destination/error class and quote receipt state; never log tokens.

## WI-QUOTE-2: Finish threads with reusable root quotes

**Source:** TF-018, TF-039, TF-108. **Gap:** Partial cross-channel native serialization. [Source requirements](../changelog-features.md).
**Priority:** Reopened. **Size:** M. **Depends on:** WI-QUOTE-1 and existing saved closing-post templates.

`components/write/composer/version-options.tsx` stores reusable text and the quote-first-post choice. `server/internal/social/tenantpublishing/options.go` resolves the actual published root before serializing X, Bluesky or Mastodon native quote options. An ordinary Threads closing post remains ordinary and is labeled accordingly.

Acceptance: an inserted template remains editable; it preserves its quote flag across reload; a failed root prevents the finisher; a failed finisher preserves the successful root and prior replies; resume uses the root's recorded native ID rather than an unsent draft link. Test options/serialization, persistence, partial-thread continuation and an actual browser insertion. Local serialization tests exist; complete finisher browser and live-account evidence must be recorded before certification. Follow-up receipts and visible partial-thread counts provide recovery evidence.
