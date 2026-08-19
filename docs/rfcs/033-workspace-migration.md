# RFC 033: Monorepo Workspace Migration

**Status:** Deferred
**Date:** 2026-08-19
**Depends on:** none
**Owners:** Engineering

## Decision

Do not migrate to npm workspaces yet. Keep the single-package layout and
enforce module boundaries with `server-only` guards and barrel exports.

Revisit when a second deployable artifact exists. That condition, not
elapsed time or repository size, is what changes the answer.

## Context

The question arose while building the email package
([customer email and release broadcast](../email-and-broadcast.md)). The
reference implementation reviewed for that work, Midday, uses a workspace
layout with `packages/email`, `packages/jobs`, and `packages/db`
consumed by four applications.

Copying that structure is tempting, because the surface benefit of a
clean `@screenshot-studio/email` import is visible immediately while the
costs are not.

## Analysis

### What a workspace would cost

Measured against the repository as it stands: 450 TypeScript files, 205
of which import through the `@/` alias, 74 runtime dependencies, one
Dockerfile producing a Next.js standalone build, one Helm chart, and
eight CI workflows.

| Work | Estimate | Risk |
| --- | --- | --- |
| Root manifest with workspaces, plus a build orchestrator | 2 hours | Low |
| Split `lib/` into packages with manifests and tsconfigs | 1 day | Medium |
| Rewrite 205 `@/` import sites to package specifiers | 4 hours | Medium |
| Workspace-aware Docker install and standalone tracing | Half day | **High** |
| Prisma generation from a package, consumed by app and jobs | 3 hours | **High** |
| CI, Helm chart, compose, Playwright, Trigger.dev config | 4 hours | Medium |
| Resolution breakage discovered after the mechanical work | 1 day | High |

Two items carry most of the risk.

**Standalone output tracing.** `next.config.ts` sets
`output: 'standalone'`, and the Dockerfile copies `.next/standalone` into
the runtime image. Tracing has to follow symlinked workspace packages and
include their transitive dependencies. When it gets this wrong the build
succeeds and the container fails at runtime on a missing module, so the
failure surfaces late and in production-shaped environments.

**Prisma client generation.** The client is generated into
`node_modules/@prisma/client` and imported by both the application and
the Trigger.dev tasks. Moving generation into a package means both
consumers must resolve the same generated client, and a hoisting
difference produces two client instances with incompatible types.

### What a workspace would provide

| Benefit | Status today |
| --- | --- |
| Enforced module boundaries | Already enforced by `server-only`, which caught three real violations during the email work |
| Stable public surface | Already provided by the `lib/email` barrel export |
| Independent versioning | Not applicable; nothing is published |
| Parallel builds and caching | Not applicable; one application to build |
| Independent deployment | Not applicable; one deployable artifact |

Every proposed package boundary would serve exactly one consumer.

### Why the comparison misleads

Midday runs `apps/dashboard`, `apps/api`, `apps/website`, and a desktop
client. Its `packages/email` genuinely serves four consumers, so the
workspace tooling is load-bearing rather than decorative.

Screenshot Studio deploys one Next.js application. The same structure
would carry the full tooling cost against a single consumer.

## Trigger for revisiting

Migrate when any of the following becomes true:

1. **The Trigger.dev worker is extracted into its own deployable.** It
   already imports `lib/tenant` and `lib/email`, so it is the closest
   candidate and would immediately give shared code a second consumer.
2. **A separate marketing site or documentation site is added**, sharing
   brand components or templates with the application.
3. **An API service is split out** for partner or webhook traffic with a
   different scaling profile from the web application.

Absent one of these, the migration adds tooling without changing what the
codebase can do.

## Migration order, when triggered

Sequenced so the highest-risk work happens first, while the change is
still cheap to abandon.

1. Prove Docker and Prisma on a throwaway branch with one trivial
   package. If standalone tracing and client generation cannot be made to
   work, stop here rather than after moving code.
2. Add workspaces and an orchestrator, keeping all source in the app
   package.
3. Extract packages one at a time, beginning with `lib/email`, which has
   the fewest inbound dependencies. Keep the `@/` alias working alongside
   package specifiers so the rewrite is incremental rather than atomic.
4. Rewrite imports per package, verifying the build after each.
5. Update CI, the Helm chart, and Playwright once the layout is stable.

## Interim practice

Until then, keep boundaries explicit without workspace tooling:

- Mark server-only modules with `server-only`. It is a real guard: it
  caught three violations during the email work, where pure logic had
  been placed behind a server-only import and was unreachable from tests.
- Give each cohesive area a barrel export, as `lib/email/index.ts` does,
  so callers do not reach into internal modules.
- Keep pure logic free of server-only imports, so it stays testable
  without a running application.

These give most of the boundary discipline a workspace enforces, at no
tooling cost.
