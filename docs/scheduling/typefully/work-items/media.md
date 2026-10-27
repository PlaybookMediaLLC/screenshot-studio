# Epic MEDIA: Media creation and management

The authorized expansion is implemented at the supported local boundaries. Use [execution](execution.md) and [coverage](coverage.md) for observed results and unresolved checks; provider fixtures are not live certification.

## WI-MEDIA-1: Describe and order existing assets

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-007, TF-087, TF-092. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Owned workspace assets, existing upload/object store, AI registry and metering.

**Affected files / evidence:** `components/write/composer/media-tools.tsx`; `components/write/composer/describe-images.tsx`; `server/internal/product/asset_alt_text.go`; `lib/write/describe-image.ts`; `components/drafts/thread.tsx`.

### Problem, scope and changes

Alt text and AI descriptions use stored assets. Added within-post reorder and cross-post movement without reupload, retaining alt text and original IDs. Fixed global drag interception and media controls opening before collaborative initialization.

### Acceptance criteria

Edit alt text, reorder two images, move an image to another post, reload and inspect the same asset IDs and descriptions. AI requires an authorized owned image and paid AI policy; generated descriptions remain editable before use. Serialize supported per-image alt text to each provider without changing the original file.

### Failure behavior

Foreign/deleted assets fail authorization; model errors and quota exhaustion leave existing descriptions unchanged. Concurrent asset edits must not erase unrelated media or cause a second upload.

### Verification

`server/internal/product/assets_upload_test.go`; `server/internal/product/shared_image_integration_test.go`; `test/e2e/typefully-workitems.spec.ts`; `test/e2e/typefully-media-handoff.spec.ts`.

### Observability and unresolved dependencies

Browser checks passed real uploads, ordering, persisted alt text and scripted description editing. Metered model/provider requests and stored asset IDs establish the boundary; live model accuracy is unverified.

## WI-MEDIA-2: Attach GIFs, frames and link images

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-019, TF-023, TF-029, TF-040. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** GIPHY API configuration, safe public-URL fetches, existing Shots raster export and workspace upload.

**Affected files / evidence:** `components/write/composer/media-tools.tsx`; `components/workspace/SaveToWorkspaceButton.tsx`; `lib/content-drafts/link-card.ts`; `app/api/link-preview/image/route.ts`.

### Problem, scope and changes

GIF search, link-image review/upload and frame handoff share the existing asset system. Frame flow now waits for the source image and blocks closure while attaching the exported workspace asset. Native removal of provider-generated link cards has no verified cross-provider contract and must not be claimed from hiding a local preview.

### Acceptance criteria

Search and select a GIF within file limits; unavailable key produces an explicit state. Fetch a link image through SSRF guards, review it, then attach a workspace asset. Open an attached image in Shots, add a frame, export to workspace, review the result and attach it; after reload both original and framed assets remain. Keep link-card suppression classified unsupported until a documented provider request can be tested.

### Failure behavior

Unsafe redirects/private network URLs, oversized GIFs, failed export/upload or revoked asset access show a recoverable error. A failed handoff cannot remove the original image or insert an empty placeholder.

### Verification

`lib/launch/safe-fetch.ts`; `test/e2e/typefully-media-handoff.spec.ts`; `test/e2e/typefully-workitems.spec.ts`.

### Observability and unresolved dependencies

The full frame workflow passed against actual object storage and raster bytes. `test/e2e/typefully-preview.spec.ts` also passed GIF search/selection and link-image review/upload against controlled HTTP sources, then checked persisted JPEG dimensions and two-frame GIF bytes after refresh. GIPHY live search requires a production key. Native link-card removal remains a provider-contract blocker, not completed functionality.

## WI-MEDIA-3: Validate larger images and photo tags

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-038, TF-068. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Provider image limits, verified X publishing account and original asset storage.

**Affected files / evidence:** `server/internal/social/mediaresize/image.go`; `components/write/composer/post-tools.tsx`; `lib/write/publication.ts`; `server/internal/social/integrations/social/x/provider.go`.

### Problem, scope and changes

Added bounded PNG/JPEG/WebP decode/resize for destination limits while retaining originals; GIFs are not flattened. X photo IDs are native tagged_user_ids, separate from caption mentions.

### Acceptance criteria

Accept an image within the Shots plan/upload limit, generate a provider-sized derivative only when needed and retain the original. Reject decompression bombs and invalid images. Store up to ten unique numeric X user IDs and send them with static photo attachments. Reject tags for polls, videos, non-X channels or Articles.

### Failure behavior

Derivative failures stop publishing before an external create request. Unknown photo identity or rejected tagging remains a provider error; do not silently turn tags into text.

### Verification

`server/internal/social/mediaresize/image_test.go`; `server/internal/social/integrations/social/x/x_test.go`; `test/write-publication.test.ts`; `test/e2e/typefully-workitems.spec.ts`.

### Observability and unresolved dependencies

Dimension/byte-limit tests and browser photo-ID persistence verify local behavior. X recipient notification and remote resized-image rendering need a live permitted account.
