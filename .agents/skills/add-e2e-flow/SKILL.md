---
name: add-e2e-flow
description: Add or change a Screenshot Studio Playwright end-to-end flow. Use for authenticated user journeys, tenant-sensitive features, browser interactions, downstream API integrations, release regressions, mocked external calls, or Testcontainers-backed dependency validation.
---

# Add End-to-End Flow

Read `e2e/README.md`, `e2e/framework/flow.ts`, and the changed feature's route,
server boundary, and data contract before writing a test. Read
`references/downstream-dependencies.md` when the flow crosses a downstream
boundary.

## Workflow

1. Define one user outcome, its persisted result, and the required negative
   path. Include tenant or permission boundaries when the feature has them.
2. Add a `*.spec.ts` file under `e2e/`. Import `test`, `expect`, and
   `configureE2EFlow` from `e2e/framework/flow`.
3. Use `configureE2EFlow` for setup, cleanup, and failure hooks. Use the
   provided unique identity; do not use a shared account or production data.
4. Assert visible user results and durable effects. Do not assert only a 200
   response or internal implementation detail.
5. Run `make e2e`. New specs run automatically in Compose CI and the Kind
   parity workflow. Preserve normal Playwright traces and screenshots on error.

## Test boundaries

- Use the running Compose services for Postgres, Redis, MinIO, and Storage.
  They are real local dependencies, not mocks.
- Mock browser-originated third-party calls with
  `e2e/framework/downstream.ts`. Assert the request method, body, and number
  of calls as well as the visible result.
- For server-originated calls, inject a test-only downstream base URL before
  the app starts. A browser route cannot intercept a server request.
- Use Testcontainers for a dependency whose actual protocol or lifecycle is
  part of the contract and is not already supplied by Compose. Do not mock
  authentication, authorization, tenant isolation, database constraints, or
  object-storage key behavior.

## Required coverage

- Cover success, authorization denial, invalid input, replay or duplicate
  request, and one downstream failure when applicable.
- Verify idempotency before retrying an external side effect.
- Use provider sandboxes, local fixtures, or mocks. Never send a test action to
  a customer account or production destination.
