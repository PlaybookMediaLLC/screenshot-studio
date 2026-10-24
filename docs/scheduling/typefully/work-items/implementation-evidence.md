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
| TF-049 | Verified writing/export | `thread-tools.tsx` writes and copies long-form text with authenticated X subscription limits; frontend and Go agree on the current 25,000-character Premium allowance. | `typefully-long-form.spec.ts` writes, copies exact text, reloads, saves the immutable scheduled caption, downgrades and offers splitting; boundary and signed-identity tests pass. Live publication is separately unresolved under TF-061. |
| TF-050 | Verified | `composer/emoji-picker.tsx`, `packages/platejs-editor/src/lib/emoji-search.ts`, toolbar insertion and existing Plate aliases. | Browser search, keyboard selection, focus/caret retention, rich text and reload. |
| TF-058 | Verified | Existing Plate HTML deserialization plus content-preserving split helper. | Rich HTML paste with bold, italics, list paragraphs, links and newlines; unsafe tags/atomic splitting tests. |
| TF-061 | Open: live verification | Verified 25,000-character X limits replace contradictory historical assumptions; immutable scheduled payload and direct native adapter. | Go capability/admission/adapter tests; long-form scheduling validation. Real Premium publication remains untested. |
| TF-063 | Verified | Per-version `splitLimit` and `splitOnPaste` saved in JSON; account-derived default, manual copy, numbering budget and atomic link/grapheme splits. | Browser automatic paste split/reload; standard and Premium limit fixtures; N/G. |
| TF-075 | Verified | Numbering for X, Threads, Bluesky and Mastodon threads, independently configured per version; single-post providers join without thread numbers. | `write-numbering.test.ts`, `write-publication.test.ts` cross-platform reorder/delete/no-duplication cases; browser numbering. |
| TF-102 | Open: provider activation | Article creation, title/cover, supported rich text, images and native post embeds; `lib/write/article.ts`, `internal/articlebody`, X DraftJS conversion, persistence and preview. Existing Plate comments/collaboration remain shared. | Article formatting/embed/save/reload and entitlement-gate browser test; article parser, signing and X adapter tests. Rich media consists of supported images and native post embeds; unsupported inline video is rejected before scheduling. Real Article publication remains unverified. |
| TF-002 | Verified | Queue, zen mode, tabs, aliases, responsive toolbar, preview resizing and mobile New Draft; approved limited free tier in `lib/billing/plans.ts`, Go quotas/capacity and `content_draft_plan.go`. | Mobile and free scheduling browser flows; Go verifies one seat/account, ten posts, replay, paid queue/natural-time/automation gates, no AI, upgrades and preserved downgrade usage. RFC 035 records the explicit product-owner amendment. |
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
| TF-018 | Open: X Enterprise | Finisher UI stores quote-first-post and resolves only a confirmed root identity. | Serialization, partial thread and adapter tests. Current official X docs require Enterprise quote access. `PLATFORM_X_ENTERPRISE_QUOTES_ENABLED` gates both admission and execution; approval/revocation and native quote submission are tested, but no deployed Enterprise grant is available. |
| TF-025 | Open: X Enterprise/live | Existing native X replies/continuation and quote target parsing, immutable references and recovery controls. | G reply threading/recovery/unknown-delivery tests and native ID validation. External X quotes remain gated on Enterprise access; real reply/continuation not tested. |
| TF-027 | Verified | Existing per-social-set engagement defaults copied into new drafts, with older drafts left unchanged. | G social-set default snapshot and isolation cases; settings/save/reload browser check passed, including unchanged older drafts and copied defaults on a fresh draft. |
| TF-036 | Verified regression | Poll on each X post, exact 5–10,080 minute duration and 2–4 Unicode choices; no media or silent legacy duration rounding. | X poll adapter root/reply wire tests, G scheduling validation, N per-post serialization. Live provider not re-run. |
| TF-039 | Open: native quote activation | Finisher create/edit/delete/select/search and reusable templates without the former 50-template cap; strict update payloads, platform-aware counts, and application to independently edited versions; native quote flags for Bluesky and supported Mastodon. | G template scoping and 51-template persistence; browser create/edit/search/apply/reload/delete in an independent Bluesky version; N settings/serialization and native adapter quote-root tests. X Enterprise gate and live quote outcomes unresolved. |
| TF-043 | Verified pre-approval scope | Prepared campaigns from publish review; durable Ent campaign/recipient/opt-out/delivery ledger in `internal/autodm`, authenticated event-verifier/permission interfaces, and tenant-bound native X DM sender. Production delivery stays disabled as explicitly required until provider approval. | PostgreSQL concurrency, restart dedupe, unknown outcomes, sticky opt-outs, consent expiry/revocation, account-wide quotas, immutable campaign binding; native DM receipt/error tests and prepared-campaign browser persistence pass. No production event verifier or automatic campaign activation is registered. |
| TF-064 | Open: live verification | Existing time-based repost/unrepost rules, local wall-clock timezone or elapsed delay, persisted action keys and separate outcomes. | N automation projection, G Temporal plan/cancel/dedupe/failure and direct adapter tests; browser follow-up settings. No real X repost performed. |
| TF-071 | Open: live verification | Existing LinkedIn first-comment composer/preview and durable separate follow-up action after main-post receipt. | N serializer and G durable automation/native adapter tests, including ambiguous receipts, redirects, 408/5xx outcomes and no duplicate mutation. Browser verifies preview, reload and immutable scheduled options; real LinkedIn comment outcome untested. |
| TF-073 | Open: live verification | Signed X community search, set-scoped API/SDK and audience picker; default everyone, numeric native community identity and public-visibility explanation. | Community request/signing/validation tests, contracts and G scoped admission; no real community membership/publication outcome tested. |
| TF-077 | Open: provider permission/live | Native organization mentions retain URNs and escape LinkedIn little-text reserved characters; organization search uses the current `/rest/organizations` endpoint and reports denied grants. | Native query/header/error tests, serializer tests, and mention browser selection/reload/scheduled snapshots pass. Actual organization notification delivery remains unverified. |
| TF-089 | Open: live verification | Audience, schedule and publish review share a persisted timeline toggle; API snapshots map both true and false to X `share_with_followers` when `community_id` is present. The July 2025 official X changelog confirms community broadcasting; off does not make the post private. | Both native request choices and serialization tests pass; community browser flow covers audience/reload/review/schedule. Real follower-timeline distribution remains unverified. |
| TF-094 | Open: provider approval/live | Durable set-scoped company/person directory, native URNs, literal label/identity search, current organization lookup, and restricted Page follower People Typeahead search. History is committed with accepted draft saves and copies, backfilled from all existing versions, and survives draft deletion. `PLATFORM_LINKEDIN_PEOPLE_MENTIONS_ENABLED` requests the approved grant only when enabled. | Migration backfill/latest-label/cascade and directory deletion/search/private-set/stale-save/copy tests; Page-bound keyword queries and denied/malformed responses; browser deletes the original draft, then selects both identities and schedules native annotations. Restricted app grant and real notification outcomes remain unverified. |
| TF-097 | Open: live verification | Existing Paid Partnership / Made with AI composer settings preserved in per-post snapshots and mapped to documented X booleans. | N/G payload and validation coverage, option browser regression. Actual labels on X remain unverified. |
| TF-098 | Open: live verification | LinkedIn native `reshareContext.parent` with user commentary, strict feed/public-share URL parsing, encoded URNs, scheduling and public API contract. A URN in an unrelated URL query/path is rejected. | N/G feed/share URL and invalid-host/path tests, native adapter payload tests; browser public share link → quote draft → first-comment preview/reload → immutable scheduled native identity. Real LinkedIn reshare outcome untested. |
| TF-107 | Open: live verification | Everyone (omitted field), following, mentionedUsers, verified, subscribers in composer and Go allowlist, with unsupported values rejected. | N/G settings, capability and X payload tests; option browser regression. Provider-account eligibility/outcome remains untested. |
| TF-108 | Open: provider coverage | New Bluesky strong-reference quotes and record-with-media; Mastodon API-version/scopes gate, local-instance resolution, automatic approval and accepted-result check; native link-to-quote action and finisher flags. | Adapter unavailable/denied/unknown/accepted/root/reply tests, frontend validation and Bluesky quote browser persistence. X Enterprise and live outcomes unresolved; no verified public Substack Notes publishing API/adapter, so no link-only substitute is offered. |
| TF-109 | Open: live verification | Threads native poll container field; dynamic Mastodon poll limits/multiple-choice and direct publishing; LinkedIn native question/duration mapping now rejects invalid durations and poll/reshare conflicts before uploads or creation. Explicit Copy options from control reuses choices from any other platform/post while preserving the destination question, duration, voting mode and content; incompatible options are preserved for visible validation rather than truncated. | Browser copies Threads choices to Mastodon and LinkedIn, preserves 45-minute multiple choice and a separate one-week question, reloads, and flags an oversized Mastodon choice on LinkedIn; N/G root/reply/native payload/unsupported media/duration/unknown-capability cases, including `linkedin/poll_options_test.go` and Unicode/invalid-settings regression in `write-publication.test.ts`. Provider app permissions and live outcomes unverified. |

## Persistence and reliability

Two additive migrations are required: `20261102100000_platform_auto_dm.sql` adds the durable campaign, recipient, opt-out and delivery ledger; `20261102110000_platform_draft_collab_generation.sql` adds `content_draft.collabGeneration` with a zero default. Both were applied to the local application and integration databases. Article HTML, poll capabilities, quote identity and preview choices remain in versioned JSON documents and immutable publication snapshots. New commands reuse Ent transactions, expected versions, existing receipts and the Temporal publishing state machine. Campaign projections join existing campaign and scheduled-post tables without duplicating publication jobs.

Calendar moves retain immutable predecessors. Publish now has a stable replay key and rejects a job already claimed for execution. Repurposing creates an editable draft and preserves its source evidence; it does not schedule or mutate the original. Planned content remains job-free until an authorized explicit schedule/publish command. Remote unknown outcomes remain unknown; the worker does not blindly retry a provider mutation whose result cannot be established.

Custom Mastodon remains behind `PLATFORM_SOCIAL_CUSTOM_MASTODON_ENABLED=true`; native quotes additionally require instance Mastodon API version >=7 and read-search/status permissions. Existing accounts must reconnect to obtain new capability/scope proofs. API-version checks are machine-readable; server marketing version strings are not used as authorization.

External body replacement clears the previous collaboration state and increments the room generation. Old tokens, stores and stale live-editor projections are rejected. Autosaves from the current room retain the generation and never resurrect a replaced body. Database CAS tests and two-member edit/reload/revocation browser tests cover the change.

### Deployment and activation

Apply the additive migrations before rolling out the Go API, workers, web and collaboration server together. Existing generation-zero draft rooms remain valid. External replacements move clients to new rooms; keep old binaries out of service before enabling this path so they cannot overwrite projections without generation checks. Retain tables and generation columns on code rollback; do not destructively reverse the ledger migration or discard delivery evidence. No new publication worker or external delivery was started during verification.

Operator-managed provider switches are off by default:

- `PLATFORM_X_ENTERPRISE_QUOTES_ENABLED=true` only after the deployed app has X Enterprise quote access. Both schedule admission and native execution enforce the current setting.
- `PLATFORM_LINKEDIN_PEOPLE_MENTIONS_ENABLED=true` only after approval for People Typeahead; reconnect LinkedIn Pages for `r_organization_followers`. A denied grant is an error, not an empty successful directory.
- `PLATFORM_X_AUTO_DM_DELIVERY_ENABLED=true` controls the native sender but does **not** activate campaigns. Production still needs an approved provider event verifier, tenant/account authorization and consent/opt-out ingestion wired to the durable ledger. No generic client event can establish consent. Leave it off until that approved deployment exists.

Prepared Auto-DM settings never schedule a delivery. Reservations are permanent across restarts and unknown results; retries cannot resend an uncertain DM. STOP and removal events stay effective after access revocation.

## Provider evidence consulted

- [X Premium](https://help.x.com/en/using-x/x-premium): longer posts up to 25,000 characters; authenticated subscription is distinct from a user-editable Premium label.
- [X Create Posts](https://docs.x.com/x-api/posts/create-post): Enterprise quote requirement, native disclosure/reply/community fields, and reply/community fields. [X changelog, July 2025](https://docs.x.com/changelog) explicitly documents broadcasting community posts with `share_with_followers`; this resolves the earlier incomplete interpretation of the field description.
- [X Articles](https://docs.x.com/x-api/articles/introduction): supported article endpoints and rich content. Historical 4,000-character backlog text is preserved, but it is not used as the current API limit.
- [X automation rules](https://help.x.com/en/rules-and-policies/x-automation) and [Direct Messages](https://docs.x.com/x-api/direct-messages/introduction): authorized messaging, opt-in and user control.
- [Typefully Auto-DMs help](https://support.typefully.com/en/articles/8718257-auto-dm-campaigns): trigger combinations, campaign window and limits informed local prepared contracts; these are not a substitute for X permission.
- [LinkedIn Poll API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api) and [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api): separate 140-character question, 2–4 choices of 30 characters, four duration enum values and native reshare parent identity.
- [LinkedIn People Typeahead](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-atmention-search-api?view=li-lms-2026-06): restricted Page-follower search, native person URNs and required `r_organization_followers` permission. [Organization lookup](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-03) documents the current REST organization endpoint.
- [Substack AI connector](https://support.substack.com/hc/en-us/articles/50834026608916-How-to-connect-Substack-to-your-AI-Assistant) is read-only and cannot publish Notes; no verified official public Notes write API is available for this implementation.
- [Threads polls](https://developers.facebook.com/documentation/threads/create-posts/polls): native `poll_attachment`, 2–4 choices, text-only; API uses provider-controlled expiry (no invented duration field).
- [Mastodon quotes](https://docs.joinmastodon.org/client/quotes/), [statuses](https://docs.joinmastodon.org/methods/statuses/), [Instance](https://docs.joinmastodon.org/entities/Instance/): API version, quote policy, accepted state and dynamic poll configuration.
- [Bluesky posts](https://docs.bsky.app/docs/about-bluesky-content/posts) and the official `@atproto/api` lexicons: URI/CID strong references, record and record-with-media/external embeds.

## Original implementation checks (commit 19e02cc6)

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

## Continuation verification

The continuation adds the approved free tier, native community broadcasting, restricted LinkedIn people lookup, updated LinkedIn organization lookup, receipt-safe LinkedIn mutations, X Enterprise quote activation, the durable pre-approval Auto-DM implementation, and collaboration generations. Final verification results:

- `npm test`: **1,062 passed, one skipped** (1,033 root, eight collaboration-server, 21 Plate).
- `go test -p 1 ./...` with the migrated Postgres integration database and localhost Redis: **128 tested packages passed**. After the final rollout-flag guard, `go test ./internal/product -count=1` passed again against Postgres (20.5 seconds).
- `npm run api:generate` and `npm run build:sdk`: passed; public OpenAPI, generated client, backend SDK and Go MCP entitlement metadata agree.
- `npm run typecheck`: passed. `npm run lint -- --max-warnings=0`, `npm run format:check`, `npm run verify:rfcs` (17/17), gofmt on all changed Go files and `git diff --check`: passed.
- `npx tsx --test test/openapi-contracts.test.ts test/api-platform-boundary.test.ts test/workspace-plans.test.ts test/write-publication.test.ts`: **44 passed** after the final scheduling-contract regeneration.
- `npm run build`: passed with **1,138 pages** and successful TypeScript checking. The existing MediaPipe dynamic-dependency and circular-chunk warnings remain.
- Development-browser continuation tests passed: free scheduling, Premium writing/copy/downgrade, LinkedIn company/person recents, prepared Auto-DM review, community audience/review/snapshot, and both collaboration/revocation workflows. All 15 distinct production workflows also passed as described below.

Production browser verification ran against the built standalone Next application with the real Go API, migrated database, Redis, object storage and collaboration service. The first run passed nine workflows; two remaining tests hit `ENOSPC` while writing traces and four account setups received the production signup rate limit. Generated Next cache was moved off the full workspace disk. Publishing fixtures now reuse the existing authenticated signup helper that honors `Retry-After`; production limits were unchanged. All six affected workflows then passed.

```sh
npx playwright test test/e2e/typefully-community.spec.ts test/e2e/typefully-free.spec.ts test/e2e/typefully-long-form.spec.ts test/e2e/typefully-mentions.spec.ts test/e2e/typefully-editor.spec.ts test/e2e/typefully-calendar.spec.ts test/e2e/typefully-lifecycle.spec.ts test/e2e/typefully-options.spec.ts test/e2e/typefully-rich.spec.ts test/e2e/content-draft-collaboration.spec.ts --workers=1 --trace on
# Nine passed; six infrastructure/account-setup failures as described above.
npx playwright test test/e2e/typefully-lifecycle.spec.ts test/e2e/typefully-long-form.spec.ts test/e2e/typefully-mentions.spec.ts test/e2e/typefully-rich.spec.ts --workers=1 --trace on --output=/tmp/shots-production-retry-traces
# Six passed in 1.3 minutes.
```

The 15 passed workflows cover two-member collaboration and revocation; calendar moves/swaps/failed moves/Publish now/Pick/analytics; Community audience/review/scheduled snapshots; rich paste/emoji; free onboarding and scheduling; default engagement settings and planned-only board drag; native disclosure/reply/first-comment options; long-form exact copy/scheduling/downgrade; LinkedIn companies and people; fresh draft after scheduling; Bluesky card removal/quote conversion; platform poll persistence; Article/prepared-DM persistence; and actual dropped-video playback.

Trace inspection found **zero page exceptions** in all passed flows. HTTP failures were deliberate tenant/role/plan denials, the injected calendar 503 and the nonexistent Article embed fixture `/api/tweet/123456789`. Video playback returned 206 successfully. The six rerun workflows had no unexpected console errors or HTTP failures; Article had three expected missing-embed 404 entries. Traces are local test artifacts, not public provider verification.

After synchronizing the remaining pricing and public API guidance, the final production build passed again. A final smoke run also passed:

```sh
npx playwright test test/e2e/typefully-free.spec.ts test/e2e/write.spec.ts --grep 'free scheduling|on a phone' --workers=1 --trace on --output=/tmp/shots-final-smoke-traces
# Two passed in 19.8 seconds, including the phone library/composer/review.
```

That brings the continuation to **16 distinct passing production browser workflows**, with free scheduling checked again on the final build. The final `npm test` rerun still passed 1,062 tests with one skip; final lint, formatting, generated contracts, RFC checks and build TypeScript also passed.

Additional defects fixed during the continuation:

- A saved X Community `false` value was lost by Go's `omitempty` and by the frontend option compactor; both preserve the explicit choice now. Publish review and scheduling share the same toggle.
- Replacing a draft through the API could resurrect the previous collaborative body. Room generations, stale-token/store checks and projection CAS prevent that overwrite.
- LinkedIn mutation responses without a verified post/comment receipt could be treated as success or retried. Ambiguous mutation results now stay unknown, redirect following is disabled, and native comments/reposts retain the intended provider identities.
- Quote follow-ups now use native quote/reshare fields and require confirmed roots and current app access; an ordinary URL is never substituted.
- Free access is separated from paid pages, AI, purchased-credit use, legacy scheduling, release listing and advanced queue operations. Global rollout flags cannot reopen paid campaigns for free or expired workspaces. Quota replay and upgrade/downgrade behavior remain enforced.

The approved free scheduling policy is documented in RFC 035. Queue swaps and the legacy variant scheduler remain paid; explicit basic scheduling uses the versioned content-draft path. Both migrations are additive and retain all existing publication evidence.

## Work completed without live X access

The user's final scope prioritizes the work that does not require exercising X end to end. This pass closes the remaining local gaps in TF-039, TF-094, TF-098 and TF-109 and adds independent LinkedIn-only verification for TF-071/TF-077. No X account or live provider request was needed. The original provider-outcome requirements remain visible and unchecked; this pass does not turn protocol fixtures into a claim of provider activation.

- **Mention directory:** `20261102120000_platform_social_mention.sql` adds tenant/set-scoped history and backfills all primary/manual draft versions, selecting the most recent valid label. Normal saves and draft copies update it in the same transaction. Searches return 30 recent matches across the entire directory, rather than scanning only the latest 100 drafts. Deleting a draft retains history; deleting its social set cascades it. Failed version checks cannot update the directory.
- **Finisher library:** removed the arbitrary 50-template ceiling, added text/name search and the active platform's character counter, and enabled application to manual platform versions. Browser verification found and fixed a pre-existing update bug: read-only ID/timestamp fields were sent to the strict PATCH contract. Saves now send only editable fields.
- **LinkedIn reposts and comments:** public `/posts/…-activity-ID-…` share links now offer quote conversion in addition to native feed links. The API and UI agree on host/path validation and encoded feed URNs. A LinkedIn-only browser flow preserves commentary, previews and reloads its first comment, and verifies both the reshare identity and comment in the immutable scheduled record. The existing separate, receipt-safe comment automation and native adapter regression tests remain passing.
- **Poll reuse:** each poll can copy choices from another platform/post in the draft. It preserves the destination's separate question, duration and multiple-choice setting, and does not replace post text or media. Oversized or excessive options remain intact and are flagged before publication. HTML input limits allow valid Unicode characters without treating emoji as two provider characters; the popup scrolls within the available viewport. Browser coverage exercises Threads → Mastodon and Threads → LinkedIn, then an incompatible Mastodon → LinkedIn copy and correction.

Apply the new additive mention-directory migration before rolling out the API. Existing drafts remain unchanged. On code rollback, retain the directory table and migration record. The migration and accepted-save tests ran against disposable/local Postgres databases; no production migration or deployment was performed.

Verification for this pass:

- `npm test`: **1,065 passed, one skipped** (1,036 root, eight collaboration-server, 21 Plate).
- `go test -p 1 ./...` with the integration database and Redis configured: **128 tested packages passed**. After adding directory updates to cross-set draft copies, the full product and migration packages passed again with `-count=1`.
- The new backfill test executes the real migration against an isolated transactional schema, checks primary/manual mentions and latest-label selection, rejects malformed identities, and verifies draft retention/set deletion. Applying all migrations again passed the idempotency check. The new migration was applied to both local application and integration databases.
- API generation, SDK compilation, full lint with zero lint warnings, formatting and all 17 RFC checks passed. Source audit confirms 109 original entries and all nested requirements preserved, out-of-scope checkboxes unchanged, and exactly 42 matching evidence rows.
- Four targeted development browser workflows passed. An incorrect test count was corrected; a partial trace archive was discarded and rerun. The finisher edit failure found by the browser was fixed before the passing rerun.

The final production build passed (Next.js 16.3.5 webpack, TypeScript, 1,138 pages). Its existing MediaPipe dynamic-dependency and circular-chunk warnings remain nonfatal. All **four targeted production browser workflows passed** using the actual standalone web server, current Go API and local services:

```sh
npx playwright test test/e2e/typefully-non-x.spec.ts test/e2e/typefully-mentions.spec.ts test/e2e/typefully-options.spec.ts --grep 'finisher templates|LinkedIn share|LinkedIn recent|polls copy choices' --workers=1 --trace on --output=/tmp/shots-non-x-production-traces
# Three passed; the poll test was interrupted to correct its viewport-transition setup.
npx playwright test test/e2e/typefully-options.spec.ts --grep 'polls copy choices' --workers=1 --trace on --output=/tmp/shots-non-x-production-poll-traces
# One passed in 16.2 seconds, including 30 emoji choices and the 390px phone layout.
```

The corrected poll test explicitly closes the desktop popup before resizing and reopening it on the phone. Trace inspection for the four passed workflows found **zero page exceptions and zero failed HTTP responses**. Screenshots were visually reviewed; they are under `.context/shots/`. No live X or other provider submission was performed.

## Final audit

| Section | Checked | Open | Total |
| --- | ---: | ---: | ---: |
| 2. Editor and writing | 8 | 3 | 11 |
| 4. Scheduling, queue and calendar | 13 | 0 | 13 |
| 5. Post options per platform | 4 | 14 | 18 |
| **Total** | **25** | **17** | **42** |

The baseline had five checked entries. Twenty additional entries are checked, including TF-043 under the assignment's explicit pre-approval exception. Every original title, date, source link and nested requirement is retained; checkboxes outside Sections 2, 4 and 5 are unchanged.

All 42 entries have been audited and have implementation/evidence rows above. This is **not a claim that all 42 are fully verified**. The 17 unchecked entries retain precise external gates: live provider results skipped at the user's request, restricted X/LinkedIn application grants, unverified X link-card removal, and unavailable official Substack Notes publishing. They cannot honestly be marked complete using local fixtures. Current X limits supersede historical 4,000-character text for validation, while the original requirement text is preserved.

The source checklist and this report cover the original implementation and subsequent local completions on branch `work`, published to `codex/typefully-sections-2-4-5`. No deployment or live provider activation is implied.

Implementation commits: [`19e02cc6`](https://github.com/PlaybookMediaLLC/screenshot-studio/commit/19e02cc65a3fa272cf15297ff258b877b6761fe5) contains the original editor/calendar/native-option implementation; [`3b9e2198`](https://github.com/PlaybookMediaLLC/screenshot-studio/commit/3b9e21989b4e1fd65aa6d23b987a240890a73bef) contains the continuation, additive migrations, free-tier amendment, source checkbox updates and final verification report. The review branch is `codex/typefully-sections-2-4-5`. No merge or deployment was performed.
