# Editor audit and App Store integration — 2026-10-19

## Scope and method

Audited the authenticated screenshot editor and the existing App Store studio from
baseline `0729108eb08b41c0241c72b4ad334a4c68756799`. Verification was performed locally.
No production data, deployment, store publishing, or external customer messages were used.

Read `AGENTS.md`, the local Next.js 16.3.5 guides for preserving UI state, client
components, navigation and search parameters, the editor architecture, and the
store studio documentation. Used the code graph, then traced source callers,
state, fixtures and tests before changing shared behavior.

Verification used the actual Next application at `localhost:3400`, a separate
`tacoma-editor-audit` local Compose stack, disposable local test workspaces,
Postgres, Redis and object storage. Existing stopped local data volumes were kept.
The initial visual audit used Chrome; subsequent checks used Playwright Chromium
against the real app, with screenshots inspected visually. Persistence failure
was injected at the IndexedDB write boundary in one regression test.

## Editor map

| Area | Screenshot editor | App Store studio |
| --- | --- | --- |
| Entry | `app/[locale]/page.tsx`, `components/editor/EditorLayout.tsx` | `app/[locale]/store-screenshots/page.tsx`, `components/store-screenshots/studio/StoreStudio.tsx` |
| Navigation | `components/platform-shell/PlatformSidebar.tsx`, editor toolbar and compose/inspector panels | `studio/sidebar/Sidebar.tsx`, `StudioHeader.tsx`, contextual inspector and filmstrip |
| State | `lib/store/index.ts`, Zustand + zundo; `lib/design/` for portable documents | `studio/editor-store.ts`, `lib/store-screenshots/document/`, validated commands and history |
| Canvas | `components/canvas/ClientCanvas.tsx`, shared frame renderer | `studio/canvas/EditorCanvas.tsx`, scene evaluation, shared `render/SlideRender.tsx` |
| Assets | `lib/editor/import-images.ts`, object URLs, persistent asset upload for cloud projects | `persistence/ingest.ts`, content-addressed IndexedDB assets, `RenderProvider.tsx` |
| Persistence | `hooks/useAutosaveDraft.ts` and `lib/draft-storage.ts`; cloud project sessions in `lib/projects/` through tRPC/Go SDK | `studio/autosave.ts`, `lib/store-screenshots/persistence/projects.ts`; browser-local projects and named versions |
| Export | `lib/export/`, stage capture and shared off-screen renderer | `studio/dialogs/ExportDialog.tsx`, `lib/store-screenshots/export/`, same scene renderer as canvas/thumbnails/reviews |

App Store paths above are relative to `components/store-screenshots/` unless
prefixed with `lib/`. Both editors already had complete tool sets and different
document models. The integration shares navigation and lifecycle handling while
retaining their existing document, command, persistence and export paths.

## Implemented integration

- **Editor** and **Settings** expand inline using the Settings pattern from the
  Paperless reference at `web/components/platform/shell/platform-sidebar.tsx`.
  The compact rail shows child icons under each parent, with tooltips; mobile
  navigation shows indented links and a rotating caret. Active sections start
  open, and long Settings lists scroll inside the sidebar. Editor contains
  **Screenshot editor** and **App Store Screenshots**.
- `components/platform-shell/EditorWorkspace.tsx` loads the studio on first visit.
  React `Activity` preserves each editor's state and releases hidden editor effects
  and global shortcuts. Switching is local history navigation; Back works.
- `EditorNavigation.tsx` preserves the URL's other parameters. The main cloud
  project uses `project`; the embedded studio uses `storeProject`. The existing
  standalone route still uses its original parameter.
- Existing editor App Store shortcuts now use this navigation. Active links expose
  `aria-current`; both sections use Radix Collapsible controls and the existing
  tooltip and mobile drawer components.
- App Store tools and inspector move into drawers below 1024 px. The canvas retains
  useful width; the header wraps, save status stays visible, and starter previews
  scroll inside their container. The editor accounts for the mobile navigation height.
- Uploaded App Store object URLs are reloaded after Activity cleanup. Cleared
  pending caches and a generation check prevent retained state from referring to
  revoked URLs or accepting a late load from the previous activation.

No schema migration, dependency, endpoint or backend permission change was needed.

## Findings and fixes

Severity: **P1** risks lost work; **P2** breaks a supported editing workflow.
“Before/after” means a failing regression was observed before the repair.
“Code-confirmed” means the failure path was traced and the repaired behavior was
tested, without a recorded failing browser run on the original implementation.

### B1 — P1: equal-length edits at the end of long text were not saved

- Reproduce: add text longer than 256 characters, wait for autosave, replace its tail
  with different text of the same length, then reload.
- Expected: the new tail survives. Actual: the prior text returns.
- Root cause: `hooks/useAutosaveDraft.ts` compared a fingerprint containing only
  the first 64 characters and length of each string.
- Fix: compare the complete persisted snapshot. Keep serialization, blob conversion,
  quota reporting and retry behavior intact.
- Evidence: before/after browser regression; direct IndexedDB read and reload assertion.

### B2 — P1: leaving before the draft debounce could discard the last edit

- Reproduce: warm the Projects route, edit text, and immediately leave the editor.
- Expected: returning or reloading retains the edit. Actual code path: cleanup
  canceled the pending timer; unload handling only considered an active save.
- Root cause: no flush of pending edits on component cleanup, with overlapping
  asynchronous restore/save work possible.
- Fix: capture a snapshot before navigation, serialize saves, flush on cleanup and
  page visibility changes, and make the next mount wait for the preceding save.
  Warn on actual unsaved content; treat an unchanged restored draft as clean.
- Evidence: code-confirmed; warm-navigation regression passes. The original cold
  route run passed because navigation took longer than the debounce, so that run
  alone did not reproduce the race.

### B3 — P2: adding slides changed the displayed image but not its selected ID

- Reproduce: import two images, select the second, and append another image.
- Expected: the selected second image remains on canvas. Actual: the first image
  appeared while the active slide ID still referred to the second.
- Root cause: `lib/store/index.ts:addImages` reused the active ID but always copied
  the first slide's source/name into the canvas fields.
- Fix: derive the ID, source and name from the same active slide.
- Evidence: unit regression failed before the fix and passes after; browser test
  verifies the selected image remains unchanged after another upload.

### B4 — P2: toolbar uploads bypassed validation and repeated files were ignored

- Reproduce: use Add slides twice with the same file; submit an unsupported file
  through the file input.
- Expected: each explicit valid upload works; unsupported input produces an error.
  Actual code path: the input retained its value and called `addImages` directly.
- Root cause: this toolbar path bypassed `validateImageFile`, unlike paste/drop.
- Fix: reset the file input and use the existing shared validation before appending.
- Evidence: code-confirmed; browser regression covers a repeated PNG, an invalid SVG,
  slide counts, error text and preservation of the active image.

### B5 — P1: App Store save failures still allowed project replacement

- Reproduce: make IndexedDB project writes throw `QuotaExceededError`, edit the
  project, save, then request a new project from the library.
- Expected: keep the unsaved document open, show failure, and do not announce success.
  Actual code path: the save caught errors but resolved normally; callers reported
  Saved or proceeded to replace the document.
- Root cause: `studio/autosave.ts:saveNow` did not communicate success to callers.
- Fix: return a success result; only switch/create after a successful save, retain
  failed pending state, and suppress false success notifications. Creation errors
  are caught and shown to the user.
- Evidence: browser fault injection verifies Not saved, no Saved notification, and
  that the project library remains open instead of abandoning edits.

### B6 — P2: deleting the open App Store project could recreate it

- Reproduce: delete the current project through All projects, then reload the library.
- Expected: it stays deleted. Actual code path: deletion called the new-project
  handler, which saved the current document; cleanup could also flush queued saves.
- Root cause: deletion and the autosave lifecycle were independent.
- Fix: current-project deletion stops queued saves, waits for an in-flight save,
  then deletes and returns to the start screen. A failed deletion keeps the project open.
- Evidence: code-confirmed; browser regression checks the start screen after deletion
  and after reload, with no resurrected project in the library.

### B7 — P2: initial App Store imports duplicated files and leaked into new projects

- Reproduce: choose one image with Import screenshots on the start screen. Finish
  importing, then create another blank project.
- Expected: one queued image, one slide, and a clean new project. Actual: the initial
  file appeared twice in development; the parent's pending import was also retained
  for later project mounts.
- Root cause: an effect appended `initialFiles` again when effects were reactivated;
  `StoreStudio` did not consume its pending import when changing projects.
- Fix: consume each incoming initial-file batch once and clear it on project transitions.
- Evidence: before/after browser regression (one file previously produced two rows);
  repaired test checks one slide and no reopened import dialog in the next project.

### B8 — P2: App Store editing had no canvas space on a narrow screen

- Reproduce: open the sample set at a 390 × 844 viewport.
- Expected: visible canvas and accessible tools. Actual: the fixed 264 px tools and
  300 px inspector consumed the viewport; canvas width was zero.
- Root cause: desktop-only panel layout and a non-wrapping header.
- Fix: responsive drawers, wrapping header, contained starter previews and visible save state.
- Evidence: before/after browser checks and inspected screenshots; canvas width is
  over 250 px, page width stays within 390 px, and text editing through both drawers works.

### B9 — P2: App Store tab and layer keyboard navigation was incomplete

- Reproduce: focus Layers and press Right Arrow; open a fresh slide and try to focus
  its initial layer selection through the keyboard.
- Expected: standard tab navigation and an available layer entry point. Actual:
  focus stayed on Layers and no unselected layer row had a tab stop.
- Root cause: hand-written tab roles without keyboard behavior; tab stops required
  an existing selection.
- Fix: use the existing Radix-backed Tabs component, make the initial row focusable,
  and support Space to select it. Existing arrow selection and Alt+Arrow reordering remain.
- Evidence: before/after arrow-key regression; repaired test verifies focus, active
  state, selection and reordering.

## Verification

- `npm run quality:check`: formatting, lint, TypeScript, 765 passing tests, one
  existing Redis replica test skip, and 17/17 RFC checks passed.
- Pre-merge `make check` passed against the final code in the repository's Node 22
  container, with the same 765 passing tests, one existing skip and 17/17 RFC checks.
- New audit regressions: all twelve cases passed across the focused runs.
- Existing browser coverage passed: both editor-export tests, all three editor-ux
  tests, all four projects tests, all three store-screenshots tests, and the frame
  composition/preview/export workflow.
- Integration evidence includes separate project IDs, retained selection and
  independent undo/redo, uploaded images surviving mode switches and reload,
  App Store RGB PNGs at 1320 × 2868 in the ZIP, and main-editor PNG export afterward.
- Frame coverage includes per-screen editing, layer drag ordering, browser and
  terminal frames, theme changes, and pixel comparison of preview, canvas and export.
- Screenshots are saved in `.context/editor-audit/`: `mobile-before.png`,
  `mobile-after.png`, `integrated-desktop.png`, `integrated-navigation.png`,
  and `settings-expanded.png`.

- App Store transformation coverage passed: pointer drag, undo/redo, model/scale/rotation
  changes, rejection of invalid numeric text, hide/undo, background editing, and
  persistence of those settings across reload. In total, 25 distinct browser
  workflows passed across the focused runs.
- Production build passed before the final sidebar-reference adjustment, with
  MediaPipe/ONNX dynamic-import and circular-chunk warnings. The final navigation
  change passed lint, TypeScript and three focused browser checks, including both
  inline sections, mobile navigation, state retention and exports. The full
  production build was not repeated after that navigation adjustment.

Re-run browser coverage against a running local stack with the E2E environment
configured (`E2E_BASE_URL`, `E2E_DATABASE_URL`, and `E2E_REDIS_URL`):

```sh
npx playwright test test/e2e/editor-audit.spec.ts test/e2e/editor-export.spec.ts test/e2e/editor-ux.spec.ts test/e2e/projects.spec.ts test/e2e/store-screenshots.spec.ts test/e2e/frames.spec.ts --reporter=list
```

## Unresolved evidence and coverage limits

- Two cold development runs timed out in the review workflow: once waiting for
  comments and once with resolution/revocation HTTP requests still pending. The
  complete lifecycle passed on the warmed server with no review-code change. This
  is not enough evidence to identify a review product defect; retain the traces in
  `.context/review-results/` if it recurs on a production build.
- A possible stale main-image `onerror` callback in `ClientCanvas.tsx` was considered
  during source review but not reproduced. A deterministic delayed-decode failure
  during image replacement is needed before attributing a bug or changing it.
- App Store projects remain browser-local. This integration does not add cloud
  synchronization or convert them into screenshot-editor documents.
- Tests used Chromium and a phone-sized viewport, not physical iOS Safari. No
  production, live App Store/Google Play upload, paid AI, Figma authorization,
  long-running memory stress, or exhaustive animation/video export audit was performed.
- Passing these checks does not establish that the entire editor is bug-free.
