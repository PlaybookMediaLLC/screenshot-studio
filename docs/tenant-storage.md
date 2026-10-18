# Tenant asset storage

Tenant asset bytes live in a private S3-compatible bucket: Cloudflare R2 in
production, RustFS locally. The Go backend is the only component that holds
storage credentials. The web app never signs or reads objects on its own
authority; it asks the backend for a short-lived signed URL.

## Shape

| Piece | Where |
| --- | --- |
| Object bytes | Private R2 bucket (RustFS on `localhost:9003` in Compose) |
| Object metadata | `asset` rows in the product database, owned by the backend |
| Signing | `services/internal/media` in the Go backend |
| Web access | `lib/storage/client.ts` and `lib/tenant/assets.ts`, through the SDK |

There is no separate storage metadata database or Storage API service. The
`asset` row is the canonical record: its organization, object key, media
type, size, hash, and status (`PENDING`, `UPLOADED`, `DELETED`).

## Flow

1. The web calls `signAssetUpload`. The backend checks the caller's role and
   the workspace storage quota, inserts a `PENDING` asset, and returns a PUT
   URL for its object key.
2. The browser uploads directly to the bucket.
3. The web calls `completeAssetUpload`. The backend confirms the object
   exists, optionally checks its SHA-256, and marks the asset `UPLOADED`.
4. Browser downloads call `signAssetDownload`. Rendering and AI tools call
   `readAsset` through the SDK so the backend reads the object and returns its
   bytes. Both operations require an `UPLOADED` asset in the caller's workspace.

Object keys are namespaced `org/<organizationId>/...`, and the backend
refuses a key outside the caller's organization. Signed URLs expire after
two minutes, long enough to finish one transfer and no longer.

## Configuration

The backend and worker read `R2_ENDPOINT`, `R2_BUCKET_NAME`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`, and optionally
`R2_BROWSER_ENDPOINT` (the host the browser should use when it differs from
the backend's endpoint, as with RustFS in Compose). The DigitalOcean spec
renderer strips every storage and database key from the web service, and
`test/web-database-boundary.test.ts` keeps database clients out of web code.

The bucket's CORS policy must allow `PUT` and `GET` from the web origin, with
the `Content-Type` and `If-None-Match` request headers. Upload URLs are signed
write-once (`If-None-Match: *`): a replayed PUT gets `412` and cannot replace
bytes the backend already verified. The Compose RustFS initializer applies the
policy locally; set it on the R2 bucket in production.

## Public editor assets

Tenant bytes never share a bucket with public files. In production the tenant
bucket is `screenshot-studio`; it has no custom domain and no public
development URL. The editor's backgrounds and overlays live in a separate
public bucket, `screenshot-studio-public-assets`, served at
`https://shots-assets.oppulence.io` (`NEXT_PUBLIC_R2_PUBLIC_URL`). The web
fetches them through its same-origin `/r2-assets/` rewrite, and production
images drop the local copies (see the `Dockerfile`).

Object keys follow `getR2PublicUrl` in `lib/r2.ts`:

| R2 key | Repository source |
| --- | --- |
| `backgrounds/<dir>/…` for `mac`, `mesh`, `paper`, `pattern`, `radiant`, `raycast`, `demo` | `public/<dir>/…` |
| `assets/…` | `public/assets/…` |
| `overlays/shadow/…` | `public/overlay-shadow/…` |
| `overlays/arrow/…` | `public/overlay/…`, plus `arrow-1.svg`…`arrow-10.svg` from `public/arrow/` before commit `234f902` |

Upload a new editor asset to the public bucket under its key before shipping
code that references it. Never attach a public domain to the tenant bucket.

## Verification

- `services/internal/media`: `TestPrivateMediaSigningAndObjectExistence`
  covers signing, and `TestS3StoreRoundTrip` exercises a real bucket when
  `MEDIA_TEST_ENDPOINT` and the `R2_*` variables are set.
- `services/internal/product`: the asset integration tests cover upload
  completion, duplicate completion, generated images, outbox events, and
  cross-tenant key rejection against a disposable database.
- `test/e2e/tenant-assets.spec.ts` runs the browser path on the local stack.
