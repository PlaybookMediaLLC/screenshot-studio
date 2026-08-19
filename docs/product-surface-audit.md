# Product surface audit

An assessment of what the codebase can do today, as distinct from what
the RFCs plan. Written to answer one question: what would make Screenshot
Studio useful to a team whose job is marketing and product demos.

Every claim here was checked against the code. Where a first pass was
wrong, the correction is recorded rather than quietly dropped.

## The finding

The repository contains two products that do not touch each other.

**The editor** is substantial and works: canvas composition, device
frames, 3D transforms, annotations, a keyframe timeline with animation
presets, and video export through WebCodecs. A person can do real work in
it.

**The platform** is substantial and works: 43 Prisma models, 39 tRPC
procedures, tenant isolation, audit logging with SIEM drains, an approval
workflow, scheduled publishing, and release announcement delivery.

Neither can reach the other.

| Check                                               | Result                                         |
| --------------------------------------------------- | ---------------------------------------------- |
| Editor modules importing `lib/trpc` or `lib/tenant` | **0**                                          |
| Platform routers with any UI consumer               | **0** of 11                                    |
| Authenticated pages                                 | `workspace`, `onboarding`, `accept-invitation` |
| What `/workspace` renders                           | Settings: members, SSO, audit, API keys        |
| Editor export destination                           | `createObjectURL` and a browser download       |

The editor persists drafts to IndexedDB and exports by download. Its
output never becomes an `Asset`, never reaches R2, never enters approval,
and never appears in a release.

The consequence: a marketer can beautify a screenshot and download it,
which needs no account. A team can call an API that no screen exposes.
Signing in currently leads to a settings page.

## Correction to a first pass

An earlier count claimed "17 of 43 models unimplemented" and named
`CreativeVariant` and `Approval` among them. That was wrong. It came from
matching `prisma.<model>` without accounting for transaction clients or
for models the Better Auth adapter manages.

Checked properly, both are implemented in `lib/tenant/creative.ts`, which
creates variants and upserts approvals. The genuinely unimplemented set is
three models, all capture:

- `CaptureRecipe`
- `CaptureJob`
- `Capture`

The rest of the schema has working implementations. The gap is not that
the domain is hollow; it is that the domain has no interface and no
automated input.

## Ranked recommendations

### 1. Connect the editor to the workspace

One action, "Save to workspace," that uploads editor output to R2, records
it as an `Asset`, and shows it in the workspace.

This is first because it turns two half-products into one. It gives an
account a reason to exist and gives the platform its first real input. The
asset router, R2 pipeline, and tenant object keys already exist and are
tested, so this is wiring rather than new infrastructure.

**Status: done.** The editor offers "Save to workspace" to signed-in
users, reusing the presign, upload, complete flow the API already
exposes.

This initially could not work, because tenant asset storage had no
service behind it: the `STORAGE_*` variables were unset on the
deployment. A Supabase Storage service now runs as its own Fly app,
backed by the existing R2 bucket, and the full path is verified by
`npm run verify:storage`. See
[tenant asset storage](tenant-storage.md).

### 2. A workspace that shows the work

`/workspace` means "settings" today. Nothing lists releases, assets,
campaigns, or announcements, so there is nowhere for a signed-in user to
land that explains what the product does.

The `list` procedures already exist for release, asset, campaign, and
announcement.

**Status: done.** `/assets` lists saved assets with edit, download, and
delete. `/activity` lists releases, campaigns, announcements, and
scheduled posts. Creation still happens through the API; those flows
are items 3 through 7.

### 3. Automated capture

`CaptureRecipe`, `CaptureJob`, and `Capture` are schema-only.
`screenshot-service.ts` fetches one-off URLs through Microlink, and there
is no way to say "capture these six screens at these viewports on every
release."

This is what separates a screenshot editor from a marketing system.
Without it a human is in the loop for every screen of every release, which
is the work the product exists to remove. `playwright-core`,
`@sparticuz/chromium`, and Trigger.dev are already dependencies.

### 4. Announcement authoring interface

Delivery is implemented and verified end to end, but no screen can trigger
it. Ranked below capture because an announcement needs something worth
announcing, and nothing flows in yet.

### 5. Demo video from captured product state

The timeline, keyframes, animation presets, and WebCodecs export are in
place, but frames come from manual uploads. The valuable artifact is a
narrated walkthrough generated from a real click-through. Depends on 3.

### 6. Brand application rather than brand storage

Storing colors and typography is not the value. The value is that every
generated artifact comes out on-brand without anyone choosing.

### 7. Approval as a workflow rather than a record

The data model is implemented, but no screen submits, reviews, or
approves. For a team this is the difference between a marketer being able
to use the product and being allowed to.

## A note on the roadmap

The README ranks RFC 010, the programmable creative engine, as next. It is
an internal refactor of the editor into domain services and produces no
user-visible capability.

Items 1 and 2 are days of work on tested infrastructure and change what
the product is. They are the smaller and higher-value move.

## Second pass: the asset loop (2026-08-19)

A re-audit on the `audit/full-product-flow` branch. It checked one
question: can a user move work through the product without a dead end?

### The flow, verified against the code

1. **Upload.** `UploadArea` and `GlobalDropZone` accept drag, paste, and
   file picks. `useImageStore.setImage` puts the file on the canvas.
2. **Tune.** The editor applies frames, backgrounds, filters, 3D,
   annotations, and animation. Drafts autosave to IndexedDB.
3. **Store.** "Save to workspace" renders the export, reserves an
   `Asset`, PUTs to a presigned URL, and marks the upload complete.
   `npm run verify:storage` proves the storage path.
4. **Edit and resave.** This was the dead end. An asset could only be
   downloaded. The branch closes the loop:
   - The assets page gains Edit, Download, and Delete actions per asset.
   - Edit opens the editor with `?asset=<id>`. `WorkspaceAssetLoader`
     signs a download, fetches the bytes, and loads them onto the canvas.
   - The user tunes again and saves again. The format selector already
     lets the resave use PNG, JPEG, or WebP, so "resave as" needs no new
     code.
   - Delete wires the last unused procedure of the asset router.

### Backend surface against UI surface

The app router exports 15 routers with 40 procedures. Every procedure
also accepts an organization API key (`tenantProcedure`), and the
developer settings screen creates those keys. So the full backend is
callable today; the gap is first-party screens.

| Router | Procedures | First-party UI |
| --- | --- | --- |
| asset | 5 | All 5 (delete added on this branch) |
| apiKey | 3 | All 3 |
| brandKit | 2 | All 2 |
| sourceApp | 1 | All 1 |
| workspace | 1 | All 1 |
| release | 2 | list (the activity page) |
| campaign | 5 | list (the activity page) |
| announcement, audience | 6 | list (the activity page) |
| channelConnection, scheduledPost | 5 | scheduledPost.list (the activity page) |
| creativeTemplate, creativeVariant | 4 | None |
| productSurface | 4 | None |
| brandProfile | 2 | None |

Sixteen of 40 procedures have a screen. The `/activity` page lists
releases, campaigns, announcements, and scheduled posts read-only, so
work created through the API is now visible in the app. The remaining
screenless procedures are creation and workflow actions. They match
recommendations 3 through 7 above: they need workflow surfaces, not
wiring, and the ranked order there still holds.

### Navigation, before and after

Before: each signed-in page built its own header. The assets page had
one link. The settings page had another. The editor routed only through
the account menu.

After: a shared `AppHeader` gives every platform page the same routes —
Editor, Assets, Activity, Settings — plus the account menu, which also
switches workspaces and signs out. The editor keeps its tool header;
its account menu already routes to Assets and Settings. The marketing
pages keep their own `Navigation`, which routes to features, contact,
and sign-in.

## A strategic mismatch

The marketing site sells the editor: `/for/marketers`,
`/for/developers`, `/for/designers`, and eight feature pages, all pointing
at the free tool.

The platform sells the workflow. No page describes the workflow, and no
screen delivers it.
