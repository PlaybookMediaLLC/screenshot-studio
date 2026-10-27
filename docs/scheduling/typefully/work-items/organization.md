# Epic ORG: Draft organization and search

Reconciled against `19390194` and the implementation in this working tree. The October 23 expansion deferral is reopened by this assignment. [Execution](execution.md) distinguishes observed local test results from external provider verification.

## WI-ORG-1: Search and organize draft collections

**Gap:** Verify: retain the existing behavior and execute the feature-specific regressions below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-032, TF-045, TF-080. [Source requirements](../changelog-features.md).

**Dependencies:** Scoped draft list/search service, batch permissions and existing revision history.

**Affected code and current evidence:** `components/write/library.tsx`; `components/write/composer/properties.tsx`; `server/internal/product/content_drafts.go`; `server/internal/product/content_draft_write.go`.

### Implementation gap and disposition

Current Write has multi-selection, internal titles, scratchpads and title/full-text search. Verify exact selection and workspace boundaries, including edits through the composer and bulk operations.

### Acceptance criteria

Search full body and title, open only authorized matching drafts, and keep private set results out. Select several drafts with keyboard/modifier controls and delete/archive the chosen set only; show individual failures. Persist titles and private scratchpad text after refresh without including scratchpad in publication or public share.

### Failure behavior

Foreign IDs, stale state and insufficient role fail per operation. Bulk failure cannot clear unrelated selections or imply that every item succeeded.

### Verification

`server/internal/product/content_draft_write_integration_test.go`; `server/internal/product/content_drafts_integration_test.go`; `test/e2e/write.spec.ts`; `test/e2e/typefully-workitems.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Canonical audit events and revision history preserve actor/source and outcome; query text and private notes are not copied into notification payloads.

## WI-ORG-2: Preserve controlled tags and pins

**Gap:** Verify: retain the existing behavior and execute the feature-specific regressions below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-017, TF-079. [Source requirements](../changelog-features.md).

**Dependencies:** Existing draft-tags user experiment; RFC 042 product decision.

**Affected code and current evidence:** `components/write/tags.tsx`; `components/write/library.tsx`; `components/drafts/DraftCalendar.tsx`; `server/internal/product/content_draft_write.go`.

### Implementation gap and disposition

Later for general rollout: tags and pinning remain behind their existing experiment. Authorized experimental users retain tag management/filtering and calendar tag attribution; this assignment does not silently promote the feature.

### Acceptance criteria

With the experiment enabled, create/edit/delete a tag, attach it to a same-set draft and filter by it after reload. Pin ordering must remain stable. Without the experiment, hide controls and reject restricted writes. A foreign set tag cannot be attached or exposed by the calendar.

### Failure behavior

Deleting a tag removes references safely; stale or foreign tag IDs fail validation. The explicit rollout decision is required before changing default availability.

### Verification

`server/internal/product/content_draft_write_integration_test.go`; `server/internal/product/content_draft_platform_integration_test.go`; `test/e2e/write.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Keep rollout classified Later while recording exercised experimental behavior separately.
