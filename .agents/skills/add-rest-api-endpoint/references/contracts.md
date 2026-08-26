# REST API Contract Reference

## Paths and methods

Place public platform routes under `app/api/v1`. Use plural kebab-case resource names. Model actions as subresources only when ordinary CRUD semantics are misleading, such as `/{assetId}/complete` or `/{assetId}/download-url`.

Do not expose `app/api/internal`, webhook receivers, Better Auth handlers, or tRPC transport routes through the public OpenAPI document.

## Authentication

Use `createTenantJsonRoute` for workspace JSON operations. Declare both the API-key scope and browser-session permission. The helper resolves `TenantContext` and converts thrown authorization, validation, workflow, storage, and dependency failures through the shared route-error boundary.

Never authorize from an input workspace ID. Pass the resolved tenant context to domain services and scope every read or write with `tenant.organizationId`.

## Parsing

Validate all untrusted data before executing the domain service:

- body through an owning Zod object schema;
- query through `Object.fromEntries(request.nextUrl.searchParams)` and a bounded schema;
- path parameters after awaiting the Next.js 16 `params` promise;
- idempotency keys with a 128-character maximum;
- content type and byte limits before signing uploads.

## Responses

Use the default framework response for `200` JSON. Supply `respond` for `201`, `202`, `204`, idempotent replay, binary responses, or custom headers.

Return opaque product IDs and public metadata. Prefer signed short-lived URLs over storage locations. Ensure error responses do not include stack traces, provider payloads, SQL errors, or authorization internals.

## OpenAPI and Scalar

Add every public method to `lib/api/openapi.ts` with:

- a unique camelCase `operationId`;
- summary and selection-quality description;
- `Workspace` or owning resource tag;
- `security: [{ bearerAuth: [] }]` for authenticated operations;
- path, query, and header parameters;
- request body and response schemas;
- all expected failure statuses.

Reuse component schemas and parameters. Keep the raw document at `/openapi.json`; Scalar at `/api-reference` consumes it without separate configuration.

## Compatibility

Treat additive fields as compatible within v1. Treat removed fields, stricter accepted values, changed meanings, and altered status behavior as breaking. Preserve old routes as adapters during migration. Add `Deprecation`, `Sunset`, and `Link` headers before removal.

## Testing

Cover schema boundaries and handler-to-domain wiring in unit tests. Exercise the built Next.js server for route existence, content type, authentication failure, and Scalar visibility. Verify tenant isolation with real organization A and B records whenever an identifier selects stored data.
