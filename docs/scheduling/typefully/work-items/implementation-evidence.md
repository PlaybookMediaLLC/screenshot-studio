# Sections 2, 4 and 5 implementation evidence

Audit date: 2026-10-24. Scope: the 42 original entries in [the changelog backlog](../changelog-features.md). The assignment reopens these entries without changing other roadmap priorities. The original dates, descriptions, source links and nested requirements are retained.

**Live provider verification was explicitly skipped at the user's request. No real posts or messages were sent.** Native adapter tests below use local HTTP protocol fixtures; browser tests use the actual Next application, Go API, Postgres, Redis, object storage and (for collaboration) Hocuspocus. A local provider receipt is not evidence of a public provider outcome. Checked entries cover verified local behavior and regression coverage of the previously checked X automation/poll features. Unchecked provider entries stay unresolved.

## Code and verification map

Paths in this table are relative to the repository root. `G` means the Go test suite with the integration database configured; `N` means the JavaScript suite. Browser filenames are under `test/e2e/`. A pre-existing implementation is identified as regression coverage; it is not represented as newly written code.

| ID | Source status | Implementation and changed code | Executed verification / remaining gate |
| --- | --- | --- | --- |
| TF-012 | Verified | Existing Plate composer, shortcuts and previews; focus mode now hides/restores app and draft sidebars without remounting the editor; `components/drafts/DraftEditor.tsx` now handles native video drops and keyboard viewport insets; `components/write/composer/preview.tsx` plays attached video. | Rich editor/video browser tests, mobile review, focus-mode enter/exit, live co-editing, revocation and tenant isolation; N and G. |
| TF-016 | Verified | `lib/write/split-thread.ts`, `components/write/composer/thread-tools.tsx`, Plate paste plugins preserve rich paragraphs, links, lists and marks; explicit Make thread and undo. | `write-split-thread.test.ts`; `typefully-editor.spec.ts` pastes rich HTML and reloads split content. |
| TF-020 | Verified | Existing serialization-time numbering in `lib/write/numbering.ts`; splitting reserves label space. | Numbering permutations, reorder/delete, repeated serialization, limits and browser numbering; N. |
| TF-029 | Open: provider control | `link-cards.tsx`, `lib/write/document.ts`, publication contracts and `postoptions/link_preview.go` persist metadata/removal. Bluesky uses a native external embed or omits it. Other providers reject removal before scheduling instead of silently restoring a card. | Link remove/restore/reload browser test; Bluesky external-embed adapter tests and publication validation. No verified X API preview-removal mapping. |
| TF-049 | Open: live verification | `thread-tools.tsx` copies long-form text; X authenticated subscription capabilities determine accepted length. `services/internal/socialidentity/x.go`, `x_content.go`, `product/x_capabilities.go` and frontend capabilities agree. | 280/25,000 boundaries, URL/Unicode counts, subscription verification and refusal tests; no eligible real X account tested. |
| TF-050 | Verified | `composer/emoji-picker.tsx`, `packages/platejs-editor/src/lib/emoji-search.ts`, toolbar insertion and existing Plate aliases. | Browser search, keyboard selection, focus/caret retention, rich text and reload. |
| TF-058 | Verified | Existing Plate HTML deserialization plus content-preserving split helper. | Rich HTML paste with bold, italics, list paragraphs, links and newlines; unsafe tags/atomic splitting tests. |
| TF-061 | Open: live verification | Verified 25,000-character X limits replace contradictory historical assumptions; immutable scheduled payload and direct native adapter. | Go capability/admission/adapter tests; long-form scheduling validation. Real Premium publication remains untested. |
| TF-063 | Verified | Per-version `splitLimit` and `splitOnPaste` saved in JSON; account-derived default, manual copy, numbering budget and atomic link/grapheme splits. | Browser automatic paste split/reload; standard and Premium limit fixtures; N/G. |
| TF-075 | Verified | Numbering for X, Threads, Bluesky and Mastodon threads, independently configured per version; single-post providers join without thread numbers. | `write-numbering.test.ts`, `write-publication.test.ts` cross-platform reorder/delete/no-duplication cases; browser numbering. |
| TF-102 | Open: provider activation | Article creation, title/cover, supported rich text, images and native post embeds; `lib/write/article.ts`, `internal/articlebody`, X DraftJS conversion, persistence and preview. Existing Plate comments/collaboration remain shared. | Article formatting/embed/save/reload and entitlement-gate browser test; article parser, signing and X adapter tests. Inline video is explicitly rejected by the article serializer. Real Article publishing and inline video support remain unresolved. |
| TF-002 | Open: product requirements | Existing queue, zen mode, draft tabs, aliases and mobile toolbar; resizable preview and visual viewport inset added. | Mobile browser flow, floating New Draft persistence/context and queue/preview checks. Shots still requires its existing paid `content:drafts` entitlement; the source's free-basic-scheduling promise is not implemented. The floating mobile New Draft action saves before navigating and retains the active social set and tag context. |
| TF-008 | Verified | `PostingTimes.tsx`, `lib/write/posting-times.ts`, Analyze route; measured engagement excludes missing data, uses the set timezone, and adds suggested weekly slots with version checks. | Seeded measured receipt browser chart/add-slot/reload; projection unit tests and authorized metrics query. |
| TF-021 | Verified | Next free slot, queue page/sidebar and shortcut retained; schedule confirmation defaults to creating a fresh draft in the same set. | New-draft-after-scheduling browser test; two-member presence/co-editing and access-revocation regression. |
| TF-031 | Verified | `DraftCalendar.tsx`, `content_draft_move.go`; free-slot moves and atomic compatible swaps use optimistic versions and immutable replacement commitments. | Browser move/swap/failure/reload; stale/concurrent/claimed-job and approval integration tests. |
| TF-034 | Verified | `content_draft_repurpose.go` copies confirmed published captions/media and confirmed replies, retains source post/account evidence, poll options and disclosure labels; Pick opens review. | G snapshot-versus-later-edit, no-job and unpublished-source cases; calendar Pick browser workflow verifies distinct draft and zero jobs. |
| TF-052 | Verified | Existing scheduling interface now shares the validated calendar move path, with keyboard-accessible date/time controls. | Browser explicit time move and reload; G stale version, permission and claimed-job checks. |
| TF-053 | Verified | Actual seven-day and 42-day calendar ranges, scheduled/published/planned entries, platform/status/tag filters, settings and keyboard navigation. | `write-calendar.test.ts`; month browser workflow; G scoped calendar reads. |
| TF-054 | Verified | Drag/drop moves and swaps in the calendar; UI changes only after successful backend mutation. | Browser failed move stays put, successful swap persists; G concurrency/ownership/approval tests. |
| TF-069 | Verified | Explicit confirmed Publish now command in `content_draft_publish_now.go`; consumes a queued snapshot once, preserves original evidence and uses the publishing state machine. | Browser confirmation/cancel/commit; G concurrent clicks, replay after lost response, already-claimed refusal, no extra monthly charge. Worker delivery verified separately with deterministic engine tests. |
| TF-072 | Verified | Per-draft natural time; deterministic ±240-second offset persisted separately from nominal slot. Near-now guard avoids unintended immediate execution. | `content_draft_natural_test.go` range/replay cases; G persisted schedule/clone and timezone validation. |
| TF-081 | Verified | Month grid uses the same move/swap service, with row sizing that preserves drop targets. | Actual 42-day browser drag/swap/reload and keyboard alternative. |
| TF-084 | Verified | Library rows carry draft drag data; weekly queue board and month slots open explicit schedule review. | `typefully-lifecycle.spec.ts` drags from the sidebar into the seven-day queue board, opens review, saves as planned, reloads and verifies zero publication jobs. |
| TF-104 | Verified | Workspace-scope authorized social sets; team selection through workspace switcher; social set/platform/status/tag/campaign filters. `calendar_campaigns.go` includes authorized campaign commitments with their identity and link. Planned drafts remain non-executable. | G private-set isolation, plans/no-jobs and campaign projection; board/planning browser check passed with persisted planned content and zero jobs. Campaign commitments use their existing campaign scheduling page rather than draft move commands. |
| TF-011 | Verified regression | Existing durable engagement-triggered repost/plug automation, separate action receipts and cancellation; scheduling supports queue and measured suggestions. | G `temporalpublishing/automation_test.go`, direct adapter automation and publishing integration; existing follow-up browser regression. Live provider not re-run. |
| TF-018 | Open: X Enterprise | Finisher UI stores quote-first-post and resolves only a confirmed root identity. | Serialization, partial thread and adapter tests. Current official X docs require Enterprise quote access; no verified Enterprise grant is available, so publication is refused. |
| TF-025 | Open: X Enterprise/live | Existing native X replies/continuation and quote target parsing, immutable references and recovery controls. | G reply threading/recovery/unknown-delivery tests and native ID validation. External X quotes remain gated on Enterprise access; real reply/continuation not tested. |
| TF-027 | Verified | Existing per-social-set engagement defaults copied into new drafts, with older drafts left unchanged. | G social-set default snapshot and isolation cases; settings/save/reload browser check passed, including unchanged older drafts and copied defaults on a fresh draft. |
| TF-036 | Verified regression | Poll on each X post, exact 5–10,080 minute duration and 2–4 Unicode choices; no media or silent legacy duration rounding. | X poll adapter root/reply wire tests, G scheduling validation, N per-post serialization. Live provider not re-run. |
| TF-039 | Open: native quote activation | Existing finisher create/edit/delete/select and reusable templates; extended native quote flags for Bluesky and supported Mastodon. | G template scoping, N settings/serialization, native adapter quote-root tests. X Enterprise gate and live quote outcomes unresolved. |
| TF-043 | Open: authorized automation | Prepared Auto-DM UI and persisted configuration; `internal/autodm` validates opt-in evidence, trigger combinations, four-day window, opt-outs, quotas and atomic ledger/sender interfaces. Delivery is disabled. | Deterministic local contract tests and prepared-settings browser reload. No production event ingestion, durable delivery ledger or sender is wired; provider approval and explicit consent ingestion are prerequisites. |
| TF-064 | Open: live verification | Existing time-based repost/unrepost rules, local wall-clock timezone or elapsed delay, persisted action keys and separate outcomes. | N automation projection, G Temporal plan/cancel/dedupe/failure and direct adapter tests; browser follow-up settings. No real X repost performed. |
| TF-071 | Open: live verification | Existing LinkedIn first-comment composer/preview and durable separate follow-up action after main-post receipt. | N publication serializer and G automation/adapter tests. The option browser regression verifies preview, reload and the immutable scheduled first-comment option; real LinkedIn comment outcome untested. |
| TF-073 | Open: live verification | Signed X community search, set-scoped API/SDK and audience picker; default everyone, numeric native community identity and public-visibility explanation. | Community request/signing/validation tests, contracts and G scoped admission; no real community membership/publication outcome tested. |
| TF-077 | Open: provider permission/live | Existing atomic LinkedIn organization mention nodes preserve native URNs in publication. Errors now surface instead of pretending empty lookup success. | Mention serialization/escaping and Go lookup tests. LinkedIn organization lookup grant and actual notification delivery unverified. |
| TF-089 | Open: unsupported mapping | Removed misleading community Share to timeline behavior; legacy true is rejected in Go. | Unsupported-option regression. Official `share_with_followers` means sharing a subscriber-exclusive post; it does not prove community-only versus timeline delivery. No alternative verified mapping. |
| TF-094 | Open: person lookup | Recently used organization search reads authorized set drafts and manual versions, deduplicating native organization identities. | `social_mentions_history_test.go`, scoped lookup integration and N atomic mentions. General authorized person search/directory is not implemented because this connection has no verified people-search API grant. |
| TF-097 | Open: live verification | Existing Paid Partnership / Made with AI composer settings preserved in per-post snapshots and mapped to documented X booleans. | N/G payload and validation coverage, option browser regression. Actual labels on X remain unverified. |
| TF-098 | Open: live verification | Existing LinkedIn native `reshareContext.parent` with user commentary, URL-to-URN target parsing, scheduling and public API contract. | N target serialization and LinkedIn adapter/native payload tests. Real LinkedIn reshare outcome untested. |
| TF-107 | Open: live verification | Everyone (omitted field), following, mentionedUsers, verified, subscribers in composer and Go allowlist, with unsupported values rejected. | N/G settings, capability and X payload tests; option browser regression. Provider-account eligibility/outcome remains untested. |
| TF-108 | Open: provider coverage | New Bluesky strong-reference quotes and record-with-media; Mastodon API-version/scopes gate, local-instance resolution, automatic approval and accepted-result check; native link-to-quote action and finisher flags. | Adapter unavailable/denied/unknown/accepted/root/reply tests, frontend validation and Bluesky quote browser persistence. X Enterprise and live outcomes unresolved; no verified public Substack Notes publishing API/adapter, so no link-only substitute is offered. |
| TF-109 | Open: live verification | Threads native poll container field; dynamic Mastodon poll limits/multiple-choice and direct publishing; LinkedIn native question/duration mapping now rejects invalid durations and poll/reshare conflicts before uploads or creation. Version copying retains editable separate per-channel settings. | Browser Threads/Mastodon independent duration/multiple-choice/reload; N/G root/reply/native payload/unsupported media/duration/unknown-capability cases, including `linkedin/poll_options_test.go` and Unicode/invalid-settings regression in `write-publication.test.ts`. Provider app permissions and live outcomes unverified. |

## Persistence and reliability

No database migration is needed for this patch: the new article HTML, poll capabilities, quote identity and preview choices live in existing versioned JSON documents and immutable publication snapshots. New commands reuse Ent transactions, expected versions, existing receipts and the Temporal publishing state machine. Campaign projections join existing campaign and scheduled-post tables without duplicating publication jobs.

Calendar moves retain immutable predecessors. Publish now has a stable replay key and rejects a job already claimed for execution. Repurposing creates an editable draft and preserves its source evidence; it does not schedule or mutate the original. Planned content remains job-free until an authorized explicit schedule/publish command. Remote unknown outcomes remain unknown; the worker does not blindly retry a provider mutation whose result cannot be established.

Custom Mastodon remains behind `PLATFORM_SOCIAL_CUSTOM_MASTODON_ENABLED=true`; native quotes additionally require instance Mastodon API version >=7 and read-search/status permissions. Existing accounts must reconnect to obtain new capability/scope proofs. API-version checks are machine-readable; server marketing version strings are not used as authorization.

## Provider evidence consulted

- [X Premium](https://help.x.com/en/using-x/x-premium): longer posts up to 25,000 characters; authenticated subscription is distinct from a user-editable Premium label.
- [X Create Posts](https://docs.x.com/x-api/posts/create-post): Enterprise quote requirement, native disclosure/reply/community fields, and `share_with_followers` subscriber-post semantics.
- [X Articles](https://docs.x.com/x-api/articles/introduction): supported article endpoints and rich content. Historical 4,000-character backlog text is preserved, but it is not used as the current API limit.
- [X automation rules](https://help.x.com/en/rules-and-policies/x-automation) and [Direct Messages](https://docs.x.com/x-api/direct-messages/introduction): authorized messaging, opt-in and user control.
- [Typefully Auto-DMs help](https://support.typefully.com/en/articles/8718257-auto-dm-campaigns): trigger combinations, campaign window and limits informed local prepared contracts; these are not a substitute for X permission.
- [LinkedIn Poll API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api) and [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api): separate 140-character question, 2–4 choices of 30 characters, four duration enum values and native reshare parent identity.
- [Threads polls](https://developers.facebook.com/documentation/threads/create-posts/polls): native `poll_attachment`, 2–4 choices, text-only; API uses provider-controlled expiry (no invented duration field).
- [Mastodon quotes](https://docs.joinmastodon.org/client/quotes/), [statuses](https://docs.joinmastodon.org/methods/statuses/), [Instance](https://docs.joinmastodon.org/entities/Instance/): API version, quote policy, accepted state and dynamic poll configuration.
- [Bluesky posts](https://docs.bsky.app/docs/about-bluesky-content/posts) and the official `@atproto/api` lexicons: URI/CID strong references, record and record-with-media/external embeds.

## Executed checks

- `npm test`: 1,058 passed, one skipped in the final run (1,029 root, eight collaboration-server, 21 Plate). This includes the added cross-platform numbering and LinkedIn poll/invalid-settings cases. The collaboration-server suite also passed separately (eight passed, one skipped).
- `go test ./...` with the migrated integration database: two packages hit cross-package fixture cleanup deadlocks. Serial reruns passed. The final serial run also exposed a test environment using the container-only Redis hostname; it was corrected to the exposed localhost port before rerunning. No application workaround was added. The final `go test -p 1 ./...` passed the full tree with Postgres and Redis configured, including publishing, notification, product, tenancy and migration packages.
- `npm run api:generate`, `npm run build:sdk`, `npm run typecheck`, `npm run lint -- --max-warnings=0`, `npm run format:check`: passed after the final code changes. All changed Go files are gofmt clean; `git diff --check` passed.
- `npm run verify:rfcs`: 17/17 passed.
- `playwright test test/e2e/typefully-lifecycle.spec.ts test/e2e/write.spec.ts --grep "brand defaults|X reply settings|on a phone" --workers=1`: three passed. The final focus-mode dependency fix was followed by another successful lifecycle test (one passed).
- After final API regeneration, `tsx --test test/openapi-contracts.test.ts test/api-platform-boundary.test.ts test/web-database-boundary.test.ts`: 19 passed.
- `npm run build`: passed (Next.js webpack production build, TypeScript and 1,138 generated pages). The build emitted MediaPipe dynamic-dependency and circular-chunk warnings; these remain build warnings, not failed checks. The built standalone server is used for the final browser pass.

The standalone test environment uses the existing `AUTH_REQUIRE_EMAIL_VERIFICATION=false` flag for local fixture accounts, with email delivery unconfigured. An initial production smoke attempt stopped at email-verification setup; after matching the test configuration, five workflows passed before the production sign-up rate limit rejected the last four account setups. Bluesky link/quote, Threads/Mastodon polls and Article/prepared-DM workflows passed on the next run. The video test passed in its own run after a full quiet rate-limit window; no production auth/rate-limit code was changed.

Final production browser commands (all nine distinct workflows passed across rate-limit-separated runs):

```sh
npx playwright test test/e2e/typefully-editor.spec.ts test/e2e/typefully-calendar.spec.ts test/e2e/typefully-lifecycle.spec.ts test/e2e/typefully-options.spec.ts test/e2e/typefully-rich.spec.ts --workers=1
# Five passed; four setup requests were rate-limited.
npx playwright test test/e2e/typefully-options.spec.ts test/e2e/typefully-rich.spec.ts --grep 'Bluesky|Threads and Mastodon|article metadata|a dropped video' --workers=1
# Three passed; the video account setup was still rate-limited.
npx playwright test test/e2e/typefully-rich.spec.ts --grep 'a dropped video' --workers=1
# One passed after a full quiet window.
```

These use `E2E_BASE_URL=http://localhost:3000` against the built standalone server, the isolated local publishing database, the mock provider and the collaboration server. No real provider account is configured. Existing authentication and rate-limit implementations are unchanged.

`npx playwright test test/e2e/typefully-rich.spec.ts --workers=1 --trace on` also passed both production Article and video workflows. Trace inspection found zero page exceptions. Video had zero console errors or HTTP failures, including successful 206 media playback. Article had two expected 404/console entries for the deliberately nonexistent embedded-post fixture `/api/tweet/123456789`; real X embed metadata remains part of the unresolved provider verification.

Additional browser evidence passed: `typefully-editor.spec.ts`; both `typefully-rich.spec.ts` tests (article and real video playback); `typefully-calendar.spec.ts` month moves/swaps/failure/replay/Pick/engagement chart; write thread/planning/recovery and AI/follow-up regressions; fresh-draft-after-schedule; Bluesky card remove/restore/quote conversion; Threads/Mastodon poll settings; two collaboration/revocation tests; phone library/composer/preview/review. Screenshots are retained locally under `.context/shots/typefully-*.png` and `.context/shots/write-*.png` and are excluded from Git.

## Defects repaired during verification

- Native video drops were not reaching the editor upload insertion path; dropped videos now upload, persist and play in preview.
- Pasted long rich text split without a reusable deterministic content/label budget; splitting now preserves rich nodes, atomic URLs and graphemes.
- Month drop targets overlapped because rows expanded; calendar row layout now preserves actual targets.
- Link metadata was fetched for partial URLs while typing; requests now debounce, and preview removal remains durable. The browser autosave regression was rechecked after restarting the local dev server with current contracts.
- Custom Mastodon was excluded from the direct provider allowlist; it now uses its verified-instance provider behind the existing explicit activation flag. Poll/quote capabilities are also forwarded by the server-side schedule serializer.
- Legacy X poll duration conversion rounded minutes to hours; native exact minutes now survive root posts and replies.
- Scheduled Publish now previously lacked the concrete immutable/replay-safe command added here.
- Focus mode left the app and draft sidebars visible; it now hides surrounding controls without remounting the collaborative editor, then restores their previous state on exit.
- Planned calendar cards displayed a default “Untitled draft” instead of their content; empty/default titles now fall back to the caption.
- LinkedIn silently substituted a one-week poll duration for an invalid duration; validation now rejects it before any upload or post mutation. Invalid editor post settings also block publication instead of disappearing into an ordinary post.
- Calendar omitted campaign commitments; authorized commitments now carry campaign identity and navigate to their own approval/scheduling workflow.

## Final audit

The original backlog was reopened and independently recounted after editing:

| Section | Checked | Open | Total |
| --- | ---: | ---: | ---: |
| 2. Editor and writing | 7 | 4 | 11 |
| 4. Scheduling, queue and calendar | 12 | 1 | 13 |
| 5. Post options per platform | 3 | 15 | 18 |
| **Total** | **22** | **20** | **42** |

The baseline had five checked entries in these sections. Seventeen additional entries are now checked. A comparison against the baseline confirms every original feature title, date, link and nested requirement is unchanged; every checkbox outside Sections 2, 4 and 5 is unchanged. Each of the 22 checked entries maps to the evidence above. This is **not a claim of 42/42 completion**.

The 20 open entries distinguish unsupported/unverified provider mappings, live outcomes, Auto-DM production ingestion/delivery, Article inline video, and the TF-002 free-scheduling requirement. Existing paid `content:drafts` controls have not been weakened. Current official X limits supersede historical 4,000-character text for validation, while that source text is preserved.

Implementation and source-checklist commit: `19e02cc65a3fa272cf15297ff258b877b6761fe5` on branch `work`, targeting `main`. This report includes the verified results for that implementation. No deployment or live provider activation is implied.
