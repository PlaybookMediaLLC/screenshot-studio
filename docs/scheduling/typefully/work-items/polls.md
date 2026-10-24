# Epic POLL: polls across supported channels

**Source:** [TF-036](https://typefully.com/changelog/polls-70) and [TF-109](https://typefully.com/changelog/polls-linkedin-threads-mastodon). **Updated:** 2026-10-24. The implementation assignment reopens this epic. [Implementation evidence](implementation-evidence.md) records the complete 42-entry audit.

The composer, persisted channel versions, schedule contracts, Go admission and native adapters support X, LinkedIn, Threads and verified Mastodon instances. TF-036 retains its checked regression status. TF-109 remains unchecked because actual provider submission and public outcomes were not verified; live verification was skipped at the user's request.

## Provider contracts

| Channel | Question | Choices | Duration | Other constraints |
| --- | --- | --- | --- | --- |
| X | Post text | 2–4, up to 25 Unicode characters | Integer minutes, 5–10,080 | Single choice, no media; root and reply polls preserve exact minutes. |
| LinkedIn | Separate, up to 140 Unicode characters | 2–4, up to 30 characters | 1 day, 3 days, 1 week or 2 weeks | Single choice, no media/document/reshare; native `content.poll`. |
| Threads | Post text | 2–4, up to 25 characters | 24 hours, controlled by the provider | Single choice, text only; native `poll_attachment` on creation containers, including replies. |
| Mastodon | Post text | Verified instance `configuration.polls` limits | Verified instance min/max seconds, represented as whole minutes in the composer | Multiple choice supported; distinct options, no media; unknown capabilities refuse scheduling. |
| Bluesky, Instagram and other unsupported destinations | — | — | — | A copied poll produces a validation error, never a silent ordinary post. |

Sources: [X Create Posts](https://docs.x.com/x-api/posts/create-post), [LinkedIn Poll API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api), [Threads polls](https://developers.facebook.com/documentation/threads/create-posts/polls), [Mastodon statuses](https://docs.joinmastodon.org/methods/statuses/) and [Instance configuration](https://docs.joinmastodon.org/entities/Instance/). These were consulted for implementation; real app permissions and provider acceptance are separate gates.

## Completed local work

| Work item | Implementation | Verification |
| --- | --- | --- |
| WI-POLL-1: Per-channel contract and admission | `lib/write/document.ts`, `capabilities.ts`, `publication.ts`; `lib/api/contracts/content-draft-platform.ts`; `services/internal/product/content_draft_options.go`; shared `socialidentity` validators. Draft and publication settings are separate: incomplete settings may be edited, but cannot silently disappear when publishing. | `test/write-publication.test.ts`; Go `content_draft_poll_test.go`, shared validator tests and admission integration coverage. |
| WI-POLL-2: LinkedIn native polls | `linkedin/post.go` validates before uploading or creating. Four exact native duration values; no fallback to one week. Poll/reshare combinations are refused. | `linkedin/poll_options_test.go`: native JSON for all four durations and native resharing; Unicode boundaries and invalid combinations cause zero HTTP mutations. |
| WI-POLL-3: Threads native polls | `threads/poll.go`, `threads/provider.go`; native JSON poll attachment for root/reply creation, with no invented expiry field. | `TestPollContainerAndReplyKeepNativeOptions` and product validation; browser settings survive reload. |
| WI-POLL-4: Dynamic Mastodon polls | `mastodon/polls.go`, custom-instance capability discovery and direct publishing allowlist; current scope/capability proofs required. | `TestMastodonPollSchedulingChecksVerifiedServerLimits`, native request tests, and browser duration/multiple-choice persistence. |
| WI-POLL-5: Reuse with independent settings | `composer/post-tools.tsx` and `lib/write/poll-copy.ts`; explicit Copy options from control replaces only choices and preserves the destination question, duration, voting mode and post content. Incompatible choices are never truncated. | `write-poll-copy.test.ts` checks preservation and validation; `typefully-options.spec.ts` copies from Threads into Mastodon and LinkedIn, reloads the distinct settings, and verifies an oversized Mastodon choice is flagged on LinkedIn before correcting it. |
| WI-POLL-6: Unsupported destinations | Capability validation reports the destination that cannot publish a poll. | Publication tests cover unsupported channels, unknown Mastodon capabilities, media conflicts and invalid durations. |

No migration is required: poll data and capabilities use existing versioned documents and immutable scheduled snapshots. Generated API and SDK types were refreshed. Existing publishing entitlements, account authorization, approval, metering, receipts and unknown-delivery handling continue to apply.

## Failure and activation behavior

A rejected poll is a failed main publication, not a successful ordinary post. Invalid settings fail before admission or mutation. Unknown provider outcomes remain unknown and use the existing recovery path; a retry must not blindly create another post.

Custom Mastodon publishing remains behind `PLATFORM_SOCIAL_CUSTOM_MASTODON_ENABLED=true` and verified instance proofs. Accounts without refreshed poll capabilities must reconnect. Activation is not implied by passing fixtures.

Remaining acceptance work: publish and inspect a real native poll through each approved provider app/account, including a Mastodon instance with nondefault limits and the eligible LinkedIn author types. Confirm app scopes, provider receipts, rendered choices, expiry and failure/unknown-outcome recovery. No real poll was submitted by this task.

## Executed checks

The full JavaScript and serial Go integration suites, generated contracts, TypeScript/lint checks and browser workflows are listed with final results in [implementation-evidence.md](implementation-evidence.md). Protocol fixtures test actual native HTTP payloads; they are not represented as live provider verification.

Existing publish outcomes and validation errors remain the operational evidence. No new dashboard or poll-specific production telemetry is claimed by this patch.
