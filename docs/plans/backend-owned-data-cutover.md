# Backend-owned data and publishing cutover

**Status:** Web data access migrated; production cutover not yet applied
**Date:** 2026-10-14
**Decision owner:** Screenshot Studio

## Goal

Make `screenshot-studio-backend` the only application boundary in front of
durable product data. The Next.js app renders the UI and calls backend APIs. A
single PostgreSQL database and its `public` schema hold identity, tenant, campaign, asset, audit, and
social connection data. One `scheduled_post` record is the authoritative
publication state from scheduling through the remote receipt.

There are no customer users to migrate. Use a fresh database and a controlled
cutover rather than copying the current test organizations and post rows. Keep
the old databases and object stores read-only for a defined rollback window.
Recreate the owner account and reconnect test social accounts after cutover.

"One database" means one logical product PostgreSQL database and one schema.
Separate least-privilege roles inside it are allowed. R2 remains object
storage; Redis and Temporal remain execution infrastructure, with no competing
product post state. The current Supabase Storage metadata database must be
retired before the final gate.

## Current boundaries to remove

| Current owner | Data or operation | Change |
| --- | --- | --- |
| Next.js + Prisma | Better Auth, organizations, tenant product tables, audit, scheduling, API routes, AI tool writes | Move server operations into backend APIs and remove the web runtime's DB credentials. |
| Tenant Go orchestrator | Reads and updates Prisma-owned scheduling tables; calls Go Postiz HTTP API | Make it a backend module using the canonical repository and in-process provider gateway. |
| Go Postiz port | Separate database with `Organization`, `User`, `Integration`, `Media`, and `Post` tables | Keep provider adapters and needed connection metadata; remove the second customer publication record and map integrations to the canonical organization. |
| Supabase Storage API | Separate metadata database and object API in front of R2 | Move tenant upload/download authorization and object signing into the backend; keep media bytes in private R2. |

Both existing SQL migration sets can coexist in `public`: the product tables
are lowercase and the social clone's tables use quoted capitalized names.
This was verified on a disposable PostgreSQL database. Simply pointing both
services at it is still insufficient: product publishing currently writes a
web `scheduled_post` plus a Go `Post`. This is also a domain and API migration.

## Target architecture

```text
Browser / Next.js UI
       |
       | same-origin tRPC facade using screenshot-studio-backend-sdk
       v
screenshot-studio-backend
  auth module -> session, 2FA, organization and membership
  product API -> campaigns, assets, approvals, billing, audit, AI tool writes
  publish API + Temporal worker -> one scheduled_post + publication_attempt
  provider gateway -> LinkedIn / X / Instagram adapters
  media API -> private R2 upload, read and short-lived signatures
       |
       v
one PostgreSQL product database (`public` schema)
```

Ent is the backend's product data model and query layer. The existing Prisma
schema is a compatibility reference for the cutover; Prisma queries and
migrations leave the runtime and deployment when each domain is moved. The
existing Go social Ent models must be merged with the product models behind
one migration owner. Versioned SQL generated from the Ent model is acceptable
for deploys, but neither Prisma nor a second migration process owns product
tables at the end of the cutover.

The backend derives the organization and actor from the authenticated session
or scoped API key on every request. It performs authorization and tenant-scoped
queries itself. The browser never sends an organization ID that the backend
treats as authority. Public REST, tRPC compatibility routes, webhooks, OAuth
callbacks, and worker activities all call the same backend domain operations.
Next.js routes may proxy requests for same-origin cookies and compatibility,
but perform no database queries or business-state transitions.

Move authentication to the Go backend and model users, accounts, sessions,
organizations, memberships, 2FA, API keys, SSO, and SCIM state with Ent.
Preserve Better Auth's cookie and password compatibility during the transition
or require a new owner sign-in after the fresh cutover. The web forwards
same-origin auth requests; it does not run the Prisma adapter or hold a DB URL.

Use one ordered backend migration command for all product schemas. The auth
adapter may query its tables but does not run its own production migration.
Keep the existing product tables and social adapter tables in `public` while
removing redundant social identity and post tables. The canonical organization
ID is shared throughout; remove `PostizTenantBinding` and per-tenant internal Postiz API keys once
all callers use backend session/service authorization.

## One publication state machine

`scheduled_post` owns `DRAFT`, `SCHEDULED`, `PROCESSING`, `PUBLISHED`,
`FAILED`, `CANCELLED`, and `UNKNOWN_DELIVERY`. `publication_attempt` records
attempt number, provider request identity, remote post ID/URL, timestamps, and
failure code. A transition and its audit/outbox event commit in one database
transaction. `PUBLISHED` requires a confirmed remote receipt. Ambiguous
delivery remains `UNKNOWN_DELIVERY` until reconciled; it is never blindly
reposted.

The backend worker waits until due, reloads the approval, asset revision,
workspace status, and destination, and calls the provider adapter directly.
It stores the provider result on the same attempt. No customer publish creates
a legacy Go `Post` row or calls `/public/v1/posts` internally. Direct provider
calls need provider-neutral connection/media inputs instead of a Postiz `Post`
entity, plus adapters for pending media processing and provider-side completion;
the worker retains a durable Temporal workflow keyed by the canonical post ID.
Duplicate dispatch must converge on one attempt and one remote post.

Store one canonical asset/object key in the product database. Encrypt social
tokens at rest, keep encryption keys in the secret manager, and limit token
reads to the provider gateway. The backend reads or signs private R2 media
when the publish activity runs, including
retries and a post scheduled more than 24 hours ahead. Provider-required
derived images/videos become versioned asset rows, not a second source asset
record in a Postiz media database. Remove the tenant-R2-to-Postiz-R2 copy from
the customer path after adapter parity is proven.

## Implementation sequence

### Current implementation checkpoint (2026-10-15)

- **The web holds no database access.** No runtime file imports a database
  client or reads a database URL, and the web package ships no Prisma client.
  `test/web-database-boundary.test.ts` enforces both in `npm test`. The Prisma
  schema, migrations, and `lib/db.ts` are deleted.
- **Every product read and write goes through Go.** Web modules call
  `backendSDK(context)` (`lib/backend/sdk.ts`) for workspaces, membership,
  invitations, brand, product surfaces, releases, campaigns, designs,
  creative, launch specs/plans/revisions/runs, announcements and audience,
  assets, the screenshot cache, audit logs/drains/retention, entitlements,
  quotas, billing sync, source webhooks, outbox replay, AI tool writes,
  publishing, and social OAuth. The npm registry package, dependency, and
  lockfile are pinned to 0.1.7; its published JavaScript and type declarations
  match the local SDK build, and a clean `npm ci` succeeds.
- **Better Auth keeps its logic in the web, its rows in Go.** Password,
  session, 2FA, SSO, SCIM, and API-key handling stay in Better Auth, which
  reads and writes through a custom adapter (`lib/auth/backend-adapter.ts`)
  backed by a service-authenticated Go auth store limited to Better Auth's
  tables (`services/internal/authstore`). Organization hooks post auth events,
  and Go provisions workspace settings and entitlements, ends a removed
  member's sessions, and audits. This was chosen over porting Better Auth to
  Go because it keeps auth behavior and cookies unchanged. Each adapter call is
  one statement, so Better Auth's multi-step writes are not transactional.
- **Go authorizes every request for its principal.** Sessions need a member
  role. Organization API keys must be enabled, unexpired, and issued for the
  workspace; the web checks their scopes first. Support grants must be live.
  Webhook and service callers need an existing workspace that is not
  scheduled for deletion.
- **Dispatch lives in the backend.** The web dispatch routes for scheduled
  posts, the tenant outbox, and audit drains are deleted; the Temporal worker
  and maintenance jobs own them. The web's legacy Postiz client and scheduling
  path are deleted. The worker calls LinkedIn, X, and Instagram adapters
  directly, signs the original private asset when due, and records the remote
  receipt on the canonical post. The operator tenant binding still maps
  product organizations to social integrations.
- **One migration owner.** `/platform-migrate` applies product and social SQL
  into the same PostgreSQL database and `public` schema. Compose, kind/Helm,
  CI, and the DigitalOcean predeploy job run it before the backend. It adopts
  history Prisma already applied. The local stack runs the backend, Temporal,
  and worker by default, and the web gets no database URL.
- **Verified at this checkpoint:** the full Go suite with database integration
  tests on disposable PostgreSQL, 298 web unit tests, typecheck, lint, format,
  a Next production build, fresh public-schema migration repeated twice,
  local Compose smoke, Better Auth sign-up/sign-in and organization flows
  through Go, SDK API round trips, and one isolated Playwright publish with a
  private image, one canonical receipt, zero legacy `Post` rows, idempotent
  scheduling, and cancellation. The isolated full-stack gate also passed 429
  and 500 retries, expired credentials, and one remote receipt per schedule.
  Six browser scheduling/OAuth tests passed for X, LinkedIn, and both Instagram
  callback variants. Production deployment has not been applied.
- **Storage service retired.** Asset bytes stay in private R2 and the backend
  signs every transfer; the Supabase Storage service, its metadata database,
  and the web storage proxy are gone (`docs/tenant-storage.md`).
- **Social gate on the backend path.** `bin/social-gate` runs an isolated full
  stack and `test/e2e/social-gate.spec.ts` drives scheduling through the web SDK,
  backend, Temporal worker, private RustFS, and fake social API. It asserts
  canonical receipts and zero legacy social posts.
- **Open before the release gates:** deploy the backend before the web, because
  the old `web-migrate` job is replaced by `platform-migrate`; then run the live
  LinkedIn and Instagram canaries through the customer UI.

1. **Inventory and freeze the contract.** Enumerate every web Prisma import,
   tRPC/REST route, Better Auth plugin, AI tool write, webhook, maintenance job,
   storage operation, and external Postiz API caller. Record current state
   transitions and a read/write owner for every table. Confirm production
   customer, queued-post, and connected-account counts before treating the
   data as disposable. Add contract tests for the existing UI and API behavior.
2. **Build the backend data foundation.** Provision one fresh PostgreSQL
   database with one `public` schema, roles, Ent models, versioned migrations,
   backup/restore, and one canonical organization ID. Port the product table
   schema and core tenant repository to the backend. Prove both local Compose and App Platform can
   boot and migrate it repeatedly. Keep old databases untouched.
3. **Move auth behind the backend.** Implement compatible password, session,
   organization, 2FA, API-key, SSO, and SCIM operations with Ent; proxy
   `/api/auth` from Next.js. Preserve same-origin cookies and CSRF checks;
   reject client-supplied identity headers.
   Recreate an owner
   account. Verify sign-in/out, session revocation, 2FA, organization roles,
   API keys, invitations, and configured SSO/SCIM before switching production
   traffic. New sessions are expected; old test sessions are invalidated.
4. **Move product APIs and writes.** Implement backend domain APIs for
   workspace, release, campaign, design, asset, approval, billing/entitlement,
   audit, and AI tool mutations. Convert the Next tRPC and REST handlers to
   typed backend clients or proxies one domain at a time. Move source webhooks,
   maintenance/outbox, screenshot cache, and server-rendered data reads. Require
   every actor path to enforce tenancy in the backend.
5. **Unify publishing.** Move channel OAuth/connection metadata to the
   canonical organization. Make the tenant Go Temporal workflow call the social
   provider adapters in process, persist the remote receipt on the canonical
   attempt, and expose one schedule/status/cancel API. Stop creating legacy Go
   `Post` rows for Screenshot Studio. Retire the binding, internal API key hop,
   status polling between two databases, and redundant Postiz scheduling API
   only after consumer inventory confirms they are unused.
6. **Move media access.** Serve signed upload/download and asset completion
   from the backend against private R2. Replace Supabase Storage metadata with
   canonical asset rows and retire its separate service and database.
7. **Cut over and remove old paths.** Freeze new schedules, drain or cancel
   test workflows, snapshot the old databases, deploy the new migration and
   backend, point the web app at it, then create the owner/workspace and
   reconnect approved test destinations. Remove `DATABASE_URL`, Prisma client,
   migration jobs, and direct R2 service credentials from the web runtime.
   Remove `POSTIZ_DATABASE_URL` and `STORAGE_DATABASE_URL` when their old
   services are retired. Revoke old internal API keys and superseded social
   tokens after the rollback window. Keep old databases read-only until then;
   never run both old and new publishing workers against one account.

## Release gates

- A production-shaped build of the Next.js container has no database URL,
  Prisma runtime, direct database network path, or ability to sign storage
  requests. A CI import/config check enforces this.
- Only one product database and one backend migration command are configured.
  Auth, tenant, and social reads/writes use the backend-owned connection;
  separate schemas/roles do not create separate product databases.
- A real-browser flow creates and approves a variant, schedules it, reaches
  the real backend and worker, then records one remote receipt. Assert exactly
  one canonical post row, one successful attempt, zero legacy Go `Post` rows,
  and one fake social post after duplicate dispatch.
- Cancellation, approval revocation, wrong-tenant access, credential expiry,
  429/5xx, unknown delivery, worker restart, and a media fetch failure produce
  the specified state without duplicates. A post genuinely held for more than
  24 hours receives a fresh private-media signature when published.
- Auth, organization/API-key isolation, audit, webhooks, asset access, billing
  entitlements, and AI mutations pass API and browser tests with the web
  database connection disabled.
- Run isolated live LinkedIn and Instagram canaries through the **customer UI**
  and one production-host canary per enabled provider. Verify visible media,
  caption, remote ID/URL, canonical database state, and no duplicate. X stays
  disabled until API credit and its image/video canaries are available.

The provider's remote state still needs receipt checks for uncertain network
outcomes. That check updates one canonical attempt; it does not synchronize
two local post tables.

## Rollback and scope control

Before the first external publish from the new worker, rollback is a traffic
switch to the old web/backend deployment and old read-only snapshot. After a
new provider post exists, keep the new worker stopped during rollback and
reconcile remote IDs before any old worker resumes. Never run both schedulers
for the same destination. Preserve backups until the owner signs off on the
canaries and the rollback window closes.

This plan replaces the present assumptions in RFC 002, RFC 003, RFC 020, the
Postiz Go deployment guide, Compose, DigitalOcean rendering, and CI. Update
those documents and configurations as the matching phases land, then remove
the old architecture claims at final cutover.
