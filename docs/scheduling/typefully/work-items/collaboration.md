# Epic COLLAB: Notifications, activity and collaboration

The authorized expansion is implemented at the supported local boundaries. Use [execution](execution.md) and [coverage](coverage.md) for observed results and unresolved checks; provider fixtures are not live certification.

## WI-COLLAB-1: Deliver draft lifecycle notifications once

**Gap:** Verify: retain the existing behavior and execute the feature-specific regressions below.

**Source:** TF-022, TF-028, TF-033, TF-095, TF-101. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Existing transactional activity/outbox, workspace notification policy, member preferences and encrypted Slack connection.

**Affected files / evidence:** `services/internal/notifications/store.go`; `services/internal/notifications/delivery.go`; `services/internal/product/draft_events.go`; `components/workspace/WorkspaceNotifications.tsx`; `components/write/composer/properties.tsx`.

### Problem, scope and changes

Draft review, comments/mentions and publishing already use the shared notification infrastructure. Added per-brand Slack routes and a draft-level publish-notice skip, with server validation and authority checks at fanout and delivery. Newly created policy enables published-post Slack notices; existing explicit opt-outs remain unchanged.

### Acceptance criteria

Connect Slack, select a workspace fallback or distinct channels for visible workspace brands and reload saved choices. A successful publish sends one message to its brand channel. Opting out on a draft suppresses that success message before projection or before delivery, while preserving personal activity and failure notices. Private brands and removed members cannot leak into shared channels. Guest comments and review requests notify eligible recipients only. Email/in-app preferences and source labels remain intact.

### Failure behavior

429/5xx responses use bounded retry; uncertain sends remain uncertain and cannot silently duplicate. Invalid Slack channel membership is a validation error. Disconnection or permission loss blocks delivery even after an event was queued.

### Verification

`services/internal/notifications/publish_preferences_test.go`; `services/internal/notifications/publish_temporal_test.go`; `services/internal/product/content_draft_notification_integration_test.go`; `test/e2e/workspace-notifications.spec.ts`; `test/e2e/notification-preferences.spec.ts`.

### Observability and unresolved dependencies

Per-brand routing, suppression races, private-set exclusion and policy preservation passed PostgreSQL/HTTP tests. A real local Temporal worker delivered exactly once to the fixture channel and suppressed a later opted-out draft; live Slack/email remains unverified. Delivery receipts record provider acceptance, attempts and sanitized failure/decision codes.

## WI-COLLAB-2: Inspect history and collaborate safely

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Source:** TF-086, TF-090. [Source requirements](../changelog-features.md).

**Priority:** Reopened expansion. **Size:** M; separate provider activation from the locally testable slice.

**Depends on:** Shared Yjs/Plate document, draft revisions and canonical audit service.

**Affected files / evidence:** `components/write/composer/comments.tsx`; `components/write/composer/member-comments.tsx`; `components/write/composer/share-backups.tsx`; `services/internal/product/content_draft_collab.go`; `services/internal/product/content_draft_write.go`.

### Problem, scope and changes

Shots uses live collaborative editing in place of exclusive draft locks. Browser testing repaired initialization readiness so media and post controls operate on the received document. Comments preserve stable post/text anchors; API-key authors retain their client identity.

### Acceptance criteria

Two authorized members edit without overwriting each other; refresh preserves both changes. Demotion stops mutation and removal revokes an open reader. Activity names the actor, source and specific content/platform/schedule change. Open a revision and recover it into a new draft without overwriting the reviewed or published snapshot. Resolve/edit/delete comments only under the correct author and workspace rules.

### Failure behavior

Offline/failed saves preserve editable text and block unsafe navigation. Stale versions and conflicting anchors fail visibly; revocation does not continue a background collaborative write.

### Verification

`services/internal/product/content_draft_collab_integration_test.go`; `services/internal/product/content_draft_agent_comments_integration_test.go`; `test/e2e/content-draft-collaboration.spec.ts`; `test/e2e/write-editing-regressions.spec.ts`.

### Observability and unresolved dependencies

Fresh browser runs passed co-editing, foreign-workspace refusal, demotion, open-reader removal, early typing and failed-save recovery. Audit/revision records provide persisted evidence; console errors remain part of browser checks.
