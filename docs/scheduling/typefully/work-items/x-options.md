# Epic XOPT: X publishing options

Reconciled against `19390194` and the implementation in this working tree. The October 23 expansion deferral is reopened by this assignment. [Execution](execution.md) distinguishes observed local test results from external provider verification.

## WI-XOPT-1: Authorize long posts and Articles

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-049, TF-061, TF-063, TF-102. [Source requirements](../changelog-features.md).

**Dependencies:** Account capabilities from verified X identity; X application access; existing approval snapshots.

**Affected code and current evidence:** `lib/write/capabilities.ts`; `lib/write/publication.ts`; `components/write/composer/paste-thread.tsx`; `services/internal/product/content_draft_options.go`; `services/internal/social/integrations/social/x/article.go`.

### Implementation gap and disposition

Long-form and Article authoring already existed at the current baseline, unlike the October 19 triage. Configurable paste splitting now uses the selected limit and X weighted URL length. Publishing remains constrained by the verified account and app capability, not a self-selected Premium switch.

### Acceptance criteria

Write and retain rich Article content, title and cover; preview and copy it. Split X text at a chosen supported limit without breaking graphemes or counting full URLs. Require verified long-post/Article capability again when scheduling and executing. Expired identity or downgraded access cannot authorize a queued restricted post.

### Failure behavior

Keep authored content when publishing is unavailable. Unknown or unsupported access is a visible blocker; never fall back to truncation or an undocumented endpoint.

### Verification

`test/write-publication.test.ts`; `test/write-import.test.ts`; `services/internal/social/integrations/social/x/x_test.go`; `services/internal/product/content_draft_schedule_integration_test.go`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Publication validation and provider receipt expose the blocked account and capability; redact OAuth credentials. Live restricted X access remains unverified.

## WI-XOPT-2: Choose audience, replies and disclosures

**Gap:** Verify: retain the existing behavior and execute the feature-specific regressions below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-073, TF-089, TF-097, TF-107. [Source requirements](../changelog-features.md).

**Dependencies:** Verified X scopes and connected account; canonical publication options.

**Affected code and current evidence:** `components/write/composer/version-options.tsx`; `components/write/composer/post-tools.tsx`; `lib/write/publication.ts`; `services/internal/postoptions/postoptions.go`; `services/internal/social/integrations/social/x/dto.go`.

### Implementation gap and disposition

Community audience, timeline broadcast, reply permissions and paid/AI labels are structured options. Verify the exact platform serialization and persisted editor choices, including applying reply settings across posts.

### Acceptance criteria

Persist community identity and broadcast choice independently. Preserve everyone/following/mentioned/subscriber/verified reply choices and both disclosure flags in the publication snapshot. Each destination must pass its own capability checks; selecting a community cannot silently change visibility elsewhere.

### Failure behavior

Reject malformed community IDs and unsupported option/channel combinations before a command is created. A provider rejection is reported without claiming that the post was published.

### Verification

`test/write-publication.test.ts`; `services/internal/social/tenantpublishing/options_test.go`; `services/internal/product/content_draft_schedule_integration_test.go`; `test/e2e/write.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Snapshot options, validation problems and publish attempts provide evidence. Live Communities/disclosure behavior requires a permitted test account.

## WI-XOPT-3: Publish supported media combinations

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-066, TF-076, TF-105. [Source requirements](../changelog-features.md).

**Dependencies:** X upload access, verified account tier and media processing.

**Affected code and current evidence:** `services/internal/social/integrations/social/x/provider.go`; `services/internal/social/integrations/social/x/x_test.go`; `lib/write/capabilities.ts`; `services/internal/product/content_draft_options.go`.

### Implementation gap and disposition

Use the existing uploader and provider processing status. Mixed photos/video/GIFs are not enabled merely because a Typefully release claims support. Long/high-resolution video eligibility must be established by the current X API and account capability.

### Acceptance criteria

Validate attachment count, type, duration and file size before scheduling; preserve source quality through upload. Wait for processing completion before publication and show processing failure. Reject unsupported combinations consistently in web and Go. Never claim 1080p delivery from successful upload alone.

### Failure behavior

Fail closed on unknown video eligibility or mixed-media support. Provider downsampling and playback resolution need live verification; no local checkbox overrides them.

### Verification

`services/internal/social/integrations/social/x/x_test.go`; `services/internal/social/tenantpublishing/provider_test.go`; `test/write-publication.test.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Media processing IDs and attempt outcomes are recorded without access tokens. Exact live video access and mixed-media approval remain external blockers.
