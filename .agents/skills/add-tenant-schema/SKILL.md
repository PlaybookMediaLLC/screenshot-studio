---
name: add-tenant-schema
description: Add or change a Screenshot Studio PlanetScale Prisma data model. Use for tenant tables, lifecycle state, indexes, relations, migrations, lineage, retention fields, idempotency records, audit records, R2 metadata, or schema review.
---

# Add Tenant Schema

Read RFC 002, RFC 003, RFC 004, RFC 005, and RFC 006. Make the smallest schema
change that represents a durable product fact.

## Modeling rules

1. Decide whether Better Auth or Screenshot Studio owns the record. Do not
   duplicate generated Better Auth tables or API-key key material.
2. Add `organizationId` to every Screenshot Studio business record, including
   an index for the tenant list or task lookup it supports.
3. Model lifecycle states, immutable revision lineage, external references,
   idempotency, and retention only where the product needs them.
4. Store R2 object keys and verified metadata, never media blobs, permanent
   URLs, OAuth tokens, browser secrets, or raw API keys.
5. Keep JSON compact, validated, and versioned. Do not hide authorization,
   user IDs, or queryable relationships inside JSON.

## Migration procedure

- Generate Better Auth Prisma models after plugin changes, then review the
  resulting schema with application changes as one migration.
- Test a normal Prisma migration on the PlanetScale development branch.
- Review the SQL, lock risk, backfill, rollback or forward-fix path, and
  cross-tenant query plan.
- Apply the reviewed migration separately to production. PlanetScale Postgres
  does not merge branch schemas through deploy requests.

## Verification

- Add organization-A to organization-B isolation tests and required indexes.
- Test lifecycle transitions, uniqueness, replay/idempotency, retention, and
  migration on an empty and representative development dataset.
- Run Prisma generation, focused tests, and `npm run lint`.
