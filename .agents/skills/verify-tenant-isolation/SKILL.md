---
name: verify-tenant-isolation
description: Verify Screenshot Studio tenant isolation end to end. Use before releasing or changing authentication, tRPC procedures, API keys, middleware, Prisma models, R2 access, webhooks, Trigger.dev tasks, provider connections, or support access.
---

# Verify Tenant Isolation

Read RFC 002, RFC 003, RFC 004, RFC 005, RFC 006, and RFC 007. Treat every
organization boundary as a security control, not a UI convention.

## Test setup

1. Use a non-production environment with organization A and organization B.
   Create different members, API keys, releases, assets, connections, and
   scheduled posts for each organization.
2. Use safe fixtures only. Do not create or change customer accounts, provider
   connections, or production media.
3. Record a request ID for each assertion and clean up test data through normal
   retention-safe flows.

## Required attack matrix

- Change an ID in every session-based tRPC action from organization A to B.
- Use an organization-A API key for B's release, upload intent, artifact, and
  provider connection.
- Request an R2 signed URL for an object under B's prefix with A's session or
  key.
- Replay a GitHub, GitLab, generic, or provider webhook against the wrong
  connection and organization.
- Submit cross-tenant IDs to Trigger.dev payload entry points and provider
  reconciliation callbacks.
- Test removed membership, revoked key, expired support grant, disabled
  connection, and withdrawn approval after work was queued.

## Expected result

- Return a safe forbidden or not-found response without exposing B's metadata.
- Create no record, object, task, publication, or audit event under B.
- Keep audit evidence in A for rejected machine actions only when it contains
  no sensitive B identifier.
- Stop the task before any external side effect.

## Evidence

Report the tested boundaries, request IDs, assertions, failures, and gaps.
Block the release on any cross-organization read, write, signed URL, or social
delivery.
