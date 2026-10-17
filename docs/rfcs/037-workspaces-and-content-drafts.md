# RFC 037: npm Workspaces, the Plate.js Editor Package, and Content Drafts

**Status:** Accepted  
**Date:** 2026-10-17  
**Decided:** 2026-10-17 (see Decisions)  
**Supersedes:** [RFC 033](033-workspace-migration.md)  
**Owners:** Engineering  
**Depends on:** RFC 020 ([publishing](020-postiz-publishing.md)), RFC 033 ([migration order](033-workspace-migration.md)), RFC 034 ([REST contracts](034-rest-api-scalar-reference.md)), RFC 035 ([plan gates](035-pricing-and-unit-economics.md))

## Decision

1. Turn the repository into an npm workspace with `"workspaces": ["packages/*"]`
   in the root manifest. The Next.js app stays at the repository root. There
   is no `apps/` directory, no Turbo, no Nx, no pnpm and no Bun.
2. Vendor `@canvas/platejs-editor` from oppulence-canvas into
   `packages/platejs-editor` as `@shots/platejs-editor`, a source copy with
   its origin recorded in `UPSTREAM.md`.
3. Its first consumer is **manual content drafts**: a user writes a post in
   the editor, saves it as a draft, and schedules it to one or more connected
   channels through the existing scheduler.
4. Real-time co-editing ships in production through a new Hocuspocus
   deployable, `packages/collab-server`, which authenticates and persists only
   through the Go backend.

## Why now

RFC 033 deferred workspaces until a second shared artifact existed. The
backend SDK was the first; it shipped to npm from
`packages/screenshot-studio-backend-sdk` without workspaces, built with
`npm --prefix`. The editor is the second, and unlike the SDK it is consumed by
the app at build time, carries more than a hundred dependencies, and needs to
be linked, transpiled and traced. That is the trigger RFC 033 named. A third,
the collaboration server, is a separate deployable.

RFC 033's analysis of cost is out of date (it predates the move of product
data to the Go backend, and mentions Prisma and Trigger.dev, neither of which
the web uses now), but its **migration order** and **interim practice** still
apply: prove the risky parts on a trivial package first, keep the `@/` alias,
and keep boundaries explicit with `server-only` and barrel exports.

## Layout

```text
/                          the Next.js app (unchanged location)
packages/
  screenshot-studio-backend-sdk/   published to npm (unchanged release path)
  platejs-editor/                  @shots/platejs-editor, vendored, private
  collab-server/                   @shots/collab-server, Hocuspocus deployable
```

### Why the app stays at the root

Every nightly upstream sync merges KartikLabhshetwar/screenshot-studio into
the fork. Upstream keeps its app at the root. Moving ours to `apps/web` would
turn every upstream change to an editor file into a rename conflict. The
workspace adds packages beside the app, so a sync conflicts only on files the
fork already owns: the root `package.json` and `package-lock.json`.

### Why the collaboration server lives in `packages/`

The Go module owns `services/`, and the web image's `.dockerignore` excludes
`/services`. Putting a Node workspace there would make every web `npm ci` need
a manifest the image cannot see. One `packages/*` glob keeps the workspace
list, the lockfile and the Docker manifests in step.

### Tooling

npm workspaces are enough. The app builds with one `next build`; the SDK
builds with one `tsc`; the editor ships source and is compiled by Next. Nothing
here needs a task graph or a remote cache. Turbo or Nx is justified only by a
measured need: a CI build where package builds dominate wall-clock time. It is
not the case today, so none is added.

`bun.lock` is deleted. npm is the only package manager (`npm ci` in CI and in
the `Dockerfile`), and a second lockfile drifts silently. Upstream still
carries `bun.lock`; a sync that touches it resolves as a modify/delete
conflict with `git rm bun.lock`, which `AGENTS.md` records.

## Workspace migration

Done first, as its own change, with no editor (RFC 033 step 1).

| Concern | Change |
| --- | --- |
| Root manifest | `"workspaces": ["packages/*"]`; the lockfile is regenerated with npm |
| SDK build | `npm run build -w screenshot-studio-backend-sdk` replaces `npm --prefix` |
| SDK publishing | `publish-sdk.yml` and release-please are unchanged; a dry-run publish proves it |
| Docker | Every workspace's `package.json` is copied before `npm ci` |
| Standalone tracing | The tracing root is the app root, which contains `packages/`; no `outputFileTracingRoot` |
| CI | `ci.yml` builds the SDK through the workspace; `web-image.yml` rebuilds on `packages/**` |
| Guard | `test/workspace-manifests.test.ts` fails when an image misses a workspace manifest |

Job names and required checks do not change.

## The editor package

### Vendoring

The package is copied, not linked:

- No git submodule or subtree: both make every clone and every upstream sync
  aware of a second repository, and subtree merges rewrite history the
  nightly sync then has to carry.
- No registry dependency: the package is private to oppulence-canvas and is
  built for a Bun, Turbo and Biome monorepo, so it cannot be installed as is.

`packages/platejs-editor/UPSTREAM.md` records the source repository, path and
commit, the rename, every local change, and the ownership and license
confirmation. Pulling a later fix is a reviewed diff:

1. In oppulence-canvas, `git diff <recorded commit>..<new commit> -- packages/platejs-editor`.
2. Apply it here with `git apply --directory=packages/platejs-editor -p3`
   (paths shift by the package prefix), resolve against the local changes
   listed in `UPSTREAM.md`, and run the package tests.
3. Record the new commit in `UPSTREAM.md` in the same change.

### Name and API

The package is renamed `@shots/platejs-editor`, a platform namespace. Its 27
subpath exports, including the `platejs/*` and `@platejs/*` re-exports, keep
their paths, so `@canvas/platejs-editor/ui` becomes `@shots/platejs-editor/ui`
and nothing else changes for a caller.

### Making it build here

| Upstream assumption | Here |
| --- | --- |
| `@canvas/tsconfig` | A package `tsconfig.json` that extends the root one |
| `types: ["bun-types"]` | Dropped; the package uses DOM and Node types only |
| `bun test` | `tsx --test`, from the root `npm test` |
| Biome | The repo's ESLint and Prettier, scoped to the package, without reformatting upstream files |
| React peer `19.2.5` | The root moves to React `19.2.5`; `npm ls react` must show one copy |

The `platejs` and `@platejs/*` family is pinned to one exact version set, and
dependencies shared with the app (`zod`, `ai`, `lucide-react`,
`tailwind-merge`, `sonner`, `date-fns`, Radix) resolve to one copy each.
`npm audit` findings that remain are recorded in `UPSTREAM.md` with the reason
each is accepted.

Next.js compiles the package through `transpilePackages`, and the app's
Tailwind v4 entry adds an `@source` for `packages/platejs-editor/src` so the
package's classes are generated.

### Boundaries

The package is a library. It must not reach into the app or the environment:

- **No app imports.** Nothing under `packages/platejs-editor` imports `@/`.
  The app imports only the package's public exports.
- **No `process.env`.** Configuration arrives as props or providers.
- **No hard-coded routes.** No `/api/*` string appears in the package.
- **Uploads are injected.** The uploadthing packages are removed. The
  package takes an upload adapter; the app implements it
  with the existing signed upload flow (sign, `PUT` to R2, complete) through
  the Go backend.
- **AI is injected.** The AI chat and copilot plugins take an endpoint or a
  handler. The app points them at platform AI routes declared in
  `lib/api/contracts/ai.ts`, which meter credits and honor the workspace AI
  kill switch.
- **Collaboration is configured.** The collab URL, token source and cursor
  identity are passed in by the app.

A test scans the package and fails on an `@/` import, a `process.env` read or
an `/api/` literal, next to the existing `test/web-database-boundary.test.ts`
and `test/api-platform-boundary.test.ts`.

### Bundle cost

The editor is heavy. It loads with `next/dynamic` on the draft composer route
only, after the page renders, and DOCX support (mammoth and the Word writer)
loads on first use. No package code reaches the screenshot editor's main
route.

Measured on production builds, signed in, gzipped JavaScript the browser
downloads (2026-10-17):

| Route | Before | After |
| --- | --- | --- |
| Screenshot editor (`/`), first load | 920.0 KB | 926.9 KB (+0.75%, chunk re-partitioning and the Drafts nav entry) |
| Drafts list (`/drafts`), first load | none | 944.3 KB |
| Composer (`/drafts/{id}`), first load | none | 951.9 KB |
| Composer, editor chunk after render | none | 1,266 KB |
| Composer, DOCX import or export on first use | none | 369 KB |

## Content drafts

### Data model

A new Ent model, `ContentDraft` (table `content_draft`), added through a
`platformmigrations` migration. It does not overload `ScheduledPost`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | text | cuid |
| `organizationId` | text | workspace scope; cascade on workspace delete |
| `title` | text | up to 200 characters |
| `body` | jsonb | Plate JSON |
| `plainText` | text | plain-text render, for search and previews |
| `assetIds` | jsonb | workspace asset ids attached to the draft |
| `channelConnectionIds` | jsonb | the target channels |
| `status` | text | `draft`, `scheduled` or `archived` (lowercase, checked) |
| `version` | integer | optimistic concurrency, starts at 1 |
| `collabState` | bytea | Yjs document state, written by the collab server |
| `createdByUserId`, `updatedByUserId` | text | set null when the user is deleted |
| `createdAt`, `updatedAt` | timestamp | |

### API

Go serves `/v1/content-drafts`: list, create, get, update and delete. Update
takes the version the client last saw and answers `409` when it is stale.
The SDK exposes the same methods, and `lib/backend/sdk.ts` reaches them.

The web exposes `/api/v1/content-drafts` and `/api/v1/content-drafts/{id}`
with zod contracts in `lib/api/contracts/`, so they appear in the OpenAPI
document and the Scalar reference. The composer autosaves on a debounce and
sends the version with every save; a `409` reloads the latest version
instead of overwriting it.

### Permissions, plan and flag

| Operation | Requirement |
| --- | --- |
| List, get | `artifact:read` (every workspace member, or an API key with that scope) |
| Create, update, delete | `artifact:edit`, or an API key with `draft:write` |
| Schedule, reschedule, cancel | `publish:manage`, as CopyBoard requires; a session only |

Every operation is plan-gated by a new workspace feature, `content:drafts`,
declared on each contract with `x-shots-entitlement` and enforced in Go. The
UI and the web routes are also behind a flag, `PLATFORM_CONTENT_DRAFTS`,
following the campaign workflow's `PLATFORM_CAMPAIGN_WORKFLOW` pattern in
`lib/auth/page-access.ts`. Create, update, schedule and delete each write a
tenant audit record in the same transaction as the change
(`product.content_draft_created`, `_updated`, `_scheduled`, `_deleted`).

### Scheduling a draft

"Schedule" creates one `ScheduledPost` per selected channel connection,
through the existing Go scheduling path and Temporal workflow. There is no
second scheduler.

- A scheduled post links to **either** a creative variant or a draft:
  `variantId` becomes nullable, `contentDraftId` is added, and a check
  constraint requires exactly one. The zod schema, Go validation and Ent
  schema change together.
- The idempotency key is `content-draft:<draft>:<connection>:v<version>`, so a
  double click replays the same posts instead of creating new ones.
- Scheduling snapshots the caption into each post. Editing the draft
  afterwards does not change queued posts. Rescheduling cancels the draft's
  live posts and creates new ones under the new version.
- Go re-validates each caption against its channel's limit and the
  workspace's prohibited terms, as the campaign path does.
- Publishing takes the post's media from the draft's first image asset. The
  publish job carries one asset today; a draft with no image publishes as
  text. More images per post are a later change to the publish job, and the
  composer says so before scheduling.

### Serialization

Social channels take plain text. One pure function turns Plate JSON into a
caption per channel and reports what it had to degrade:

| Node | Caption |
| --- | --- |
| Paragraphs, headings, line breaks | Text with line breaks |
| Lists | `- item` or `1. item`, indented per level |
| Links | The link text followed by the URL |
| Mentions, hashtags | Their plain text |
| Tables | Aligned text rows |
| Math | The LaTeX source |
| Footnotes | Numbered markers, with the notes listed at the end |
| Unsupported marks | Dropped, and reported |

The composer shows the per-channel preview the serializer produces, a live
character counter per selected channel (X 280, LinkedIn 3,000, Instagram
2,200, matching the campaign rules in `lib/launch/guards.ts`), and a warning
before scheduling when content is degraded for a channel.

### Editor configuration

The composer uses the full `EditorKit`: tables, math, footnotes, columns,
table of contents, media, mentions, emoji, comments, suggestions and
collaboration stay on. DOCX and Markdown import and export work in production;
images in an imported `.docx` are re-uploaded through the same upload adapter.
AI assistance goes only through the platform AI routes.

## Collaboration

Real-time co-editing ships through Yjs and Hocuspocus.

```text
browser ──token request──▶ web /api/v1/content-drafts/{id}/collab-token ──▶ Go (issues token)
browser ──websocket + token──▶ collab-server ──authorize / load / store──▶ Go
```

- **Deployable.** `packages/collab-server`, its own workspace package,
  `Dockerfile` and Helm entry in `charts/screenshot-studio`.
- **No database.** The server never connects to Postgres or Redis. It loads
  and stores the Yjs state through Go endpoints under `/v1/collab/`.
- **Authentication.** Go issues a short-lived token (five minutes) scoped to
  one draft, one user and one access level, signed with a key only Go holds.
  The collab server cannot mint or verify tokens; it asks Go to authorize each
  connection and passes the connection's token on every load and store, so its
  own service credential cannot read or write any draft by itself. A user of
  another workspace cannot obtain a token for the draft, and a token for one
  draft does not open another.
- **Access.** Members with `artifact:edit` join read-write; members with only
  `artifact:read` join read-only.
- **Presence.** Cursors and presence show the workspace user's name and a
  colour derived from their id, supplied by the app from the session.
- **Offline.** `y-indexeddb` caches the document for offline editing.
- **WebRTC.** `y-webrtc` stays available in the package but is **off in
  production**. The package refuses a WebRTC configuration without explicit
  signaling servers, so the public y-webrtc signaling servers are never used.
  Turning it on requires our own signaling and TURN servers and a revision of
  this RFC. The app's build aliases y-webrtc to a stub that refuses to start,
  so neither the library nor its public defaults ship.
- **Configuration.** The collab URL comes from server config
  (`PLATFORM_COLLAB_URL`) passed in by the app.

### Endpoints and secrets

| Route | Caller | Credential |
| --- | --- | --- |
| `POST /v1/content-drafts/{id}/collab-token` | the web, for a signed-in member | service token and the member's session |
| `POST /v1/collab/authorize` | the collab server, per connection | `COLLAB_SERVICE_TOKEN` and the member's token |
| `GET`, `PUT /v1/collab/documents/{draftId}` | the collab server, to load and store | `COLLAB_SERVICE_TOKEN` and the member's token |

Only the backend holds `COLLAB_TOKEN_SECRET`, the signing key. The collab
server holds `COLLAB_SERVICE_TOKEN`, which opens the three collab routes and
nothing else, and every one of them also needs a member's token for that
draft. A connection is admitted with an unexpired token; loads and stores
accept the connection's token for twelve hours after it expires, so a long
session keeps saving. A member removed from the workspace is refused on their
next connection, and one demoted below `artifact:edit` joins read-only.

The server runs as one replica: a document's live state lives in one process.
More replicas need the Hocuspocus Redis extension or routing by document name.
Comment threads (the discussion plugin) are kept in the editor's memory and
are not yet stored with the draft; the comment marks in the text are.

## Rollout

Each step is its own pull request and can be reverted alone.

1. This RFC.
2. The workspace migration, with no editor.
3. The editor package vendored, building and tested, not yet consumed.
4. Upload, AI, collaboration and configuration adapters, and the boundary test.
5. Drafts: Ent model, Go API, SDK and the `/api/v1` contract.
6. Draft-to-scheduled-post linking, plus the serializer.
7. The composer UI behind the flag, plus end-to-end tests.
8. The Hocuspocus collab service, plus collaboration end-to-end tests.

## Observability

Scheduling success is the metric that matters: the share of draft schedule
requests that produce one live post per selected channel without a retry.
Alongside it, the collab server logs each refused connection with its reason
(expired, wrong draft, wrong workspace), and autosave counts its `409`
responses, which show how often concurrent editors collide.

## Acceptance criteria

1. A clean clone passes `npm ci && npm run quality:check && npm run build`,
   and the Docker image builds and serves the composer route.
2. SDK publishing passes a dry run and release-please is unchanged.
3. `npm ls react react-dom platejs` shows one version of each.
4. A user writes a draft, saves it, reloads it, and schedules it to several
   channels; each channel receives a correctly serialized caption within its
   limit, and a double submit creates no duplicate posts.
5. Campaign-variant scheduling (CopyBoard) works unchanged.
6. Tables, math, footnotes, DOCX import and export, and collaboration work in
   a production build.
7. The collab server authenticates through the Go backend, keeps workspaces
   isolated, and has no database access.
8. The shipped bundle has no uploadthing dependency, no hard-coded `/api`
   path from the package, and no public WebRTC signaling.
9. A trial upstream sync conflicts only on fork-owned files.

## Decisions

- **Workspace layout:** `packages/*` beside a root app. Decided 2026-10-17.
- **Vendoring:** source copy with `UPSTREAM.md`. Decided 2026-10-17.
- **Ownership and license:** confirmed. PlaybookMediaLLC has the right to copy
  this code from Oppulence-Engineering. Decided 2026-10-17.
- **First consumer:** manual drafts that can be scheduled. Decided 2026-10-17.
- **Collaboration in production:** on, through Hocuspocus; WebRTC off.
  Decided 2026-10-17.
