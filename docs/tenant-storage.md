# Tenant asset storage

Tenant assets are uploaded and downloaded through a Supabase Storage API
service rather than by talking to object storage directly. The
application signs URLs through it, which keeps per-tenant object keys and
expiry policy in one place instead of spread across callers.

This document covers the deployed service and the adaptations required to
run it against a Postgres that Supabase does not manage.

## Shape

| Piece | Where |
| --- | --- |
| Storage API | Fly app `screenshot-studio-storage`, `iad` |
| Object bytes | Cloudflare R2 bucket `screenshot-studio`, via the S3 backend |
| Object metadata | `storage` database on the same PlanetScale cluster |
| Bucket | `tenant-assets`, private |

Object metadata lives in a separate database from tenant application
data, so storage bookkeeping and the product schema stay independent and
can be migrated on their own schedules.

The application reaches the service through `STORAGE_API_URL`,
`STORAGE_SERVICE_KEY`, and `STORAGE_BUCKET`. Without them,
`lib/storage/client.ts` raises `TenantStorageUnavailableError`, which
surfaces as a 503 rather than an unexplained server fault.

## Authentication

The service authorizes requests with an HS256 JWT signed by
`AUTH_JWT_SECRET`. The application holds a long-lived token carrying
`role: service_role`, which is what `STORAGE_SERVICE_KEY` contains.

The token is not a bearer credential for end users. Every application
request is already authorized against the tenant before it reaches
storage, and object keys are namespaced per organization, so the service
key never leaves the server.

## Running against a non-Supabase Postgres

Three adaptations were needed. Each failed loudly at startup, so any
future migration to another Postgres will hit the same three.

### The connection string cannot carry `sslrootcert=system`

PlanetScale's connection string ends with
`?sslmode=verify-full&sslrootcert=system`. Prisma understands `system` as
"use the platform trust store". `node-postgres`, which Storage uses,
treats the value as a file path and fails with
`ENOENT: no such file or directory, open 'system'`.

The service is given the same database with `sslmode=require` and no
`sslrootcert`, so TLS is still enforced.

### The Supabase roles must exist

Storage migrations `GRANT` to `anon`, `authenticated`, `service_role`,
and `supabase_storage_admin`. Those exist by default only on a
Supabase-managed cluster. Without them the migration run stops at
`s3-multipart-uploads` with `role "anon" does not exist`.

They are created explicitly with `NOLOGIN NOINHERIT`, since nothing
connects as them directly.

### The connection role must be a member of those roles

Storage issues `SET ROLE` per request, using the role named in the JWT. A
Postgres role may only assume a role it belongs to, and the PlanetScale
application role is not a superuser, so it must be granted membership:

```sql
GRANT anon, authenticated, service_role, supabase_storage_admin
  TO "<connection role>";
```

This failure is worth calling out because of how it presents. Storage
reports it as:

```
new row violates row-level security policy
```

The actual error, visible when the insert is reproduced directly against
the database, is:

```
permission denied to set role "service_role"
```

The row-level security wording sends the investigation toward policies
and `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`, none of which help.
Reproducing the statement outside the service is what surfaces the real
cause.

## Verification

`scripts/verify-tenant-storage.ts` exercises the full path against a live
service: sign an upload, PUT the bytes, complete the asset, sign a
download, read the bytes back, and confirm a second tenant can neither
complete nor download the asset.

It requires `DATABASE_URL` and the three `STORAGE_*` variables, and it
creates and removes its own fixtures.

```bash
npm run verify:storage
```

## Operational notes

Machines do not scale to zero. Signing runs in the request path of an
upload, so a cold start would be visible to a user waiting on a save.

Image transformation is disabled. It requires a separate `imgproxy`
service that is not deployed, and the application renders its own
imagery.

Upload limits mirror the tenant asset schema at 50 MB, so an oversized
upload is refused by the application before it reaches storage. Signed
URLs expire after 120 seconds, long enough to complete an upload and no
longer.
