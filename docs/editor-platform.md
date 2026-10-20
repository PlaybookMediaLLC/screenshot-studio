# Editor platform

How the editor is put together: one document model, one renderer, one
command layer, and the services built on them. Each section names the files
to read first. [ARCHITECTURE.md](../ARCHITECTURE.md) covers the upstream editor
this grew from; [integrations.md](integrations.md) covers sharing and
Slack, Notion, and Figma.

## One document model

`lib/design/document.ts` defines `DesignDocument` version 2, the
lossless description of a design in normalized units:

- Positions are canvas fractions.
- Text sizes are fractions of the canvas width.
- Times are in milliseconds.

`parseDesignDocument` reads version 1 and 2. A design is the same value
everywhere it goes: the editor, projects and their versions, presets, brand
application, previews, batch items, every export size, AI variants, and share
links.

Sections are owned by the feature that adds them. Each schema lives in that
feature's own file and is imported into `document.ts`:

| Section                                    | What it holds                                                                       | Schema                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| `canvas`, `background`, `pattern`, `image` | Format, background, and the main screenshot (frame, shadow, 3D, filters, placement) | `lib/design/document.ts`         |
| `devices`                                  | Framed screens: devices, browsers, windows, and code, with layouts                  | `lib/frames/schema.ts`           |
| `texts`                                    | Text layers and typography (Google Fonts, gradient fill, fit, roles)                | `lib/typography/text-style.ts`   |
| `elements`                                 | Step badges, cursors, spotlights, zoom callouts                                     | `lib/editor/elements/schema.ts`  |
| `overlays`, `annotations`, `redactions`    | Stickers and logos, markup, blur regions                                            | `lib/design/document.ts`         |
| `timeline`                                 | Clips, keyframe tracks, text reveals, scroll-through, audio, captions               | `lib/animation/motion-schema.ts` |
| `slides`                                   | Several screenshots shown one after another                                         | `lib/design/document.ts`         |
| `brand`                                    | The brand kit applied and the values it set                                         | `lib/brand/binding.ts`           |
| `copy`                                     | Alt text and platform captions                                                      | `lib/captions/channels.ts`       |

`exportDesignDocument({ keepLocalSources: true })` reads the editor as a
lossless document. `test/design-lossless.test.ts` checks that a document
read back from the editor is unchanged. The default call, without
`keepLocalSources`, is the AI view: no local images and no hidden layers.

`applyDesignDocument` and `applyDesignChanges` in `lib/design/apply.ts` write
a document into the editor as one undo step.

Local images (`blob:`/`data:`) become workspace assets (`asset:<uuid>`)
before anything is stored. `lib/design/upload-sources.ts` uploads each one
once per page. The Go backend checks that every `asset:` reference in a stored
document belongs to the workspace (`services/internal/product/designs.go`).

## One renderer

The editor stage (`components/canvas/ClientCanvas.tsx`, DOM layers inside
`#image-render-card`) is the only renderer:

- **Live exports** capture the stage itself: `exportElement` in `lib/export/export-service.ts`, and `captureStage` in `lib/render/capture.ts`.
- **Off-screen renders** go through a hidden same-origin frame at `/render/local`. `renderDocument(document, output, { time, signal })` in `lib/render/scene-renderer.ts` serves previews, thumbnails, batch items, extra export sizes, and variants. It draws with the same `StageRenderer` the server renderer uses.
- **Server renders** use the same stage at `/render/[designId]` in headless Chrome (`lib/design/renderer.ts`).

Previews are cached by content (`lib/render/preview-cache.ts`), so a preset
or layout thumbnail is exactly what applying it produces, frames included.
Nodes marked `data-export-exclude` (guides, handles, selection) never reach a file.

## Command layer

- **One store**: `lib/store/index.ts` holds the whole editor state, with feature slices for elements, frames, and motion. Selection, panels, and the playhead are session state: they are never saved or undone.
- **History**: the zundo history keeps 100 steps. A pointer gesture (dragging a slider or a layer) is one step. `withHistoryStep`, and `beginHistoryStep`/`endHistoryStep` for async work, group several writes into one step. Presets, brand kits, variants, and AI changes each apply as one step.
- **Selection**: `lib/editor/selection.ts` tells the inspector what is selected (image, text, element, screen, sticker, annotation, redaction).
- **Panels**: the left panel composes the design (Design, Frame, Background, Layers). The right panel inspects the selection (Edit, 3D, Motion). The tabs are defined in `components/editor/panels/panel-tabs.tsx`.
- **Snapping**: `lib/editor/snapping.ts` covers object and canvas snapping, guides, thirds, safe zones, and App Store crops.
- **Imports**: paste and drop both go through `importImages` (`lib/editor/import-images.ts`).

## Scene evaluation

Playback never writes the document. `usePlaybackStore` (`lib/store/playback.ts`)
holds the playhead. The stage draws values evaluated at that time:

- `evaluateImageMotion` covers preset clips.
- `lib/animation/motion-evaluate.ts` covers keyframes with cubic Bézier easing, text reveals, scroll-through, and caption timing.

Evaluation is a pure function of the document and the time. Video export moves
the playhead frame by frame, so GIF, MP4, and WebM show the same frames as the
editor. Audio is mixed with `OfflineAudioContext` (`lib/animation/audio-mix.ts`)
and muxed as AAC or Opus. When WebCodecs cannot encode it, export falls back to
FFmpeg; a failure stops the export with an error rather than producing silence.

## Export

`lib/export/formats.ts` lists every format: PNG, JPEG, WebP, SVG, PDF, GIF,
MP4, and WebM. Each format offers only the settings that apply to it.

- **SVG**: HTML inside an SVG, so text and shapes stay vector and images and fonts are embedded. It opens in browsers, not in design tools.
- **PDF**: written in `lib/export/pdf.ts`, one page per size or slide, 1 px = 1 pt. Pages are images.
- **Multi-size**: `adaptDocumentToSize` in `lib/export/adapt.ts` lays the document out again for each target (`lib/export/sizes.ts`) rather than stretching it. Several files download as one ZIP.
- **Batch mode**: `components/export/batch/BatchWorkspace.tsx` applies the current design, a preset, or a brand kit to up to 50 screenshots. It renders two at a time, with per-item failures, retry, and cancel.
- **Embeds**: the Save menu's embed entry opens Share, which publishes the design and gives iframe, HTML, and Markdown snippets.

## Canvas

Canvas ([RFC 041](rfcs/041-creative-canvas.md)) places many documents on one
infinite board. Each artboard is a whole `DesignDocument` at a workspace
position; workspace units are export pixels, so moving an artboard never
changes its output. One artboard at a time is open in this editor
(`components/canvas-workspace/use-native-artboard.ts`); the others draw through
`renderDocument` at a width that suits the zoom. Canvases are creative sets of
kind `canvas` and share the Story Set session, history and recovery
(`lib/creative-sets/revisioned-session.ts`).

## Persistence

Every write goes through the Go backend (`services/internal/product`) and the
SDK (`packages/screenshot-studio-backend-sdk`). The web never touches the database.

| Feature                            | Backend                                                           | Web                                                       |
| ---------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Projects, autosave, versions (F24) | `project`, `project_version`; revision-checked writes             | `lib/projects/*`, tRPC `project`                          |
| Presets (F03)                      | `creative_template`, versioned by name; rename and archive        | `lib/presets/*`, tRPC `creativeTemplate`                  |
| Brand kits (F02)                   | `brand_kit`, versioned by name; every member reads, admins manage | `lib/brand/*`, tRPC `brandKit`                            |
| Share links (F06)                  | `share_link`: token, public or workspace-only, expiry, revocation | `lib/sharing/*`, `/s/<token>`, `/api/share/<token>/media` |
| Integrations (F06)                 | `integration_connection`, credentials sealed by the web           | `lib/integrations/*`, `/api/integrations/<provider>/*`    |
| AI backgrounds (F21)               | Generated workspace assets                                        | `lib/ai/images/background.ts`                             |

Migrations are SQL in `services/platformmigrations/sql`. Ent schemas are in `services/ent/schema`.

## Features on the platform

- **Brand kits** (`lib/brand/apply.ts`): a kit sets colours, fonts, logo, background, and frame by property path, and the design remembers what it set. Applying any kit again keeps every property the user changed since, unless they reset overrides.
- **Presets** (`lib/presets/preset.ts`): a preset is the design without the project's screenshots. Applying one keeps the current screenshot, device screens, and slides.
- **Redaction** (`lib/redaction/*`): text recognition (Tesseract) and face detection (MediaPipe, on tiles at several scales) run in the browser; the screenshot is not uploaded. Approved regions are drawn into the screenshot's pixels, so no export keeps them.
- **Typography** (`lib/typography/*`): Google Fonts loaded on demand in the editor, the render frame, and the server renderer; gradient fill; shrink-to-fit; headline and subheadline templates.
- **Elements** (`components/canvas/elements/*`): badges, cursors, spotlights, and zoom callouts are canvas fractions. A callout follows its source region on the screenshot.
- **Frames** (`lib/frames/*`, `components/frames/*`): devices drawn in-house (Pixel, Galaxy, iPad, MacBook, iMac, Studio Display, Vision Pro); Safari, Chrome, Arc, Edge, and Firefox chrome with auto appearance; macOS and Windows windows; terminals; code-to-image; composition layouts for several screenshots.
- **AI** (`lib/ai/*`, `components/editor-ai/*`):
  - **Copilot** edits through `applyChanges`. "Give me four versions" calls `showVariants`, which opens compare-first versions. Each version must change the composition and differ from the others (`lib/ai/variants.ts`).
  - **Captions** follow each platform's limits and the brand voice, and alt text describes only what is visible.
  - **Backgrounds** come from an image model.
  - All of these are metered to AI credits. `PLATFORM_AI_SCRIPTED=1` swaps in a deterministic stand-in for tests.

## Requirement map

| Requirement                        | Where                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| UX-01 one set of image adjustments | `lib/editor/image-adjustments.ts`, `components/editor/sections/AdjustSection.tsx`                                                                |
| UX-02 one row of tabs per panel    | `components/editor/panels/*`                                                                                                                     |
| UX-03 previews show the frame      | `components/design/DocumentPreview.tsx`                                                                                                          |
| UX-04 one paste, one image         | `lib/editor/import-images.ts`                                                                                                                    |
| UX-05 Start over confirms          | `components/editor/EditorHeader.tsx`                                                                                                             |
| F01, F04, F05                      | `lib/export/*`, `components/export/*`                                                                                                            |
| F02, F03                           | `lib/brand/*`, `lib/presets/*`, `components/editor/{brand,presets}/*`                                                                            |
| F06                                | `lib/sharing/*`, `lib/integrations/*`, `components/editor/share/*`, `components/workspace/WorkspaceIntegrations.tsx`, `WorkspaceSharedLinks.tsx` |
| F07, F12, F13, F14                 | `lib/frames/*`, `components/frames/*`                                                                                                            |
| F08                                | `lib/editor/snapping.ts`, `lib/editor/snap-dom.ts`, `components/editor/panels/GuidesSection.tsx`                                                 |
| F09, F10, F16                      | `lib/editor/elements/*`, `components/canvas/elements/*`                                                                                          |
| F11                                | `lib/redaction/*`, `components/editor/redaction/*`                                                                                               |
| F15                                | `lib/typography/*`, `components/editor/typography/*`                                                                                             |
| F17, F18, F19, F20                 | `lib/animation/motion-*`, `components/timeline/*`                                                                                                |
| F21, F22, F23                      | `lib/ai/images/*`, `lib/ai/variants.ts`, `lib/ai/agents/{editor-assist,captions}.ts`, `components/editor-ai/*`                                   |
| F24                                | `lib/projects/*`, `components/projects/*`                                                                                                        |

## Tests

Unit tests run with `npm test` (`test/*.test.ts`). The
cross-feature workflows are Playwright specs:

| Workflow                       | Spec                                        |
| ------------------------------ | ------------------------------------------- |
| A: brand-based batch export    | `test/e2e/workflows.spec.ts`                |
| B: animated product screenshot | `test/e2e/motion.spec.ts`                   |
| C: product announcement        | `test/e2e/workflows.spec.ts`                |
| D: safe publishing             | `test/e2e/workflow-safe-publishing.spec.ts` |
| E: cloud editing               | `test/e2e/projects.spec.ts`                 |
| F: consistent frames           | `test/e2e/frames.spec.ts`                   |

Feature specs: `editor-ux`, `brand-presets`, `share-links`, `ai-features`,
`export-batch`, `redaction`, `projects`. Exported files are checked byte by
byte: magic numbers, pixel sizes, PDF pages, ZIP layout, MP4 tracks, OCR of
redacted output, and editor-versus-export pixel differences for frames.

## Known limits

- **Integrations**: Slack, Notion, and Figma need provider apps and credentials before they connect ([integrations.md](integrations.md)). Figma's API comments; it cannot place images, so the design is pasted from the clipboard.
- **SVG and PDF**: SVG opens in browsers, not in design tools. Editor PDF pages are images, so their text cannot be selected; Canvas can print PDFs with selectable text and vector shapes through the server renderer ([RFC 044](rfcs/044-canvas-layers-and-automation.md)).
- **GIF**: GIF has no audio. GIF, and MP4 without WebCodecs, load FFmpeg from a CDN.
- **Render frame load**: the render frame shares the main thread with the editor, so a large batch has long tasks while it renders.
- **Detection**: redaction can miss content. The review step and manual regions exist for that.
