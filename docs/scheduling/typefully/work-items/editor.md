# Epic EDITOR: Writing and editor

Reconciled against `19390194` and the implementation in this working tree. The October 23 expansion deferral is reopened by this assignment. [Execution](execution.md) distinguishes observed local test results from external provider verification.

## WI-EDITOR-1: Split pasted text into editable threads

**Gap:** Partial at the audited baseline; source evidence and the implemented slice are recorded below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-016, TF-063. [Source requirements](../changelog-features.md).

**Dependencies:** Plate transforms; channel text measurement and verified long-post limits.

**Affected code and current evidence:** `components/write/composer/paste-thread.tsx`; `lib/write/import-text.ts`; `components/drafts/thread.tsx`.

### Implementation gap and disposition

Explicit thread paste now previews delimiter or length splitting, bounds the combined thread to 25 posts and uses ordinary editor operations. X URLs count by weighted length; graphemes remain intact.

### Acceptance criteria

Accept --- on its own line or four line breaks; optionally split at a selected channel limit. Review before insertion, retain existing posts, and undo the append as an editor operation. Reject impossible limits or overlong unbreakable text. Reload and verify the post boundaries and content.

### Failure behavior

No destructive automatic split on ordinary paste. Invalid text remains in the dialog for correction; no partial append beyond the thread limit.

### Verification

`test/write-import.test.ts`; `test/write-thread-insertion.test.ts`; `test/e2e/typefully-workitems.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Browser assertions cover append, undo and persistence; normal draft revision events record the saved edit.

## WI-EDITOR-2: Verify focus, numbering and rich editing

**Gap:** Verify: retain the existing behavior and execute the feature-specific regressions below.

**Priority:** Reopened expansion. **Size:** M; live provider activation remains separately gated.

**Source:** TF-002, TF-005, TF-006, TF-012, TF-020, TF-050, TF-058, TF-075. [Source requirements](../changelog-features.md).

**Dependencies:** Existing collaboration server, Plate document format and keyboard preferences.

**Affected code and current evidence:** `components/write/composer/WriteComposer.tsx`; `components/write/composer/version-options.tsx`; `components/drafts/DraftEditor.tsx`; `components/drafts/thread.tsx`; `lib/write/numbering.ts`.

### Implementation gap and disposition

Current editor already supplies focus mode, emoji, numbered publication text and side preview. Browser testing found thread drag cancelled by the global drop handler and media tools opening before the collaborative snapshot; both are repaired.

### Acceptance criteria

Keep stable post IDs, media and anchored comments when moving a post. Insert a new post below the caret; undo edits without corrupting settings. Preserve bold, italic, lists and paragraphs from HTML paste. Edit 25 posts at a mobile viewport, reload and verify persisted changes. Number supported threads consistently in preview and publish without writing synthetic labels into the body.

### Failure behavior

Block editing during unsynchronized/read-only states. A stale collaborative update must not erase another author’s changes; save failure stays visible and navigation cannot silently discard edits.

### Verification

`test/write-numbering.test.ts`; `test/write-autosave.test.ts`; `test/e2e/typefully-media-handoff.spec.ts`; `test/e2e/typefully-workitems.spec.ts`; `test/e2e/content-draft-collaboration.spec.ts`. Execute the relevant tests and record results in the coverage matrix; listed tests alone do not certify this item.

### Observability and activation

Observed browser passes cover rich paste/mobile/refresh and repaired drag. Collaboration regressions and editor errors must be checked again after readiness changes.
