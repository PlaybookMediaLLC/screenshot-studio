# Epic POLL: native polls across channels

Revalidated against the working implementation on 2026-10-24. The October 19 X-only assessment is obsolete. TF-036 and TF-109 are covered by the six slices below. Local adapter fixtures are not live provider certification.

## Verified provider contracts

| Channel | Question | Choices | Duration | Media / access |
|---|---|---|---|---|
| X | Post text | 2–4; 1–25 Unicode code points each | Integer minutes, 5–10,080 | No media; verified write grant |
| LinkedIn | Separate field, 1–140 code points | 2–4; 1–30 code points | 1, 3, 7, or 14 days | No media/document; authorized person or page |
| Threads | Post text | 2–4; 1–25 code points | Provider default; wire value `0` | Text posts only; `threads_basic`, `threads_content_publish`; Advanced Access for non-testers |
| Mastodon | Post text | From connected instance configuration | Whole minutes within server's seconds bounds | No media; instance write grant; multiple-choice supported |
| Bluesky / Instagram | Unavailable | — | — | No supported native poll contract in these adapters |

Official contracts: [X create post OpenAPI](https://api.x.com/2/openapi.json), [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api), [Threads polls](https://developers.facebook.com/docs/threads/posts/polls/), [Mastodon instance](https://docs.joinmastodon.org/methods/instance/), [Mastodon statuses](https://docs.joinmastodon.org/methods/statuses/). Threads exposes no duration request field: the old specification's fixed 24-hour assertion is deliberately removed.

## WI-POLL-1: validate a poll for its destination

**Source:** TF-036, TF-109. **Gap:** the old common 25-character / four-option schema prevented valid LinkedIn and custom-instance polls. **Size:** S. **Priority:** reopened expansion. **Depends on:** existing immutable draft scheduling and verified account identity. [Source requirements](../changelog-features.md).

**Changes and evidence:** `lib/write/document.ts` and `lib/write/wire.ts` carry bounded poll data without imposing one provider's limits on every provider. `lib/write/capabilities.ts` validates the destination. `server/internal/product/content_draft_options.go` repeats provider rules before scheduling. `server/internal/socialidentity/threads_poll.go` and `polls.go` supply shared Go validators. LinkedIn's question remains `PublishOptions.PollQuestion`; no second question field or database migration is necessary.

**Acceptance:** valid X durations include non-preset whole minutes; question/option overflow, whitespace-only options, media conflicts, malformed durations and unsupported channels fail before scheduling. Saved documents retain platform versions and unsupported choices for explicit editing, without silently truncating them. Normal draft approval, plan limits and publication idempotency still apply.

**Failure / observability:** validation returns actionable field/channel errors without creating scheduled posts. Worker failures retain the existing attempt and destination status; ambiguous delivery requires reconciliation. No poll option text or credentials are added to operational logs.

**Verification:** `test/write-publication.test.ts`, `test/write-publication.test.ts`, Go `content_draft_publish_integration_test.go`, `socialidentity/x_test.go`, and native adapter poll tests. PostgreSQL product suite and publication TS tests executed successfully; full final regression results belong in `execution.md`.

## WI-POLL-2: publish a LinkedIn poll

**Priority:** Reopened expansion; live provider activation remains separately gated.

**Source:** TF-109. **Gap:** stale triage missed the current LinkedIn implementation; verify native serialization rather than replace it. **Size:** S. **Depends on:** WI-POLL-1; LinkedIn app products and person/page write grants. [Source requirements](../changelog-features.md).

**Changes and evidence:** `server/internal/social/integrations/social/linkedin/post.go` creates native poll content and maps the four duration values; `server/internal/social/tenantpublishing/options.go` supplies the question. `components/write/composer/post-tools.tsx` collects question/options/duration. The inherited page adapter uses the selected organization author.

**Acceptance:** the delivered payload contains a native poll, the question is independent of caption text, and a document/image/poll combination is rejected. The first-comment workflow remains a separately tracked extra after a successful main post.

**Failure / observability:** a rejected poll never becomes a text-only fallback. Known preflight failures leave the draft editable. Uncertain HTTP outcomes remain unknown and cannot be blindly retried. Existing publishing attempts and audit events identify the destination.

**Verification:** LinkedIn provider tests plus PostgreSQL schedule validation; the browser copy workflow edits and persists a separate LinkedIn question after reload. Live creation, page entitlement and app-review approval remain unverified because no controlled LinkedIn account is available.

## WI-POLL-3: publish a Threads poll

**Priority:** Reopened expansion; live provider activation remains separately gated.

**Source:** TF-109. **Gap:** missing native poll attachment serialization. **Size:** M. **Depends on:** WI-POLL-1; Meta Threads app and approved content-publish access. [Source requirements](../changelog-features.md).

**Changes and evidence:** `server/internal/socialidentity/threads_poll.go` validates 2–4 choices, 25 code points, no media/multiple choice, and provider-default duration `0` (legacy saved 1,440-minute values remain accepted without sending a duration field). `server/internal/social/integrations/social/threads/provider.go` builds `poll_attachment` using `option_a` through `option_d` on a text container. `threads/polls_test.go` exercises native fields and malformed input. Composer labels duration “Provider default.” Existing container preparation, status checks and publishing workflow remain in use.

**Acceptance:** two, three and four choices serialize exactly; Unicode limits match the composer; custom duration and image/video polls fail before a container is created; ordinary text posts and existing X polls are unaffected.

**Failure / observability:** keep container/publish receipts and existing unknown-outcome protections. Never republish after a timeout merely because no response was received. Invalid local polls perform no provider mutation. Log provider operation and attempt ID, not tokens or full content.

**Verification:** adapter fixtures assert serialization, invalid cardinality/length/duration and no unwanted mutations. Live activation for non-testers requires Advanced Access; no claim of successful Meta publishing is made from those tests.

## WI-POLL-4: use Mastodon instance poll limits

**Priority:** Reopened expansion; live provider activation remains separately gated.

**Source:** TF-109. **Gap:** fixed limits cannot represent independently configured instances. **Size:** M. **Depends on:** WI-POLL-1; verified instance origin and credentials. [Source requirements](../changelog-features.md).

**Changes and evidence:** `mastodon/polls.go` reads `/api/v2/instance.configuration.polls` through the existing guarded transport. `mastodoncustom/provider.go` uses the connected origin. `product/social_sets.go`, `tenantpublishing/options.go`, SDK `settings-platform.ts` and `lib/write/capabilities.ts` expose the same live limits. Scheduling and the adapter revalidate. Pending data retains the exact poll; native form fields include `poll[options][]`, seconds in `poll[expires_in]`, and `poll[multiple]`.

**Acceptance:** custom option counts and text limits work; integer-minute duration must satisfy the server's seconds range; unreadable/invalid configuration disables scheduling with an explanation; custom connections never borrow the default instance's limits; poll data survives media-processing workflow boundaries without a second scheduler.

**Failure / observability:** unknown instance limits fail closed. A provider-side policy change is rechecked at publication and does not result in a text-only post. Existing request IDs and attempt records diagnose failed validation or delivery.

**Verification:** `mastodon/provider_test.go` tests a non-default five-choice server, exact seconds, multiple choice, pending persistence and media rejection. `mastodoncustom/provider_test.go` tests origin/credential restrictions. Both packages executed successfully. Live federated publication is unverified.

## WI-POLL-5: review and copy a poll to a channel version

**Priority:** Reopened expansion; live provider activation remains separately gated.

**Source:** TF-036, TF-109. **Gap:** editing separate versions did not offer an explicit poll-copy workflow. **Size:** M. **Depends on:** WI-POLL-1–4 and existing Plate version forking. [Source requirements](../changelog-features.md).

**Changes and evidence:** `components/write/composer/copy-poll.tsx` and `WriteComposer.tsx` add “Copy poll to channel…”. The dialog reads the source poll, selects a destination, exposes required question and duration changes, validates destination limits, and requires an explicit review/apply step. It forks a manual destination version using existing version helpers.

**Acceptance:** source version stays unchanged; incompatible choices remain visible for editing; copying does not silently shorten options or drop media; cancel makes no change; copied data survives autosave/reload; subsequent source edits do not overwrite the manual destination version.

**Failure / observability:** show destination-specific problems and keep the dialog open; failed saves follow the composer's conflict/recovery path. Ordinary revision and activity records capture accepted edits.

**Verification:** `test/e2e/typefully-workitems.spec.ts` creates an X poll, copies it to LinkedIn, edits the separate question, reloads and verifies choices/question. The workflow passed against local PostgreSQL and collaboration services; screenshot `typefully-poll-copy.png` records the UI. This does not verify live provider delivery.

## WI-POLL-6: explain unsupported polls

**Priority:** Reopened expansion; live provider activation remains separately gated.

**Source:** TF-109. **Gap:** a missing control alone did not explain provider support. **Size:** S. **Depends on:** WI-POLL-5. [Source requirements](../changelog-features.md).

**Changes and evidence:** `PostSettingsTools`, `PollTool`, `pollRules` and `pollProblems` expose an unavailable state for Bluesky and Instagram. Unsupported versions cannot be scheduled with a poll. No external poll site or plain-link substitute is described as a native poll.

**Acceptance:** switching to an unsupported channel shows why a native poll is unavailable; unsupported direct API payloads are rejected in Go; switching back preserves the original compatible poll; API/MCP cannot bypass the rule.

**Failure / verification / observability:** validation tests cover unsupported channels and multi-choice misuse; `test/e2e/typefully-poll-support.spec.ts` passed both unavailable explanations in synced versions, native Threads duration and original poll preservation after returning and reloading. Existing validation responses provide the reason without generating publishing attempts.
