# Epic FOLLOW: Follow-up automation

Reconciled against `19390194` and the implementation in this working tree. The October 23 expansion deferral is reopened by this assignment. [Execution](execution.md) distinguishes observed local test results from external provider verification.

## WI-FOLLOW-1: Apply defaults and timed follow-ups

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-011, TF-027, TF-064. [Source requirements](../changelog-features.md).

**Dependencies:** Set engagement defaults; canonical options; Temporal action receipts and verified provider rights.

**Affected code and current evidence:** `components/write/composer/automation.tsx`; `lib/write/automation.ts`; `services/internal/product/social_sets.go`; `services/internal/temporalpublishing/automation.go`; `services/internal/social/tenantpublishing/automation.go`.

### Implementation gap and disposition

Timed repost/unrepost, like-threshold plugs/reposts, native quotes and set defaults already exist in the current implementation. Verify defaults are copied into new drafts and do not rewrite existing scheduled snapshots.

### Acceptance criteria

Save set defaults with optimistic concurrency, create a draft and inspect copied values after reload. Support elapsed-time and supported engagement conditions. Start only after confirmed publication; revoke account/plan/approval authority before execution and prevent the action. Cancel pending actions and replay workers without duplicate confirmed extras.

### Failure behavior

Unknown delivery is not automatically retried. A failed extra cannot downgrade a successful main post. Threshold expiry remains visible; missing analytics cannot be substituted with zero likes.

### Verification

`services/internal/temporalpublishing/automation_test.go`; `services/internal/social/tenantpublishing/automation_test.go`; `services/internal/product/content_draft_schedule_integration_test.go`; `test/write-automation.test.ts`; `test/e2e/write.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Persist action kind, due time, attempts, cancellation and confirmed/failed/unknown outcome. Native X quote access remains gated by verified API eligibility.

## WI-FOLLOW-2: Preserve direct-message permission boundary

**Gap:** Later: the specific product decision or missing provider contract is recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-043. [Source requirements](../changelog-features.md).

**Dependencies:** Explicit DM product/security decision and required X permissions.

**Affected code and current evidence:** `docs/rfcs/039-scheduling-feature-priorities.md`; `lib/write/automation.ts`.

### Implementation gap and disposition

Later: auto-DMs remain outside the approved follow-up scope. The assignment preserves this permission boundary; repost/comment grants do not imply permission to message followers.

### Acceptance criteria

Keep DM actions absent from the composer, API and worker action inventory until the decision and provider grants are accepted. Future implementation must define consent, recipient eligibility, idempotency and recovery before activation.

### Failure behavior

Reject unknown action kinds rather than treating them as an approved reply or repost.

### Verification

`TypeScript and Go action-enum/validation tests`; `no external DM is sent.`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Deferred with named dependency; not represented as a completed feature.
