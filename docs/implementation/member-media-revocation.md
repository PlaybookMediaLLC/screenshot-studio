# Member media revocation

Workspace downloads now recheck the issuing principal for every request. Previously,
the application authorized a member and returned a two-minute R2 bearer URL. That
URL could still return private bytes after the member was removed. Downloads now
use the existing asset content route with a two-minute encrypted grant. The Go
backend resolves the original session, membership or API-key scope before reading
storage and again before returning the bytes.

## Contract and boundaries

- The grant binds the immutable asset ID, organization and original principal.
  Session IDs and storage keys are not exposed. AES-GCM uses a purpose-specific
  key derived from the existing backend service secret; grants cannot substitute
  another asset, principal or workspace.
- Removal, logout, expiry, bans and workspace switches invalidate a session grant.
  API-key downloads require the current `artifact:read` scope; disabled keys and
  removed scopes are refused before storage access. Asset status and ownership
  are checked again after a potentially slow storage read.
- The download remains a short-lived bearer link: a recipient can use it while
  its original authority is valid. A normal content URL without a grant requires
  the caller's own current tenant access. This does not replace explicit public
  review/share-link authorization or revoke bytes already downloaded.
- The web facade forwards the opaque grant in an internal authenticated POST body.
  The Go service's credential cannot replace the principal inside the grant.
  The existing SDK carries the byte stream and media/range headers back to the
  browser. No browser download redirects to object storage.
- Responses use private/no-store, no-referrer and nosniff headers. The content
  response also has a sandbox CSP. Byte-range reads, including 206 and 416, are
  preserved. Go's range-error handler required an explicit wrapper to retain the
  private cache policy on errors.
- Uploads remain write-once direct storage uploads. Provider delivery still uses
  the existing delivery signer. The storage reader now supports the existing
  100 MiB PDF intake limit. Go buffers the bounded object before its final access
  check; the web forwards the response stream without buffering it again.

No migration, copied membership record, new environment variable or new secret is
introduced. `PUBLISHING_SERVICE_TOKEN` must contain at least 32 characters, and
`BETTER_AUTH_URL` supplies the application origin. Missing/invalid grant settings
fail closed. API startup only installs the object store when storage is configured,
so a typed nil storage client cannot produce a misleading download link.

## Rollout and rollback

Deploy the new SDK/web content reader first. Its ordinary authenticated reads use
the existing Go `/bytes` endpoint. Then update every Go API replica to issue and
redeem the new grants. An old web content handler redirects through the signing
endpoint and cannot consume the new links, so deploying the new signer first
would create a redirect loop.

Wait two minutes after the final old API replica stops issuing R2 URLs before
claiming immediate revocation for all outstanding links. Previously issued R2
URLs cannot be recalled by this change. All replicas must share the existing
service secret; changing it invalidates outstanding grants.

For rollback, retain the new web reader, or restore the old API signing behavior
before restoring the old web handler. Restoring direct R2 links also restores
their removal gap; do not describe that rollback as preserving immediate media
revocation. Public review links retain their separate existing authorization.

## Executed evidence

The new PostgreSQL tests cover removed membership, expired/logged-out sessions,
bans, workspace switches, tampering, expiry, wrong assets/workspaces, key rotation,
API-key revocation/scope changes and removal during the storage read. Denied grants
return no bytes and do not call the storage signer. All tests in product, httpapi
and media passed; full Go vet passed. SDK, route and database-boundary tests passed
30 checks. SDK build, API generation, format, full lint, TypeScript, production
build and all 17 RFC checks passed. The full JavaScript suite passed 941 root,
9 collaboration tests with real Redis and no skips, and 21 editor tests.

Three browser scenarios passed across completed runs against the production build,
real PostgreSQL sessions and a dedicated RustFS bucket:

- Member removal: a real uploaded image is readable through the member's grant,
  including ranges, then replaying the exact URL from a cookie-free browser returns
  401 immediately after removal. Stale direct media, audit, notification inbox and
  notification count reads also return 401. The owner can still read the asset,
  which remains UPLOADED. The member list reload shows one owner. This flow passed
  in 14.2 seconds; its populated screenshot was inspected.
- Existing asset isolation: foreign-workspace content/signing/completion/deletion
  is refused, upload replay cannot replace bytes, and normal deletion is retained.
  The unchanged focused rerun passed in 26.9 seconds.
- Expiry: after the original 122-second wait, the old grant is refused at the
  application authorization boundary. The scenario passed in 2.1 minutes.

The successful anonymous read used request ID
`ebb81744-378c-4d31-ab48-c36422031dd1`; its post-removal replay returned 401 with
`3a564f69-553c-4d3c-9a7d-0714df9ea0d0`. Audit reads changed from 200
(`9cb6e436-f252-4e74-8a53-0964e30c815f`) to 401
(`2d6c12cf-3c4d-429c-a436-fd5cd9bf5855`). Local evidence is retained in
`.context/media-access-requests.json`, `media-browser*.log`,
`media-isolation-diagnostic.log` and `member-media-revoked.png`.

Initial failures are retained: the new test omitted the audit endpoint's required
organization parameter, and the old asset test twice encountered a long backend
authentication delay followed by upload-signing 503. The parameter was corrected;
the asset test's assertions and setup were unchanged on its passing diagnostic run.
Database sampling during that successful run showed no lock wait, so it does not
explain the earlier slowdowns. CodeRabbit reported zero findings across 20 files;
the later nil-store guard and test request/evidence adjustments were reviewed locally.
The production build retains the existing MediaPipe and circular-chunk warnings.
Full `make e2e` was not run; focused flows preserved the approved X fixture.

T12/T16 remain in progress for provisioning, queued notifications and delayed-work
authorization. These checks do not establish the complete removal contract or
completion of the full 60-criterion assignment.

## MCP signer follow-up — 2026-10-22

The subsequent full Go run found that MCP's separate product-service graph had
not been given the new download-grant configuration. The social API now uses the
same service secret and application origin as the product API: existing
`TENANT_PUBLISHING_SERVICE_TOKEN` / `TENANT_BETTER_AUTH_URL` in the combined
process, and the unprefixed settings when standalone. No new credential or
broader environment forwarding was added. The service secret must still contain
at least 32 characters; `dev/studio` already generates a suitable random value.

The MCP integration fixture is configured the same way. A new protocol test
requests a grant through the actual MCP server, redeems it through a separate
product configuration, disables the issuing API key, and checks that the same
grant is refused. Existing all-tool tenant isolation remains unchanged. The first
new revocation test addressed the key's display name instead of its ID; it now
resolves the verified key ID before revocation, retaining the denial assertion.

Include the social API/MCP process when updating all grant issuers, after the web
reader is deployed. This follow-up changes no grant format, expiration, storage
boundary or public contract.

The corrected full serial Go run passed all 125 tested packages, including the
unchanged all-tool isolation test and the new cross-service revocation test.
Full vet passed. CodeRabbit's final review included these startup/tests/docs and
reported zero findings. Evidence is retained in
`.context/notification-authority-{go-all-final,vet-final,review-final}.log`.
