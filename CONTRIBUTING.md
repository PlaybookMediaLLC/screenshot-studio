# Contributing to Screenshot Studio

## Setup

Requires Node.js 20+ and npm.

```bash
git clone https://github.com/<your-username>/screenshot-studio.git
cd screenshot-studio
make up
```

Open [localhost:3000](http://localhost:3000). Core features work with no configuration. Copy `.env.example` to `.env.local` only if you need Cloudflare R2 asset storage, the Postgres screenshot cache, or analytics.

See [local development](docs/local-development.md) for Compose, Trigger.dev,
Supabase Storage, MinIO, and Kind commands.

## Scripts

```bash
npm run dev        # start dev server
npm run build      # production build
npm run lint       # eslint
npm run lint:fix   # eslint --fix
npm test           # node test runner (tests/*.test.ts)
```

## Project Structure

```
app/              Next.js routes, API routes, sitemap, robots
  [locale]/       Marketing pages, editor (/), code image page (/code)
components/
  canvas/         Frames, overlays, canvas dimensions
  controls/       Editor control panels
  editor/         Editor layout and sections
  export/         Export dialogs and progress UI
  landing/        Landing page sections, Navigation, Footer
  timeline/       Animation timeline and playback
  ui/             Shared Radix-based primitives
lib/
  store/          Zustand state
  animation/      Animation engine and presets
  export/         Image and video export pipeline
  constants/      Backgrounds, presets, fonts
  seo/            Metadata, JSON-LD, comparison page data
hooks/            Custom hooks
types/            TypeScript definitions
tests/            Node test files
```

## Coding Standards

### TypeScript
- Use TypeScript for all new code
- Avoid `any` — use `unknown` if type is truly unknown
- Be explicit for function parameters and return types

### React
- Functional components with hooks only
- Named exports over default exports
- `'use client'` directive for client components
- Keep components focused and single-purpose

### Styling
- **Always use CSS theme variables** via Tailwind classes (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `bg-primary`, etc.)
- **Never use hardcoded colors** (`bg-white`, `text-black`, `bg-neutral-*`, hex values)
- See `app/globals.css` for all available theme tokens

### File Naming
- Components: `PascalCase.tsx` (e.g., `EditorCanvas.tsx`)
- Utilities: `kebab-case.ts` (e.g., `export-utils.ts`)
- Types: PascalCase interfaces (e.g., `CanvasObject`)

### Linting

```bash
npm run quality:check # Format, lint, type, and size checks
npm run format        # Apply format fixes to the server boundary
```

Always run `make check` before committing. It uses the Node version in the
local Docker stack, so local machines do not need a separate dependency setup.

## Common Tasks

| Task | Where |
|------|-------|
| New editor control | `components/controls/`, wire to `lib/store/` |
| New browser mockup | `components/canvas/frames/BrowserToolbar.tsx`, `Frame3DOverlay.tsx`, `canvas-dimensions.ts`, `components/editor/sections/BrowserMockupSection.tsx` |
| New background | `lib/constants/backgrounds.ts` |
| New animation preset | `lib/animation/presets.ts`, use `clonePresetTracks()` when applying |
| Export changes | `lib/export/export-service.ts`, `video-encoder.ts`, `webcodecs-encoder.ts`, `ffmpeg-encoder.ts` |
| New SEO comparison page | Add an entry to `lib/seo/comparisons.ts`; the route and sitemap pick it up |
| New marketing page | Add `app/[locale]/<path>/page.tsx` with `alternates.canonical`, then add the path to `app/sitemap.ts` |

## Submitting Changes

### Branch & Commit

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

Use conventional commits:

```
feat(export): add watermark option
fix(canvas): fix image positioning on resize
refactor(store): simplify state management
docs: update contributing guide
```

`npm install` enables the local `commit-msg` hook. It rejects commit messages
that do not follow this format.

### Pull Request

1. Push your branch
2. Open a PR with a clear description
3. Include what changed, why, and how to test it
4. Add screenshots if there are visual changes

### PR Checklist

- [ ] `npm run build` passes
- [ ] `make check` passes
- [ ] Tested manually in the browser
- [ ] No console errors
- [ ] Follows existing code style

## Testing Checklist

Before submitting, verify:

- [ ] Image upload (drag & drop and file picker)
- [ ] Background changes (gradient, solid, image)
- [ ] Device frames and border controls
- [ ] 3D perspective transforms
- [ ] Text and image overlays
- [ ] Animation presets and timeline playback
- [ ] Export (PNG, JPG, video formats)
- [ ] Copy to clipboard
- [ ] Aspect ratio changes
- [ ] Responsive layout

## Bug Reports

Include:
- Steps to reproduce
- Expected vs actual behavior
- Browser, OS, device
- Screenshots or console errors

## Getting Help

- [GitHub Issues](https://github.com/PlaybookMediaLLC/screenshot-studio/issues)
- [GitHub Discussions](https://github.com/PlaybookMediaLLC/screenshot-studio/discussions)

## License

Contributions are licensed under [Apache 2.0](./LICENSE).
