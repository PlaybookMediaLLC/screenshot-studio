# Website security audit — 25 October 2026

## Scope

Reviewed Shots from `develop` commit `5521874c3eb7e8640f4a09135f21bc1598f0774b`:
the Next.js application and API adapters, Go product/social services, collaboration
server, npm workspace and integration lockfiles, Go modules, and deployment
configuration. The checkout was updated from its older starting commit before
changes were made. Passive HEAD requests to `https://shots.playbookmedia.io/`,
`/sign-in`, and `/api/health` verified the existing production response headers.

This was a source review, dependency scan, and local regression/integration audit.
It did not include authenticated production testing, infrastructure account/IAM
inspection, a historical secret scan, or load testing the live service. Changes
require deployment through the normal `develop` → `main` release process.

## Findings and changes

| Finding | Severity | Evidence and resolution |
| --- | --- | --- |
| Vulnerable runtime dependencies | Critical/high | npm reported critical Next.js and protobufjs advisories and high findings in image/PDF processing, parsing, validation, and SCIM dependencies. Updated Next.js to 16.4.3, PDF.js to 6.4.299, Sharp to 0.35.5, compatible Better Auth packages to 1.6.33, and affected transitive packages. Updated AWS Go SDK eventstream/S3 and gRPC to patched releases. See the SCIM exception below. |
| Image proxy escaped its URL allowlist | High | `/api/image-proxy` validated only the initial hostname, then used automatic redirects and returned arbitrary upstream content types without a size limit. Every hop now requires an exact allowed HTTPS origin, public pinned DNS results, no URL credentials, a 10 MiB body limit, and a supported raster-image MIME type. Responses use `nosniff`, a sandbox CSP, and private/no-store caching. |
| Legacy SCIM providers without an organization | High, mitigated | The retained compatible SCIM release has a vendor advisory for providers without owner/organization binding. The Go auth store now requires an organization for creation and rejects clearing it; every read/update/delete/count also excludes NULL or empty organizations, independently of caller-supplied OR filters. Existing organization-only creation, owner checks, fresh-session/2FA checks and enterprise entitlement gates remain in place. |
| Cross-origin cookie-authenticated writes | Medium | Platform REST routes, tRPC, and editor utilities did not check the submitting browser's origin. They now reject untrusted or opaque origins and suspicious Fetch Metadata on unsafe cookie-authenticated requests. Explicit configured origins are supported; API-key clients and signed, cookie-free webhooks keep their existing authentication. Better Auth retains its own origin/callback checks. |
| Unbounded request buffering | Medium | JSON, raw webhook text, vendor handlers, and multipart exports could buffer a body before validation. Actual streamed bytes are now capped, including requests with missing or dishonest Content-Length. The standard limit is 32 MiB; the existing 30-slide review contract explicitly allows 256 MiB. Platform routes return 413 without invoking their mutation handler. Raw webhook text is preserved. |
| Incomplete special-address blocking | Medium | Go guards accepted IPv6 transition ranges capable of embedding private IPv4 destinations and several reserved ranges. They now share a public-address policy. The JavaScript guard also rejects short IPv6 hextets such as `2::1`, scoped addresses, and additional special ranges. Regression tests retain ordinary public IPv4/IPv6 access. |
| Slow outbound responses could evade timeouts | Medium | The Node transport used an idle socket timeout. Responses sending occasional bytes could remain open indefinitely, and DNS lookups had no deadline. DNS and all redirects now share a deadline; the HTTP request uses an absolute abort deadline that also covers reading the response body. |
| Missing framing and HTTPS persistence headers | Medium/low | Production HEAD responses lacked CSP frame-ancestors, X-Frame-Options, and HSTS. Added same-origin framing protection, `object-src 'none'`, `base-uri 'self'`, and production-only HSTS without extending it to subdomains. This is a targeted CSP, not a complete script-source policy. |
| Export resource use and error disclosure | Low/medium | Image export now bounds multipart input and decoded pixels (64 million) and returns a generic processing error instead of underlying image-library details. |

## Dependency results

Counts below are npm's affected-package counts, including transitive parent
packages; they are not distinct exploitable vulnerabilities.

| Dependency tree | Before | After |
| --- | --- | --- |
| Main npm workspace | 38 (2 critical, 15 high, 16 moderate, 5 low) | 1 high advisory: SCIM, mitigated below |
| Raycast integration | 2 low | 0 |
| Zapier integration | 2 high | 0 |
| Go called vulnerable symbols | AWS EventStream `GO-2026-5764` and gRPC `GO-2026-6348` | 0 reachable vulnerabilities; no affected imported packages |

The remaining npm advisory is
[GHSA-j8v8-g9cx-5qf4](https://github.com/advisories/GHSA-j8v8-g9cx-5qf4)
in `@better-auth/scim@1.6.33`. Stable SCIM 1.7 replaces the provisioning model and
removes the existing client/management API, so a direct upgrade is incompatible.
The backend restriction closes the affected non-organization-provider path,
including historical rows. Tests insert legacy rows directly into PostgreSQL and
verify they remain unreadable and unchanged through the auth store. The raw npm
finding is deliberately retained, not hidden. A future migration to the SCIM 1.7
data model is still required to remove the vulnerable vendor package itself.

Go also reports `GO-2026-5932` at module level because `golang.org/x/crypto`
contains deprecated OpenPGP packages. Shots does not import those packages; the
symbol/package scan finds no affected usage. Removing all of `x/crypto` would
remove unrelated required cryptography.

KaTeX, Sharp, js-yaml, esbuild and Zapier's form-data use explicit overrides for
upstream pins. The existing ESLint rules were retained to avoid introducing an
unrelated React lint migration. Vitest's optional peer range is constrained to
the compatible Better Auth 1.6 range.

## Verification

- Regression tests cover blocked origins, redirect escapes, private DNS,
  special IP encodings, MIME/size checks, byte-counted request limits, unchanged
  webhook text, slow-response/DNS deadlines, and SCIM organization restrictions.
- The complete JavaScript test suite and workspace tests were run, along with
  Raycast/Zapier tests and Raycast typechecking.
- All 18 server/browser tests passed, including workspace creation, membership,
  invitations, image rendering, screenshot capture, and media ingestion.
- `go test ./...` passed. An isolated migrated PostgreSQL database was used for
  the auth-store, product, and publishing integration suites; all passed.
- ESLint with zero allowed warnings, formatting, Go vet, API/database-boundary
  checks, and all 18 RFC checks passed.
  Security-related Go packages also passed the race detector.
- The production webpack build and TypeScript checks passed. The build emitted
  non-fatal MediaPipe dynamic-dependency and webpack chunk-cycle warnings.
- All nine collaboration tests passed with Redis enabled, including reconnect
  and workspace authorization behavior.
- Local smoke checks against the built production server verified CSP,
  same-origin framing, HSTS, and nosniff on the landing redirect, sign-in page,
  and health endpoint. Cross-origin cookie writes to REST, tRPC, and export
  returned 403; a 33 MiB tRPC request returned 413.
- The npm lockfile passed a clean-install dry run. The one remaining npm
  advisory and the Go module-only notice are documented above.

The review also traced tenant membership/role checks, API-key scope enforcement,
revocable private asset grants, share-token expiry/revocation, signed webhook
verification, OAuth state checks, escaped article rendering, and collaboration
access rechecks. No additional confirmed exploit was found in those reviewed
paths. A targeted tracked-file credential scan found only test/redaction
fixtures; it does not establish that repository history contains no secrets.
