# Epic SCHED: Scheduling, queue and calendar

The authorized expansion is implemented at the supported local boundaries. Use [execution](execution.md) and [coverage](coverage.md) for observed results and unresolved checks; provider fixtures are not live certification.

## WI-SCHED-1: Move queued posts safely

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-031, TF-054. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Publisher authority, current approved snapshot, queue locks and existing Temporal scheduled workflows.

**Affected files / evidence:** `components/drafts/DraftCalendar.tsx`; `services/internal/product/content_draft_platform.go`; `services/internal/product/content_draft_schedule.go`; `app/api/v1/content-draft-posts/swap/route.ts`.

### Problem, scope and changes

Added exact local date/time edits, free-slot placement and atomic swaps. Concurrent moves use conditional cancellation, so one old scheduled command yields at most one replacement; no second publishing charge is taken.

### Acceptance criteria

Drag a queued card to an exact available slot or another card, and provide an equivalent keyboard/select operation. Preserve caption, approval/version and destination while changing only the explicitly selected times. Resolve local times in the brand zone; reject ambiguous/skipped DST times and elapsed instants. Race multiple moves/swaps and allow exactly one successful mutation.

### Failure behavior

A worker claim or competing edit rejects the stale move without creating replacements. Partial swap failure rolls back both sides. Published/unknown posts cannot be dragged into a new external publication.

### Verification

`services/internal/product/content_draft_platform_integration_test.go`; `test/write-calendar.test.ts`; `test/write-zoned-time.test.ts`; `test/e2e/typefully-workitems.spec.ts`.

### Observability and unresolved dependencies

PostgreSQL races and browser exact move/swap/reload passed. Audit cancellation/replacement IDs trace the operation; provider delivery remains separately gated.

## WI-SCHED-2: Navigate month and team calendars

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-053, TF-081, TF-084, TF-104. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Visible social sets in the active workspace; existing draft-tags experiment for tag controls.

**Affected files / evidence:** `components/drafts/DraftCalendar.tsx`; `components/drafts/CalendarDraftPicker.tsx`; `app/[locale]/write/plan/page.tsx`; `services/internal/product/content_draft_platform.go`.

### Problem, scope and changes

Added week/month/queue views, all-visible-brand scope, persistent channel/status/brand/tag filters and Alt+Left/Right/T navigation. Connected channels remain filterable when they have no scheduled posts. Planned drafts retain their real destination channels and never publish by time alone.

### Acceptance criteria

Render seven week columns or a complete 42-day month grid in the selected brand zone. Show planned, scheduled and published cards with brand/tag attribution; hide private/foreign sets. Select a saved or published draft for a free slot and open human scheduling review. Drop a sidebar draft on the queue and create no publishing command until confirmation. Persist filters after refresh and navigation. Tags remain hidden without the experiment.

### Failure behavior

Invalid ranges fall back to a valid visible period; unavailable drafts show an error. Cross-workspace aggregation is not implied by an all-brands view and cannot bypass workspace switching.

### Verification

`test/write-calendar.test.ts`; `services/internal/product/content_draft_platform_integration_test.go`; `test/e2e/typefully-workitems.spec.ts`; `test/e2e/social-set-scope.spec.ts`.

### Observability and unresolved dependencies

Fresh browser tests passed sidebar drop/picker, confirmation/reload, 42-day view, empty-channel filter, brand/tag persistence and keyboard navigation. No campaign objects were established by the Typefully Plan research, so no unrelated campaign calendar was invented.

## WI-SCHED-3: Reuse content and publish explicitly

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-008, TF-021, TF-034, TF-052, TF-069, TF-072. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Approval/version checks, actual engagement observations and canonical queue settings.

**Affected files / evidence:** `components/write/composer/schedule.tsx`; `components/drafts/CalendarDraftPicker.tsx`; `services/internal/product/content_draft_schedule.go`; `services/internal/product/content_draft_platform.go`; `services/internal/product/content_draft_timing.go`.

### Problem, scope and changes

Repurpose and explicit publish review exist in the current baseline. Best-times privacy is fixed to the resolved visible set, and observed publication timestamps take precedence over scheduled times. Natural offsets stay stable for a publication rather than rerandomizing on retry.

### Acceptance criteria

Repurpose a confirmed publication into a new editable draft with no inherited approval or schedule. Publish-now on scheduled content requires explicit confirmation and cannot duplicate a claimed/published command. Omitted schedule fields preserve existing times. Show evidence-based timing suggestions only with sufficient history and label generic starting times. Add a chosen suggestion to the recurring queue without altering already scheduled posts.

### Failure behavior

Insufficient engagement must not create fabricated scores. Invalid/foreign account, exhausted plan, missing approval or stale version blocks enqueueing. Timeouts retain unknown publication state for reconciliation.

### Verification

`services/internal/product/content_draft_publish_integration_test.go`; `services/internal/product/content_draft_timing_test.go`; `services/internal/product/content_draft_platform_integration_test.go`; `test/e2e/write.spec.ts`.

### Observability and unresolved dependencies

Publication/automation receipts distinguish main and optional outcomes. The additional best-time chart/add-slot handoff remains under implementation until its browser evidence is recorded.

## WI-SCHED-4: Preview, import and schedule batches

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-072, TF-084. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Canonical queue preflight, immutable import receipts, existing workspace upload and per-row human approval.

**Affected files / evidence:** `components/write/bulk-import.tsx`; `components/write/bulk-schedule.tsx`; `services/internal/product/content_draft_import.go`; `services/internal/product/content_draft_batch.go`; `lib/write/bulk-import.ts`.

### Problem, scope and changes

CSV/text/media import and Spread use existing draft/scheduling APIs. Imports journal the immutable payload and receipt key before upload/create, resume after refresh and replay safely. Spread accepts 1–50 rows, 1–24/day, bounded spacing and 0–55 minute shift in five-minute steps.

### Acceptance criteria

Parse quoted/multiline CSV with a 1 MB/50-row bound; validate channel and existing asset ownership. Preview every concrete instant in the brand zone before publishing commands. Repeat an import key with identical payload and obtain one draft; changed payload conflicts. Show each row result and retry only unresolved rows. Approval-required rows remain drafts. Recover from a lost response/refresh without uploading or scheduling twice.

### Failure behavior

Known validation errors can be edited with a new row receipt; uncertain server outcomes retain the old immutable key for reconciliation. Storage quota failure is visible. Preflight queue/version changes roll back scheduling; one rejected row cannot be reported as successful.

### Verification

`services/internal/product/content_draft_import_integration_test.go`; `services/internal/product/content_draft_batch_test.go`; `services/internal/product/content_draft_platform_integration_test.go`; `test/write-bulk-import.test.ts`; `test/e2e/typefully-workitems.spec.ts`.

### Observability and unresolved dependencies

Observed tests include concurrent idempotent import, Spread/DST constraints, real media import, refresh reuse and browser scheduling. Two dedicated browser tests passed definite rejection followed by an edited request, a committed request with lost response and refresh/retry without duplication, and storage-full refusal before any POST. `test/e2e/typefully-lifecycle.spec.ts` also passed confirmed-content repurposing after real Temporal publication; missing/deleted source media fails explicitly.
