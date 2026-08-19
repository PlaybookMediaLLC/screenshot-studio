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

**Status: built, blocked on configuration.** The editor now offers "Save
to workspace" to signed-in users, reusing the presign, upload, complete
flow the API already exposes.

It cannot work in the current deployment. Tenant asset storage is a
Supabase Storage service configured through `STORAGE_API_URL`,
`STORAGE_SERVICE_KEY`, and `STORAGE_BUCKET`, and none of those are set on
the Fly application. R2 is configured, but it serves editor backgrounds
and overlays through a public read path, which is a different concern from
per-tenant private assets.

So the deployment has object storage for public assets and none for tenant
assets. Either a Supabase Storage service is provisioned and its
credentials set, or `lib/storage/client.ts` gains an S3-compatible driver
so the existing R2 bucket can serve both. The second is likely cheaper
given R2 already exists, but it is a deliberate infrastructure decision
rather than a wiring change.

### 2. A workspace that shows the work

`/workspace` means "settings" today. Nothing lists releases, assets,
campaigns, or announcements, so there is nowhere for a signed-in user to
land that explains what the product does.

The `list` procedures already exist for release, asset, campaign, and
announcement.

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

## A strategic mismatch

The marketing site sells the editor: `/for/marketers`,
`/for/developers`, `/for/designers`, and eight feature pages, all pointing
at the free tool.

The platform sells the workflow. No page describes the workflow, and no
screen delivers it.
