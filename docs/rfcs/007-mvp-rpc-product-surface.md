# RFC 007: MVP RPC Product Surface and Developer Workflow

**Status:** Implemented (tRPC surface; see `lib/trpc/`)
**Date:** 2026-08-13
**Depends on:** RFC 002 through RFC 006
**Owners:** Product, Engineering, and Security

## Decision

Build the MVP inside the existing Next.js application. The current standalone
Docker image will serve the editor, Better Auth routes, tRPC API, and the few
required webhook adapters from one web container. Do not add a Go or Rust
backend, a monorepo, or a second always-on API service for the MVP.

Use:

- PlanetScale Postgres and Prisma for tenant data.
- Better Auth for users, sessions, organizations, roles, and organization API
  keys.
- tRPC and Zod for browser and customer machine API calls.
- A private R2 bucket for tenant source and generated media.
- Trigger.dev Cloud for processing, rendering, and scheduling work.
- Postiz as the first scheduler connector and local integration fixture.

Buffer, Post Bridge, and a separate API service are later work. Enterprise SSO
and SCIM are available to entitled organizations. The connector contract in RFC 005 keeps
those additions possible without making them MVP dependencies.

`Dark` was not identified from the current request. It is not a selected local
dependency. Confirm its repository or product name before it enters the build.

## The MVP promise

In one workspace, a founder can take a release note or product screenshot and
produce branded, reviewable social drafts that can be scheduled through one
connected provider.

```text
manual update, upload, GitHub/GitLab, or API key
  -> tenant release with one versioned brand kit
  -> private R2 input and Trigger.dev draft work
  -> human review and approval
  -> Postiz schedule and provider receipt
```

The first useful artifact pack is deliberately small: release Markdown, an X
draft, a LinkedIn draft, and one square or vertical visual. It proves the full
release-to-distribution path without pretending that every channel and content
type is complete.

## Required MVP surface

| Capability          | MVP behavior                                                                                                                            | Explicit limit                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Sign-in and tenancy | Email, Google, Microsoft, GitHub, active organization, and fixed roles                                                                  | SSO and SCIM require enterprise entitlement and TOTP     |
| Brand kit           | Name, logo asset, colors, font-family tokens, spacing/radius, tone, default CTA, and immutable published version                        | No custom design-system builder                          |
| Release inputs      | Manual Markdown, media upload, GitHub release webhook, GitLab release/tag webhook, generic signed changelog webhook, and API-key intake | One normalized release format                            |
| Remote upload       | API key creates an upload intent; browser or customer uploads directly to private R2; worker validates it                               | No large file proxy through Next.js                      |
| Draft production    | One source release creates the four default artifacts with source and brand lineage                                                     | Human approval remains required                          |
| Distribution        | Connect one Postiz account, choose one destination and time, hand off an approved artifact, and record its receipt                      | Buffer and Post Bridge adapters come after validated use |
| Audit and recovery  | Audit tenant actions, preserve source-to-post lineage, use outbox and idempotency for tasks                                             | No analytics optimization loop yet                       |

## Runtime topology

```text
                 Fly web container
     Next.js editor + Server Components + tRPC
      /api/auth/*       Better Auth adapter
      /api/trpc/*       tenant and API-key procedures
      /api/webhooks/*   raw-body signature adapters
                 |          |          |
             PlanetScale    R2    Trigger.dev Cloud
                                       |
                                  Postiz / social APIs
```

All first-party product operations share the same domain services. The
webhook routes are an intentional exception to tRPC: GitHub and GitLab need a
raw request body for signature validation. Each adapter verifies the request,
calls the same domain service as tRPC, and does nothing else.

This is still one deployable Next.js web/API container. Trigger.dev workers
are not a second API. They keep slow rendering, durable waits, and provider
retries out of the interactive web process.

## RPC and authorization contract

Start with four procedure types:

| Procedure               | Caller                             | Authority                                                 |
| ----------------------- | ---------------------------------- | --------------------------------------------------------- |
| `publicProcedure`       | Health and explicit public actions | No tenant data                                            |
| `sessionProcedure`      | Signed-in person                   | User session only                                         |
| `organizationProcedure` | Signed-in member                   | Active organization plus named role permission            |
| `apiKeyProcedure`       | Customer service or CI             | Better Auth organization API key plus named product scope |

The initial router modules are `organization`, `brandKit`, `release`, `source`,
`upload`, `artifact`, `connection`, and `distribution`. Every input is Zod
validated. The server resolves organization identity from the session, key, or
verified connection; an input `organizationId` can select an already
authorized record, but never grants access.

Use Better Auth's organization-owned API-key configuration. Generate the raw
value once, show it once, and keep only Better Auth-managed key material.
Record product scopes in controlled metadata and limit machine actions to:

```text
release:create, source:write, asset:write, upload:sign, artifact:read
```

Human members perform approval, destination changes, publishing, membership,
credential, billing, and key-management actions. Never turn an API key into a
mock user session.

## Tenant and brand rules

The Better Auth organization ID is the one tenant ID. Every Screenshot Studio
business record has `organizationId`; every query filters it. API keys also
resolve to this same organization.

The brand kit is a compact versioned JSON definition plus referenced private
logo assets. A published version is immutable. Every artifact stores the exact
brand-kit and template version used. Store a licensed CSS font-family token,
not a font binary, in the MVP. A company can add a new version when its brand
changes; it cannot silently restyle approved material.

## Intake and media contract

All sources create `SourceMaterial` attached to one `Release`. The server uses
one transaction to write source state, audit evidence, and an outbox event.
The worker receives IDs and rechecks the current state before work begins.

For uploads, use a short-lived, object-specific R2 PUT URL. Validate membership
or key scope, type, quota, and requested size before signing. A worker then
checks object existence, size, checksum, magic bytes, and safe decode before
marking it ready. R2 paths use the organization and release prefix from RFC 006. Source media stays private.

GitHub and GitLab adapters verify their signatures before parsing JSON. A
generic changelog webhook uses a per-connection signing secret, timestamp,
nonce, and bounded replay window. All three deduplicate by trusted external
event ID plus content hash inside the organization.

## Product lifecycle

```text
INTAKE_PENDING -> READY -> DRAFTING -> REVIEW_REQUIRED
REVIEW_REQUIRED -> APPROVED -> SCHEDULED -> ACCEPTED_BY_PROVIDER
                                  -> FAILED | CANCELLED
```

An edit or regeneration makes a new artifact revision. Approval applies only
to that revision. Scheduling rechecks approval, destination capability, and
member access immediately before the Postiz handoff.

## Developer workflow

Do not make a new developer learn a custom platform. Use the existing Next.js
project, the Better Auth generator, Prisma, Trigger.dev CLI, Docker, and the
PlanetScale CLI. The future commands are:

```text
npm run dev                    # Next.js editor, auth, and tRPC
npx auth@latest generate       # after Better Auth plugin/schema changes
npx prisma migrate dev         # development PlanetScale branch
npx trigger.dev@latest dev     # receive and inspect background work
docker compose --profile postiz up -d  # optional scheduler integration fixture
```

The PlanetScale production release uses the reviewed migration file and a
separate production application step. PlanetScale Postgres branches are
isolated and do not automatically merge schema changes. The deployment run
records the branch, migration, operator, and result.

The repository-local skills make this workflow repeatable:

| Skill                          | Use                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `$add-tenant-rpc-feature`      | Add a safe tenant model, tRPC action, API-key scope, or middleware change                                          |
| `$add-release-intake`          | Add a webhook, changelog source, direct upload, capture source, or generation trigger                              |
| `$add-request-middleware`      | Add request IDs, origin policy, rate limits, route matching, or other shared request controls                      |
| `$add-tenant-schema`           | Add an organization-safe Prisma model, index, lifecycle, or migration                                              |
| `$add-background-task`         | Add a Trigger.dev task, queue, outbox event, retry policy, or task telemetry                                       |
| `$add-brand-kit-capability`    | Add versioned brand tokens, logo assets, templates, or artifact validation                                         |
| `$add-scheduler-provider`      | Add Postiz, Buffer, Post Bridge, or another social provider adapter safely                                         |
| `$deploy-platform-change`      | Change Docker, Fly, Helm, PlanetScale, Trigger.dev, GitHub Actions, or cloud secrets safely                        |
| `$verify-tenant-isolation`     | Test every organization boundary before release or after an access-control change                                  |
| `$test-release-workflow`       | Test one release from intake to approved provider receipt without a real customer post                             |
| `$add-e2e-flow`                | Add a Playwright user journey with real local dependencies, safe downstream mocks, or Testcontainers when required |
| `$review-artifact-policy`      | Review source accuracy, brand, accessibility, channel rules, and approval requirements                             |
| `$analyze-release-performance` | Analyze tenant-scoped publication and product-outcome data when it is available                                    |

This follows the `.agents/skills` project convention used by current Prisma
tooling, so Codex and other coding agents can discover the same instructions.
OpenAI documents skills as reusable Codex workflows and recommends composable
CLIs for repeated work. See [Codex use cases](https://developers.openai.com/codex/use-cases?category=engineering&task_type=workflow),
[Prisma Next](https://github.com/prisma/prisma-next), and [Create Better T
Stack](https://www.better-t-stack.dev/docs). The latter is a useful scaffold
reference for a new project, but should not replace this existing editor.

## Build order

1. Add Better Auth, organization RBAC, organization API keys, Prisma models,
   tRPC context and four procedure types. Prove isolation first.
2. Add brand-kit versioning, manual Markdown release creation, upload intents,
   source material processing, and one private R2 path.
3. Add GitHub, GitLab, and generic signed webhook adapters that call the same
   intake service as tRPC.
4. Add one artifact-pack request, the default four artifacts, provenance UI,
   approval, and Trigger.dev outbox dispatch.
5. Add Postiz connection, destination selection, scheduling, provider receipt,
   and reconciliation. Add Buffer and Post Bridge only after this path works.

## Acceptance criteria

- A new user can create an organization, create a brand-kit version, ingest a
  manual release with an image, and see reviewable branded drafts.
- GitHub, GitLab, generic webhook, and API-key requests create at most one
  source item when replayed and cannot select another organization.
- An API key can sign and complete an authorized R2 upload but cannot publish,
  manage people, create keys, or read another tenant's data.
- Every draft and scheduled post links to source, asset, brand kit, template,
  approval, actor, job run, and provider receipt.
- A delayed worker does not publish after a withdrawal, cancellation, member
  removal, key revocation, or connection disablement.
- The standalone Docker image still serves editor, auth, tRPC, webhooks, and
  `/api/health` as a non-root user.
- A new developer can use the documented tools and project skills to
  add a tenant RPC action without bypassing organization isolation or the
  migration procedure.
