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
| Signing | `server/internal/media` in the Go backend |
| Web access | `lib/storage/client.ts` and `lib/tenant/assets.ts`, through the SDK |

There is no separate storage metadata database or Storage API service. The
`asset` row is the canonical record: its organization, object key, media
type, size, hash, status (`PENDING`, `UPLOADED`, `FAILED`, `DELETED`), the
dimensions and video length and codecs read at completion, and the multipart
upload a large file is still being sent in (`uploadId`).

## Flow

1. The web calls `signAssetUpload`. The backend checks the caller's role and
   the workspace storage quota under a per-workspace lock, inserts a
   `PENDING` asset, and returns a PUT URL for its object key. A browser file
   over 16 MiB goes through `signAssetUploadInParts` instead: the backend
   starts a multipart upload and the browser asks `signAssetUploadParts` for
   one 15-minute URL per 16 MiB part, and for the parts storage already
   holds when it resumes.
2. The browser uploads directly to the bucket.
3. The web calls `completeAssetUpload`. For a multipart upload the backend
   lists the stored parts and joins them once each is whole. It then streams
   the object once: exact length, SHA-256 (of the whole file, or of each part
   as the browser read it), content signature, and image or video container,
   and marks the asset `UPLOADED` or, for bytes that are not what they claim,
   `FAILED`.
4. Browser downloads call `signAssetDownload`. Rendering and AI tools call
   `readAsset` through the SDK so the backend reads the object and returns its
   bytes. Both operations require an `UPLOADED` asset in the caller's workspace.

Object keys are namespaced `org/<organizationId>/...`, and the backend
refuses a key outside the caller's organization. Signed URLs expire after
two minutes, long enough to start one transfer and no longer; part URLs last
15 minutes. Publishing signs a 24-hour read only when a post is due.

The hourly `asset-cleanup` job retires a `PENDING` reservation after 24
hours, a `FAILED` one after an hour, and a provider derivative nothing has
used for 30 days, through the `asset.deleted` outbox, which also aborts an
unfinished multipart upload's parts. Neither cleanup nor deletion touches an
asset a draft, an unfinished post or an open bulk batch still references
(`platform_asset_in_use_v1`). See [media scheduling](media-scheduling.md).

## Configuration

The backend and worker read `R2_ENDPOINT`, `R2_BUCKET_NAME`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`, and optionally
`R2_BROWSER_ENDPOINT` (the host the browser should use when it differs from
the backend's endpoint, as with RustFS in Compose). The DigitalOcean spec
renderer strips every storage and database key from the web service, and
`test/web-database-boundary.test.ts` keeps database clients out of web code.

The bucket's CORS policy must allow `PUT` and `GET` from the web origin, with
the `Content-Type` and `If-None-Match` request headers. Part uploads need
nothing more: the backend, not the browser, reads each part's `ETag`. Keep the
bucket's default lifecycle rule that aborts unfinished multipart uploads
after 7 days. Upload URLs are signed
write-once (`If-None-Match: *`): a replayed PUT gets `412` and cannot replace
bytes the backend already verified. The Compose RustFS initializer applies the
policy locally. The production policy is versioned in
`infra/storage/tenant-cors.json`; it permits the current web origin and the
previous domain, without making any object public. With an existing authorized
Cloudflare CLI session, review the current policy and apply it using:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> npx wrangler@4 r2 bucket cors list screenshot-studio
CLOUDFLARE_ACCOUNT_ID=<account-id> npx wrangler@4 r2 bucket cors set screenshot-studio --file infra/storage/tenant-cors.json
```

Verify with `cors list` and save/reopen an image project through the browser.
A domain change must update this policy: a valid presigned URL still fails
browser preflight when the origin is absent. See the
[Cloudflare CORS guide](https://developers.cloudflare.com/r2/buckets/cors/).

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

- `server/internal/media`: `TestPrivateMediaSigningAndObjectExistence`
  covers signing, `TestMultipartUploadThroughSignedParts` sends parts through
  signed URLs to an in-process S3 implementation, and `TestLocalS3RoundTrip`
  exercises a local bucket when `PUBLISHING_TEST_LOCAL_OBJECT_STORE` and the
  `R2_*` variables are set.
- `server/internal/product`: `TestLargeUploadsGoInParts` (resume, missing and
  short parts, part digests, tenant scope), `TestConcurrentUploadsCannotExceedStorage`
  and `TestDeletingAnAssetKeepsMediaThatIsStillNeeded`.
- `server/internal/product`: the asset integration tests cover upload
  completion, duplicate completion, generated images, outbox events, and
  cross-tenant key rejection against a disposable database.
- `test/e2e/tenant-assets.spec.ts` runs the browser path on the local stack.
