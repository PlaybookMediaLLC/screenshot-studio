---
name: add-tenant-rpc-feature
description: Add or change a Screenshot Studio tenant-facing tRPC capability. Use for a new API procedure, authorization rule, tenant database model, API-key action, brand-kit action, release action, or middleware that reads or writes organization data.
---

# Add Tenant RPC Feature

Keep the API in the existing Next.js application. Read RFC 002, RFC 003, RFC
006, and RFC 007 before changing a tenant capability.

## Workflow

1. Name the user action and data owner. Reuse a current domain service when it
   exists; do not add a second route for the same action.
2. Choose the narrowest procedure: `public`, authenticated session,
   organization, or organization API-key procedure. Never take
   `organizationId` from input as authorization.
3. Validate all input with Zod. Resolve the active organization on the server.
   Filter every database read and write by that organization ID.
4. For a schema change, add the organization ID, list index, lifecycle state,
   audit action, and idempotency rule before generating a Prisma migration.
5. Write an append-only audit event and outbox event in the same transaction
   when the action starts durable work.
6. Return IDs and safe metadata. Do not return database secrets, raw API keys,
   provider tokens, cookies, or durable R2 URLs.

## API-key rules

- Require one explicit product scope per machine action.
- Apply key rate and byte quotas before signing an upload or creating work.
- Treat API-key actions as `service` actors in audit records.
- Do not let a machine key publish, alter membership, manage credentials, or
  create another key.

## Verification

- Test the happy path and an organization-A to organization-B ID attack.
- Test missing session, missing permission, and missing API-key scope.
- Run Prisma generation and the focused tests, then `npm run lint`.
- Record any PlanetScale migration application in the release evidence.
