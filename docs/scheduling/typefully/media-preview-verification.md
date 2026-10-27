# Media and preview implementation audit — 2026-10-24

Scope: Sections 3 and 6 of [the original backlog](changelog-features.md), against the expanded acceptance requirements supplied for this task. This work reopens those sections without declaring the October 23 roadmap or unrelated backlog entries complete.

**This is not a 17/17 release certification.** The user confirmed that no approved GIPHY server/storage integration or authorized X/LinkedIn test accounts are available. No real social post was published. Provider protocol tests below use local HTTP fixtures; browser tests use real authentication, Go, PostgreSQL, collaboration and object storage, with credential-free social connection fixtures. Local adapter success is not evidence of a live provider outcome.

## Architecture and persisted behavior

- The existing Asset table, signed write-once upload, completion endpoint, Go authorization, storage quotas and publishing workers remain authoritative. No new media service or database schema was introduced. Existing `parentAssetId`, `altText`, dimensions, checksums and status fields carry lineage and readiness. Platform migrations and social migrations were exercised twice each against a disposable PostgreSQL test database.
- `server/internal/medialimits/limits.json` is embedded by Go and imported by `lib/write/media-limits.ts`. Paid image ingestion is 20,000,000 bytes; the internal free limit is 5,000,000 bytes; PDFs are 100,000,000 bytes (100 MB)/300 pages, matching the conservative decimal interpretation of the current LinkedIn contract. The application video ceiling remains 512 MiB. This does **not** imply support for the full 8/16 GB upload sizes currently documented by X.
- Completion verifies actual stored length, optional SHA-256, magic bytes, decodable static images and a 64-megapixel ceiling. Animated GIF validation walks every bounded frame, checks the complete container/LZW stream and palette indices, and rejects malformed or excessive animations without allocating every bitmap. Generated images now pass the same image checks and plan ceiling. PDF validation uses the document catalog/page tree through pdfcpu rather than counting `/Page` text markers. Invalid completion cannot become `UPLOADED`.
- `asset_derivatives.go` makes durable X/Bluesky/LinkedIn derivatives when static images exceed a byte/dimension limit, need a supported encoding, or carry JPEG EXIF orientation. LinkedIn WebP converts to PNG. Shared conservative maximum edges are 4,096 for X/Bluesky and 6,000 for LinkedIn; they are application processing choices, not claimed provider entitlements. It corrects EXIF orientation, preserves aspect and alpha, uses explicit JPEG quality/Lanczos filtering, keeps originals, inherits descriptions and reuses cached derivatives. Scheduling pins derived IDs without changing the caller's selection. These are **not yet a complete profile catalog for every destination**.
- LinkedIn now inspects actual image bytes, including when delivery URLs carry signed queries. Animated GIFs retain every original byte, PNG transparency survives preparation, and invalid GIFs or more than 250 frames are rejected before native upload initialization. Image reads and decompression are bounded. Shared extension routing inspects the URL path instead of matching `.pdf`/`.mp4` anywhere in the URL, preventing query parameters or directory names from choosing the wrong provider upload endpoint.
- Slate media metadata travels in `SerializedPost.media`, next to the same caption and ordered asset IDs that publication consumes. Preview, move/copy, framing and tags share that representation. Excess attachments, repeated IDs within a post, pending media and invalid photo-tag metadata block scheduling; attachment truncation was removed. Reordering uses Slate operations, including nested attachments, so undo and discussion anchors survive.
- Frames reuse `lib/render/scene-renderer.ts` and the existing design document/rendering stage. A separate derived PNG is uploaded, with original lineage and ALT; no shared source is overwritten.
- New documented session routes are `POST /api/v1/content-drafts/link-image`, `GET /api/v1/content-drafts/giphy` and `POST /api/v1/content-drafts/giphy`. Zod contracts and generated OpenAPI/client schema include them. Upload contracts/SDK accept `parentAssetId`; publication contracts/SDK/Go options accept native X `taggedUserIds`.
- `preview-layout.ts` versions assumptions as `2026-10-24.1`. LinkedIn uses three rendered lines. Long X text uses the 280-weighted-character entity window and a ten-line ceiling, preserving URL entities and graphemes. These are documented simulations, **not verified native cutoffs**. The browser viewport is never resized to simulate a phone; intrinsic preview content scales inside an independently scrolling panel.

## Commands and observed verification

Run web commands from the repository root and Go commands from `services`. Runtime versions used: Node 22.23.4, Go 1.26.10, Chromium 153. The cloud environment activation file supplied those runtimes. Database integration commands used `shots_media_test`; no production database was used.

| Key | Exact command | Result / interpretation |
| --- | --- | --- |
| Q | `npm run quality:check` | PASS on the final web source: formatting, zero-warning ESLint, Next type generation/TypeScript, root and workspace tests, RFC checks. After integrating Plan/Analyze from develop, the full run passed 1,058 root tests and 21 editor tests; collaboration passed 8 with 1 Redis-dependent skip. K separately executes the Redis-dependent test. |
| M | `npx tsx --test test/write-media-preview.test.ts` | PASS, 5 tests after the second audit, including nested moves/undo. |
| L | `NODE_OPTIONS='--conditions=react-server' npx tsx --test test/write-giphy.server.ts test/write-link-image.server.ts` | PASS, 3 tests: approved-design fixture search/re-resolution/rate-limit handling and gate enforcement, controlled metadata transport with actual Sharp decoding, and unsafe-fetch rejection. All transports are local fixtures; no live GIPHY/public-source claim. |
| C | `npm run api:generate` then `npx tsx --test test/openapi-contracts.test.ts` | PASS, 11 contract/spec tests; repository spec and typed client regenerated. |
| G | `go test ./...` then `go vet ./...` | PASS. Tests requiring database environment variables skip in this broad run; I below actually executes them. |
| I | `go run ./cmd/platform-migrate` twice; `go run ./cmd/social-migrate` twice; `go test ./internal/product ./internal/publishing ./internal/social/tenantpublishing ./internal/social/integrations/social/x ./internal/social/integrations/social/linkedin` | PASS with `DATABASE_URL`, `PUBLISHING_TEST_DATABASE_URL` and `SOCIAL_TEST_DATABASE_URL` set to the disposable test database. Includes derivative persistence/retry, small-but-wide transparent PNG resizing, and native document processing. Fixture image dimensions were corrected after new validation appropriately rejected incomplete test rows. |
| B | `npx playwright test test/e2e/write-media.spec.ts test/e2e/write.spec.ts --grep 'TF-\|a thread is written once\|on a phone'` | PASS, 12/12 in 4.4 minutes: ten media/preview scenarios and the two existing Write thread/phone regressions. Includes six screenshot comparisons without updating baselines, native clipboard copying, caret/scroll preservation, real storage/database assertions and zero uncaught page errors. Social providers are local fixtures. The subsequent Go-only signed-URL correction is covered by native adapter tests in G. |
| P | `npm run build` | PASS on the final source: compilation, TypeScript, 1,132 static pages and build traces. MediaPipe dynamic-import and webpack circular-chunk warnings remain in the build output. |
| K | `COLLAB_TEST_REDIS_URL="$REDIS_URL" npm test -w @shots/collab-server` | PASS, 9/9 with zero skips, including edits/writer tokens across replicas. |
| N | `go test -race ./internal/social/chat/mcp` | PASS with `PUBLISHING_TEST_DATABASE_URL` set to the disposable PostgreSQL database. Covers tenant isolation, revocable asset download grants and approved-content scheduling. GitHub CI exposed existing fixtures with incorrect declared byte counts and a truncated capture PNG; the fixtures now supply valid PNG bytes and matching sizes without weakening validation. |

For URL-image B coverage, `E2E_LINK_FIXTURE_HOST=localhost` and the web server’s existing explicit E2E allowlist `SCREENSHOT_E2E_ALLOWED_DOWNLOAD_HOSTS=localhost` permit a controlled metadata server. The production default remains empty: private hosts and redirects are rejected. This is not a public-egress bypass. For B the stack uses `E2E_BASE_URL=http://localhost:3000`, `E2E_DATABASE_URL`, the existing E2E maintenance/object-store/Redis configuration, and `SOCIAL_API_URL=http://127.0.0.1:5679/api/public/v1`. The server at that address is the repository's local provider fixture. `test/e2e/framework/content-drafts.ts` creates the accounts and workspace. The credentials are not included here.

Merge review regressions also passed: `go test -race ./internal/product -run 'TestScheduledImageDerivative|TestSmallWideImage' -count=1` with the disposable PostgreSQL database rejects spoofed conversion cache entries from both public asset upload paths and preserves retry identity. Trusted provider conversions now use a server-controlled object namespace; legacy or caller-created children are not trusted. `npx playwright test test/e2e/write-media.spec.ts --grep 'typed provider mentions'` passed the removal of inherited X tags from an independent LinkedIn version, successful LinkedIn scheduling, and retention of the primary X tags. TypeScript, targeted ESLint/formatting and the five media unit tests also passed after these fixes.

Develop advanced to `1e491089` (Plan/Analyze) during merge preparation. The combined branch regenerated OpenAPI and the typed client, passed all 11 contract tests, repeated Q and G successfully, and applied the new migrations to the disposable database. `go test -race ./internal/product -run 'TestScheduledImageDerivative|TestSmallWideImage|TestWritePublishing' -count=1` also passed against that database, covering media conversion and scheduling together with the new calendar-version behavior.

The RFC verifier's separately reported check total counts RFC document checks. It does **not** count the seventeen features in this assignment. The repository renumbered the Write RFC to 025 and pricing RFC to 023 while this change was being prepared for merge.

Commit preparation also invoked `make check`. Its Docker environment failed during `npm ci` with npm’s “Exit handler never called!” error, before application checks ran. The equivalent host quality checks above passed; this container bootstrap failure is not reported as a passing check.

The full repository browser suite is not green at the merge base, `03982053`. Existing runs on [develop](https://github.com/PlaybookMediaLLC/screenshot-studio/actions/runs/40121685709) and [main](https://github.com/PlaybookMediaLLC/screenshot-studio/actions/runs/40125478774) show the same editor slide-removal, social availability/connection/OAuth, and AI copilot failures observed in [this PR's superseded run](https://github.com/PlaybookMediaLLC/screenshot-studio/actions/runs/40129643307). These failures precede this change; the affected application paths and tests are unchanged by the media work. The passing focused browser scenarios above do not imply that the full browser suite passed. Merge readiness uses the repository's required Branch policy and CI validation checks, the passing backend/social/API checks, and the focused media regression evidence; these existing browser failures remain separate follow-up work.

### Requested user workflows

| Scenario | Observed result and boundary |
| --- | --- |
| 1. Upload → ALT → save → reload | B passes with real tenant assets, persistent descriptions and preview ALT. |
| 2. Clipboard/move/reorder → publication representation | B uses native browser copy/paste and real drag/drop, checks stable asset IDs/order after reload; M checks normalized publishing order. No live post. |
| 3. GIPHY → GIF → save/reopen | B exercises fixture search, errors and a real two-frame stored attachment. Approved live GIPHY is externally blocked and remains disabled. |
| 4. Frame → transformed output | B applies/reopens/cancels edits and exports/decodes the actual framed PNG with source lineage. |
| 5. URL image → persistent attachment | B resolves a controlled HTML/PNG server, stores, reloads and schedules the attachment. Public egress is unverified in this runtime. |
| 6. Long video → schedule → provider result | B uploads/schedules the real 600-second source. G tests native upload and processing protocols; authorized live processing/publication is blocked. |
| 7. High-resolution video quality | B and G inspect 1920×1080 H.264 and unchanged stored/staged bytes. Provider-accepted playback resolution is externally blocked. |
| 8. Mixed media and rejection rules | B persists a GIF/image combination, sees the restriction and verifies backend rejection with no scheduled rows; a single GIF schedules successfully. X currently prohibits the requested mix. |
| 9. PDF → page preview → schedule → provider result | B navigates the real PDF, reloads settings and schedules its durable document ID. G validates original-byte native upload/processing/recovery; live receipt is blocked. |
| 10. Live desktop/mobile preview and expansion | B verifies current normalized text, media, device scaling, collapse/expansion, modal access and six visual baselines. Native cutoff parity is unverified. |
| 11. Switch drafts and reopen preview | B verifies editor caret, independent scroll, rapid edits, Cmd/Ctrl+K restoration, real sidebar navigation and draft isolation. |
| 12. Disconnect/reconnect and permissions | I executes OAuth identity/reconnect checks and expired-credential rejection. No real-account browser reconnect was possible without authorized accounts. |

## Per-feature second audit

Paths below are repository-relative; `composer/` abbreviates `components/write/composer/`, `product/` abbreviates `server/internal/product/`, and social adapter paths are under `server/internal/social/`. Test names are named explicitly; command keys refer to the complete commands above. “Open” preserves the original `[ ]`, including when local implementation is substantial.

### TF-001 — Images, quote links, and @mention suggestions — open

Implemented/reused: file/drop upload through `components/drafts/DraftEditor.tsx`, durable asset completion, media copy/move, escaped normalized previews, provider-aware typed `@` suggestions and an explicit mention picker, published-thread URL copying in `components/write/library.tsx`, timezone display in `composer/schedule.tsx`, existing link cards and quote target UI. X lookup now separates numeric native user ID from handle in `social/integrations/social/x/provider.go` and `integrations/provider.go`. No mention is substituted for a native photo tag.

Tests: M's move/copy/order test; Q's `test/write-publication.test.ts` → `mentions serialize the way each platform reads them`, `test/write-zoned-time.test.ts` and `test/content-draft-serialize.test.ts`; G/I's `x/publishing_limits_test.go` → `TestPublishingRejectsUnverifiedArticleAndQuote`. B’s image/frame/reorder scenario verifies uploaded image/save/reload; the preview scenario verifies literal `<script>` text, Unicode and live edits.

Additional verification: the authenticated typed-mention scenario exercises debounced provider lookup, discards a stale response, selects a native ID and verifies persisted metadata. It exposed the thread normalizer converting transient mention inputs to plain text; the normalizer now respects the registered input plugin. Both typed and explicit pickers invalidate stale results when query/platform/social set changes. The lookup transport is a local fixture; persistence and UI are real.

Unverified/unfinished: Copying live sidebar links lacks a real-account end-to-end assertion. B’s `TF-001 TF-007 TF-092: dropped images copy through the clipboard between posts without reupload` passes using native browser copy/paste: distinct editor node IDs share the durable asset and preserve ALT, post association and reload. The test found and fixed global screenshot navigation on a Write drop and the media manager mounting before the collaboration document had loaded. File drops use the existing upload pipeline at their dropped position. Quotes/native mentions need eligible real accounts and live provider receipts. Public link-card accuracy was not verified in this runtime. These nested requirements prevent checking the entry.

### TF-007 — Alt text — open

Implemented: per-image +ALT in previews and media management, accessible editors, 1,000-code-point validation, asset-scoped persistence, copied/moved/framed descriptions, actual preview descriptions, and existing provider serialization. Sources: `composer/describe-images.tsx`, `composer/preview.tsx`, `lib/write/media-operations.ts`, `server/internal/product/asset_alt_text.go`, `asset_derivatives.go`, X `media_source.go`, LinkedIn `post.go`/`media.go`. All editor and preview description actions refresh occurrences across the main body and every saved platform version. The bulk dialog deduplicates shared assets, avoiding competing descriptions for the same asset. Cross-draft live synchronization remains a separate unverified case.

Tests: B’s image/frame/reorder scenario verifies save/reload, transform preservation and editing from preview. M move/copy test passes. G/I: X `x_test.go` → `TestAltTextGoesOnTheMedia`, LinkedIn `alt_text_test.go` → `TestPostContentAltText`, and product `TestScheduledImageDerivativeRetainsOriginalDescriptionAndRetryIdentity` pass. The latter also clears stale ALT on a reused derivative. B’s typed-mention/ALT scenario edits an independent LinkedIn version and verifies the stored main body, platform version and reloaded preview all carry the new description.

Blocker: real X/LinkedIn publication and retrieval of the resulting accessible description cannot be checked without authorized accounts. Other existing channel ALT paths and editing shared assets from independent open drafts were not exhaustively exercised. `[ ]` remains.

### TF-019 — GIPHY — open, activation gated

Implemented: toolbar button; search/result/loading/empty/error states; result previews; selection; official API re-resolution; size/type checking; durable signed upload/completion; GIF metadata in draft serialization. Sources: `composer/giphy-picker.tsx`, `lib/content-drafts/giphy.ts`, `app/api/v1/content-drafts/giphy/route.ts`, `content-draft-platform.ts`. Attribution is displayed. Search credentials remain server-only.

Verification: Q/C pass; B’s gated-GIPHY/PDF scenario verifies the default approval error (503), with authored text retained. L verifies approval gating before network calls, result shape, 429 errors, attribution, API-key secrecy, selected-ID re-resolution and ID/unsafe-host rejection with injected transports. GIF validation tests reject truncated containers and invalid palette indices. The additional browser GIF scenario substitutes only the gated GIPHY route boundary: an original two-frame animation is signed, uploaded and completed through the real tenant service; fixture search exercises empty/rate-limit/results/attribution, attaches the stored asset, reloads it, and checks identical bytes. Mixed X media receives a backend 409 without creating a schedule. A separate single-GIF draft schedules successfully and pins the stored animation’s asset ID. No approved live search or publication was performed; fixture success cannot enable the integration.

Blocker: the user explicitly has no approved integration. Both `PLATFORM_GIPHY_APPROVED_API_AND_STORAGE=true` and `GIPHY_API_KEY` are required. Keep unset until GIPHY explicitly authorizes this server-side search/durable-storage design and approves attribution. Public terms cannot be replaced by merely obtaining a key.

Additional native protocol verification: LinkedIn `media_signed_url_test.go` → `TestSignedImageURLsPreserveAnimationAndTransparency` asserts byte-identical two-frame GIF upload and transparent PNG upload through signed delivery URLs. `TestLinkedInRejectsIncompatibleGIFBeforeProviderMutation` rejects 251-frame, truncated and disguised animations before upload initialization. Shared helper `TestMediaExtensionIgnoresSignedQueryAndDirectoryNames` verifies the routing fix. No external provider is contacted by these tests.

### TF-023 — Image frames (beta) — locally verified

Implemented: launch from an attachment, color/padding/radius and available brand palette, preview through Shots' renderer, apply/cancel, durable derived PNG, original lineage, ALT preservation and reopening stored settings. Sources: `composer/media-frame.tsx`, `composer/media-tools.tsx`, existing `lib/render/scene-renderer.ts`, `lib/workspace/save-export.ts`, Go `assets_media.go`.

Verification: B’s image/frame/reorder scenario creates a 400×200 source, previews/applies a purple frame, reopens it, changes color and cancels, checks unchanged stored settings, downloads the actual exported PNG and decodes its 464×264 dimensions, verifies distinct asset IDs/source lineage and reloads the draft. No social publishing claim: the task's permitted export path verifies the transformed output. M and I additionally verify metadata/lineage and immutability. Completion uses this local export workflow; no external permission is needed.

### TF-038 — Native X photo tags — open, activation gated

Implemented: compatible-image “Tag people”, exact-username lookup with numeric IDs, add/remove, saved node metadata, caption-independent normalized tags, preview labels, max-ten/distinct-ID/static-image restrictions, Zod/SDK/Go/pending-job/native create-post serialization for root/replies. Sources: `composer/photo-tags.tsx`, `lib/write/publication.ts`, `lib/content-drafts/serialize.ts`, `postoptions/postoptions.go`, `socialidentity/x_photo_tags.go`, X `dto.go`, `publish.go`, `publishing_limits.go`, `tenantpublishing/options.go`.

Tests: G `socialidentity/x_photo_tags_test.go` gate/ID/media checks and `x/photo_tags_test.go` → `TestNativePhotoTagsRemainMediaMetadata` inspect native request metadata and unchanged caption. M blocks malformed metadata. Q/C validate contracts. B’s typed-mention scenario now searches/selects a numeric photo-tag identity, persists it without changing the caption, confirms the scheduling API rejects disabled permission with 409, and removes the tag. The dialog refuses to apply stale tags if its attachment changes while open. The lookup is local; no native notification or real publication was verified.

Blocker: no authorized X accounts/app permissions. Native schema presence establishes a payload shape, not account entitlement or notifications. `PLATFORM_X_PHOTO_TAGS` and `NEXT_PUBLIC_PLATFORM_X_PHOTO_TAGS` stay false until an authorized account proves root/reply tagging, retrieval and notification behavior. No notification is claimed.

### TF-040 — Images from links — open

Implemented: explicit URL metadata resolution, discovered image preview, attachment, PNG normalization/storage, durable source URL and dimensions, recoverable errors. Sources: `composer/link-image.tsx`, `lib/content-drafts/link-card.ts`, `link-image.ts`, `lib/launch/safe-fetch.ts`, new link-image route, existing generated-asset API. DNS pinning and per-hop public-address checks reject private hosts/unsafe redirects; byte, MIME, full decoder, animation and pixel limits apply. IPv4-mapped IPv6 and transition tunnels are rejected.

Tests: B’s `TF-040: a controlled metadata URL becomes a stored image and scheduled attachment` uses a real controlled HTML/PNG server, explicit preview/attachment, object storage, reload and future scheduling; persisted scheduled asset IDs match. L → `TF-040: ingest decodes a public metadata image into durable static-image bytes` and `TF-040 security: reject private sources, redirects, disguised images and unsupported formats`; actual image decoding, malicious SVG and redirect cases pass. B’s gated-GIPHY/PDF scenario rejects a loopback URL (422). Existing safe-fetch/link-card tests pass under Q.

Blocker: a real public-page browser fetch failed in the managed network runtime. The DNS-pinned HTTPS transport requires direct public egress and does not use this runtime's mandatory outbound proxy. It was not weakened to bypass SSRF or TLS policy. The controlled URL → storage → reload → schedule workflow passes. Public internet ingestion and live provider publication remain unverified. Repeated URL attachment currently creates separate assets; deduplication is not asserted.

### TF-066 — Ten-minute X videos — open

Reused/verified locally: durable upload; MP4 inspection of sample timing/codecs/dimensions; account-specific duration/size; original-byte staging; chunk initialization/append/finalize; processing polling; scheduled worker retry/reconciliation. Sources: `socialidentity/x.go`, `social/integrations/social/x/media_source.go`, `media_video.go`, `publish.go`, existing publishing workers. No new Premium requirement was added.

Tests G/I: `media_source_test.go` → `TestTenMinute1080pSourcePreservedWithoutPremium`, `TestMP4InspectsActualTimingDimensionsAndCodecs`, `TestVideoMetadataRejectsTruncationAndDurationOverflow`, `TestMediaUploadsOriginalBytesAndCategory`; `x_test.go` → `TestVideoChunkUpload`, `TestHandshakeAndProcessing`, `TestUploadErrorClassified`. A real 600-second H.264/1920×1080 MP4 fixture is inspected and byte-preserved. Protocol fixtures cover provider responses, not real transcoding.

Blocker: no authorized X account for upload/schedule/publish/receipt verification. B’s `TF-066 TF-105: a ten-minute 1080p source uploads and schedules for a verified standard X fixture` passes: browser metadata is 600 seconds/1920×1080, stored bytes are identical, and the persisted scheduled post pins that asset. Provider processing/recovery is still only protocol-tested. Shots still caps individual videos at 512 MiB.

### TF-068 — Larger image uploads and resizing — open

Implemented: shared 20 MB paid/5 MB internal free limits; authoritative entitlement/quota checks; actual byte/MIME/dimension/decode checks; orientation/alpha/aspect/quality controls; immutable originals; cached X/Bluesky/LinkedIn derivatives; actual XHR byte progress, current billing-plan lookup before browser upload, and host overrides replacing Plate’s obsolete 4 MB image/16 MB video preflight defaults; failed processing blocks readiness/scheduling. Sources: `internal/medialimits/*`, `lib/write/media-limits.ts`, `lib/tenant/schemas.ts`, `lib/workspace/save-export.ts`, `product/assets_media.go`, `asset_bytes.go`, `asset_derivatives.go`.

Tests M shared-ceiling test; G/I `media_integrity_test.go` → `TestUploadVerifiesStoredBytesAndChecksum`, `TestProviderImageRetainsAspectAndAlphaWithinByteLimit`; `asset_derivatives_integration_test.go` → `TestScheduledImageDerivativeRetainsOriginalDescriptionAndRetryIdentity`; existing upload/dimension/auth tests. B checks a real upload and frame completion. Additional G/I tests pass: `TestProviderImageCorrectsAllJPEGOrientationsAndProfileDimensions` exercises EXIF orientations 1–8, independently specified corner colors for every rotation/reflection, correct dimensions and removal of stale EXIF; `TestSmallWideImageStillGetsDurableProviderDerivative` verifies a 5,000×1,000 transparent PNG below the byte ceiling still becomes a 4,096×819 derivative, with its original retained.

Remaining requirements: RFC 023 has no free product plan; unsubscribed workspaces have no `asset:create` entitlement and zero storage. The internal 5 MB value does not activate a free tier. Preserve billing policy until the product explicitly defines one. The authenticated large-image scenario now proves rejection at 20,000,001 bytes before any upload request, authored-text preservation, actual >5 MB PNG ingestion, a durable X derivative below 5 MB, aspect/alpha preservation and byte-identical original storage. Destination-specific persisted resize profiles beyond X/Bluesky/LinkedIn and concurrency stress remain incomplete. This entry remains open for both implementation and verification gaps.

### TF-076 — X mixed media — open, provider limitation

Implemented: preserve every ordered attachment throughout composer/normalization/contracts/storage/preview; reject excess attachments and unsupported combinations in frontend and Go/adapter checks instead of silently dropping them. Sources: `serialize.ts`, `publication.ts`, `product/content_draft_schedule.go`, `socialidentity/x_content.go`, X `publishing_limits.go`/`media_source.go`. Static photos, one GIF or one MP4 remain supported selections subject to verified account limits.

Tests M → `TF-076: unsupported combinations and excessive attachments fail without dropping media`; G/I → `TestInvalidMediaSelectionMakesNoProviderMutation`, `TestGIFFullAnimationLimits`, `TestContentDraftScheduling` → `an oversized X selection fails atomically and an explicit selection is preserved`. All pass. B’s GIF fixture scenario also verifies mixed GIF/image persistence and preview restriction, then confirms backend rejection and no scheduled rows. Mixed-media publishing was not enabled or claimed.

Blocker: current official X API documentation permits four photos OR one GIF OR one video, and explicitly says mixed combinations are unsupported. The original requirement to mix them remains `[ ]`.

### TF-083 — Native LinkedIn PDF carousels — open

Implemented/reused: PDF composer attachment, bounded full page-tree parsing, 100 MB/300-page validation, saved document settings, accessible page count/previous/next canvas preview, durable document ID, native `urn:li:document` upload/post path, processing polling, scheduling/recovery. Sources: `composer/version-options.tsx`, `pdf-carousel.tsx`, `preview.tsx`, Go `asset_bytes.go`, `content_draft_options.go`, shared `internal/mediadocument/pdf.go`, bounded reads in `social/integrations/base.go`, LinkedIn `post.go`/`media.go`, existing worker. The resumed audit fixed an actual bug: native PDF input previously went through the image decoder and failed. It now follows a bounded document-validation path and uploads its original bytes.

Tests B’s gated-GIPHY/PDF scenario uploads a real Chromium-generated two-page PDF, navigates pages, reloads settings, opens the LinkedIn document preview from Schedule and Publish. G/I `asset_bytes_test.go` → `TestPDFPageLimit` validates 300/301 and malformed PDFs; LinkedIn `TestPostPendingCarousel`, `TestCheckPostStatusProcessingFailed`, `TestCheckPostStatusStalls`, `TestCreatePostRejected`, `TestPostContentAltText` pass. B also schedules the document, checks the database’s `publishOptions.documentAssetId` and reads back identical stored bytes. New `TestNativePDFPreservesBytesAndWaitsForDocumentProcessing` uses that same two-page fixture with a local native API: byte-identical PDF PUT, processing before AVAILABLE, correct `urn:li:document`/title, processing failure without post creation, and ambiguous creation without duplicate submission. `TestBoundedMediaReadRejectsChunkedOversize` proves chunked responses cannot exceed the read limit. These are protocol results, not live LinkedIn receipts.

Blocker: no authorized member/organization account with appropriate LinkedIn scopes/API access. Real document ingestion, AVAILABLE processing state, post receipt and swipeable provider result remain unverified. A static image gallery is not counted as completion.

### TF-092 — Reorder media — locally verified

Implemented: native drag/drop within and between posts, keyboard arrows/destination controls, copy, stable IDs/source/ALT/transforms, Slate undo, nested media and comment-anchor retention, autosave/reload. Sources: `composer/media-tools.tsx`, `lib/write/media-operations.ts`, existing thread/Slate/collaboration infrastructure. Native drag propagation is isolated from Plate's HTML5 drag backend so it is not cancelled.

Tests: M move/copy/publication-order test and `TF-092: nested attachment moves retain discussion anchors and undo` pass. B’s image/frame/reorder scenario drags within a post and in both directions between posts, uses keyboard-accessible controls, checks persisted order/lineage/descriptions and reopens. No delete/reupload occurs for movement. Browser DOM assertions account for the editor's lazy image loading. No external provider is needed to verify this editing behavior.

### TF-105 — Automatic 1080p X video — open

Implemented/reused: verified subscription capabilities stay separate from Shots billing; source video is inspected and uploaded without a Shots 720p reduction or manual quality setting. Staged facts now persist width, height and video codec alongside duration/MIME/bytes. Sources: `socialidentity/x.go`, X `media_source.go`, `media_video.go`, `publish.go`, and existing connection verification. Provider upload/processing parameters follow the existing native video path.

Tests G/I: `TestTenMinute1080pSourcePreservedWithoutPremium` checks a real 1920×1080 H.264 fixture and unchanged staged bytes; `TestMP4InspectsActualTimingDimensionsAndCodecs` and `TestPendingMediaNeedsFactsAndCurrentVideoAllowance` verify technical properties and current eligibility checks. B verifies a real ten-minute 1080p upload, HTML video metadata, unchanged stored bytes and scheduling for a credential-free verified-standard-account fixture. No browser quality switch was introduced.

Blocker: a 1080p source does not prove a 1080p published result. No authorized Premium account or standard comparison account is available to inspect provider-accepted media and fallback playback. Live transcoding, publication receipt and returned resolution are unverified. `[ ]` remains.

### TF-057 — LinkedIn preview — locally verified

Implemented: Publish/Schedule Preview actions, selected-platform initialization, desktop/device presentation, collapsed text and accessible expansion, correct connected author, normalized caption/media/mentions/documents, current in-memory draft version. Sources: `composer/schedule.tsx`, `preview.tsx`, `WriteComposer.tsx`, `lib/write/publication.ts`, `preview-layout.ts`, existing PDF carousel.

Tests: B’s preview and PDF scenarios cover desktop/mobile collapse/expansion, current text, literal HTML/emoji/links, actual document pages and both modal entry points. Q `write-publication.test.ts` checks manual platform versions and native mention serialization. Six stored visual fixtures include LinkedIn desktop/mobile states. This checks functional simulated presentation; strict native cutoff claims belong to unresolved TF-078/085 below.

### TF-074 — X “Show more” — open

Implemented: consolidated weighted eligibility/token-safe cut, rendered line ceiling, Show more/less, ordinary posts, Unicode/graphemes/URLs, paragraphs, media/thread presentation, Publish/Schedule access. Sources: `preview-layout.ts`, `preview.tsx`, `schedule.tsx`. M → `TF-074 TF-085: weighted X cutoff preserves graphemes and complete links` passes; B compares collapsed/expanded X fixtures and preserves edits.

Blocker: this is a versioned approximation. Native X long-form feed treatment/cutoff cannot be verified against an authorized account/current client. The 280-token window is not presented as proof of the native display boundary. `[ ]` remains.

### TF-078 — LinkedIn “…more” — open

Implemented: three browser-rendered lines, expansion, Preview action, and a real “Preview current draft” command in Cmd/Ctrl+K that opens the mounted composer without route navigation. Sources: `preview-layout.ts`, `preview.tsx`, `components/write/CommandPalette.tsx`, `write-context.tsx`, `WriteComposer.tsx`. B’s preview/visual scenario checks command launch plus persisted content; the PDF scenario checks the active LinkedIn version.

Blocker: native visible lines differ by client, width and feed changes. No authorized current LinkedIn feed comparison establishes the “as LinkedIn shows it” requirement. The added authenticated focus/scroll/rapid-edit/draft-switch scenario passes. It caught and fixed browser scroll anchoring moving the composer when the preview changed text wrapping, and command-palette focus restoration resetting the caret to the start. `components/write/WriteFrame.tsx` now restores the captured range and scroll as well as focus. Native-device comparison remains unavailable. `[ ]` remains.

### TF-085 — Exact X/LinkedIn cutoffs — open

Implemented: one versioned rule module, desktop/mobile widths, weighted X eligibility, line-based LinkedIn truncation, whole graphemes/links, mention labels, normalized paragraph/text/media presentation, expansion and repeatable visual fixtures. Sources/tests: `preview-layout.ts`, `preview.tsx`, M weighted-cutoff test, B’s preview/visual scenario and `test/e2e/write-media.spec.ts-snapshots/`.

Blocker: six application-owned visual baselines verify regressions, not native provider parity. No independent current-provider observations establish exact cutoffs. Font rendering also differs on the Linux test host. The original “exact” requirements were not weakened or checked.

### TF-100 — Live sidebar previews — open

Implemented: responsive/resizable sidebar, independent scrolling, live normalized editor state, device scaling inside the panel, X/Threads thread UI, publishing-flow access, active-platform initialization and preview-button pointer behavior that preserves editor focus. Sources: `WriteComposer.tsx`, `preview.tsx`, `write-context.tsx`; B’s preview/visual scenario verifies live updates, in-panel mobile width, two-post Threads and reopen; its existing phone/thread regressions also pass.

Blocker: the backlog also requires matching the **current** native X/Threads apps. That comparison is unavailable. Local Chromium now verifies caret position/focus after toggles and Cmd/Ctrl+K, independent preview scroll, unchanged composer scroll, rapid live updates and draft isolation through real sidebar navigation. Concurrent-user and native-device parity remain unverified. Functional sidebar behavior is implemented, but the entire entry remains `[ ]`.

## External capability evidence and activation

- [X media best practices](https://docs.x.com/x-api/media/quickstart/best-practices), inspected 2026-10-24: one video/GIF or up to four photos, no mixed combinations; verified account-specific video allowances. Subscription playback quality differs from source upload resolution. Shots does not downscale the 1080p fixture, but that cannot establish provider playback resolution.
- [X create-post reference](https://docs.x.com/x-api/posts/create-post) and [official OpenAPI](https://api.x.com/2/openapi.json): `CreatePostsMedia.tagged_user_ids`, up to ten numeric IDs. Account permissions, successful publication and notification behavior still need real verification.
- [LinkedIn Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api): 100 MB and 300 pages; scopes, account ownership and API access apply. The shared application ceiling is now 100,000,000 bytes, with a real page-tree limit of 300. Native input is validated and uploaded unchanged; actual account acceptance still requires authorized verification.
- [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), inspected 2026-10-24: JPG/GIF/PNG, fewer than 36,152,320 pixels and at most 250 GIF frames. The 6,000-pixel static-image profile stays below this pixel ceiling and converts unsupported WebP. Native GIF preparation validates every frame within these limits and preserves the original animation.
- [GIPHY API terms](https://support.giphy.com/hc/en-us/articles/360020283431-GIPHY-API-Terms-of-Service): server proxying/caching/durable retention requires explicit approval for this architecture. The user has declined to supply such approval because none is available. Defaults stay off.

## Review outcome and remaining acceptance work

The second review found and repaired drag cancellation by Plate, stale media-list memoization under React Compiler, missing command-bar preview wiring, opening the wrong platform's preview, generated-image validation bypass, malformed photo-tag metadata being silently filtered, and IPv6 transition-address handling. Tests also distinguish lazy image loading from missing persisted content. API documentation operation IDs were corrected and regenerated.

The resumed review additionally fixed typed mention normalization, stale lookup results, ALT synchronization across independent versions, native PDF decoding, bounded document reads, dimension/orientation/format-triggered derivatives, global file-drop navigation away from Write, missing selection after reload when attaching files, premature media-manager subscriptions before collaboration readiness, command-palette caret restoration, and preview scroll anchoring. Final adapter review fixed signed-URL GIF flattening/PNG transparency loss and extension routing through query parameters. Host media options preserve the configured placeholder renderer and run after upstream handlers. It added real browser URL ingestion/scheduling, photo-tag persistence/gate rejection, PDF scheduling, and ten-minute 1080p upload/scheduling. The requested live lifecycle, approved GIF happy path, published X video quality, native photo notifications, LinkedIn document receipt, public-egress URL ingestion and the complete all-platform derivative catalog remain unverified or unfinished as specified above. These are not hidden behind passing local fixtures. Disconnect/reconnect and account-scope invalidation have existing automated backend coverage; no real-account reconnect exercise was performed.

The final production build, TypeScript, targeted zero-warning lint, full root/workspace tests, real-Redis collaboration tests, Go suite/vet, database integration/migration runs and authenticated browser suite passed. No claim of live social publication is made. The final backend log contained no error/panic entries; the media browser scenario asserts no uncaught page errors. The expected disabled-GIPHY and unsafe-link responses are intentional failures, not successful integrations.

The saved source Markdown was compared with `HEAD`: all 109 feature titles, dates, changelog URLs and nested requirements are preserved. Only TF-023, TF-092 and TF-057 changed from `[ ]` to `[x]`; the two scoped sections link to this audit. No unrelated checkbox changed.

**Section 3: Completed 2/12. Section 6: Completed 1/5. Combined: Completed 3/17.**

| Final checkbox | Feature IDs |
| --- | --- |
| `[x]` | TF-023, TF-092, TF-057 |
| `[ ]` | TF-001, TF-007, TF-019, TF-038, TF-040, TF-066, TF-068, TF-076, TF-083, TF-105, TF-074, TF-078, TF-085, TF-100 |
