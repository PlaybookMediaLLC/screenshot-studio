# Epic PREVIEW: Previews and sharing

Reconciled against `19390194` and the implementation in this working tree. The October 23 expansion deferral is reopened by this assignment. [Execution](execution.md) distinguishes observed local test results from external provider verification.

## WI-PREVIEW-1: Preview each platform beside the editor

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-057, TF-074, TF-078, TF-085, TF-100. [Source requirements](../changelog-features.md).

**Dependencies:** Canonical publication serializer and channel capability limits.

**Affected code and current evidence:** `components/write/composer/preview.tsx`; `components/write/composer/preview-viewport.tsx`; `components/write/composer/WriteComposer.tsx`; `lib/write/publication.ts`.

### Implementation gap and disposition

The preview uses the selected canonical publication. Added native video playback, fitted phone viewports, weighted X URL/emoji cutoffs, LinkedIn line clamping, Article titles/covers, provider-controlled poll duration and dismissible local Open Graph cards. PDF imports now select the LinkedIn document option rather than silently leaving an unattached file.

### Acceptance criteria

Show X long-form and LinkedIn collapsed text with expansion, media, numbering, polls and supported native targets. Switch device width inside the preview while leaving the application viewport alone. Open the side panel while editing and verify it follows the active platform version. Escape authored HTML and never execute embedded scripts.

### Failure behavior

Unsupported provider presentation is labelled rather than simulated as publish support. Preview selection cannot approve or publish a draft.

### Verification

`test/write-preview.test.ts`; `test/write-publication.test.ts`; `test/e2e/typefully-preview.spec.ts`; `test/content-draft-serialize.test.ts`; `test/e2e/write.spec.ts`; `test/e2e/typefully-workitems.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Four new browser tests passed: phone fit at a 390px app viewport, weighted cutoff and expansion, OG dismissal/restoration without editing the URL, actual video playback, two PDF pages verified by canvas pixels, Article title and stored cover bytes. Native card suppression is unavailable; the dismissal explicitly describes its local effect. Exact live line wrapping varies by provider app and cannot be certified from a fixture.

## WI-PREVIEW-2: Share metadata and read published threads

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-009, TF-060. [Source requirements](../changelog-features.md).

**Dependencies:** Existing public share token, asset grants and immutable confirmed publication snapshots.

**Affected code and current evidence:** `app/[locale]/d/[token]/page.tsx`; `components/drafts/SharedDraftView.tsx`; `services/internal/product/content_draft_platform.go`.

### Implementation gap and disposition

Share pages now use the first authorized image in absolute metadata, and confirmed publication text replaces private later edits in the unrolled view. Revocation is checked again when serving image bytes.

### Acceptance criteria

Create a share link, fetch actual image bytes and inspect absolute Open Graph metadata. Publish a root and replies, then read the confirmed thread at the same link. Private later edits and failed/unknown replies must not appear as published. Revoke the token during image access and deny the response; never expose an arbitrary asset by its ID.

### Failure behavior

Missing/revoked shares return unavailable; failed image generation does not reveal private storage URLs. Guest comments retain existing token/workspace limits.

### Verification

`services/internal/product/shared_image_integration_test.go`; `services/internal/product/content_draft_comments_integration_test.go`; `test/e2e/typefully-workitems.spec.ts`; `test/e2e/content-drafts-platform.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Browser verification fetched real object-storage bytes and confirmed revocation. External Slack/Notion crawler cache refresh remains outside local control.
