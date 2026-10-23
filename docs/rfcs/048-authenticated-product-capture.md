# RFC 048: Authenticated Product Capture

**Status:** Proposed — conditional supporting track
**Date:** 2026-10-23
**Owners:** Platform Engineering
**Depends on:** RFC 003, RFC 006, RFC 013, RFC 023, RFC 047
**Execution:** Conditional after verified evidence; not a prerequisite for manual pilot kits

## Decision

Add controlled capture of customer-approved private product screens only when
pilot evidence shows repeated uploads are a material bottleneck. A reviewed
upload remains a supported evidence source. This fills the explicit missing
authenticated-capture design in RFC 023 without creating a separate demo product.

## Existing foundation

The [Go capture client](../../services/internal/capture/capture.go) captures
public URLs. [Surface history](../../services/internal/product/surfaces.go)
records assets and capture origins; the
[deployment flow](../../services/internal/product/github_events.go) captures
registered surfaces. Reuse storage, lineage, rendering and Temporal. Do not
pass session secrets through the current public screenshot-provider API.

## Proposed design

Use an isolated browser worker for one workspace and capture run. A customer
administrator connects a dedicated, least-privilege demo/test account through
an explicit browser-session flow. Keep encrypted session material in
backend-controlled secret storage, referenced by an opaque credential ID.
Never put cookies, passwords or tokens in prompts, run summaries or artifacts.

Version each capture recipe with allowed product origins, exact navigation
steps, target screen, viewport, expected UI marker, permitted data set and
redaction requirements. Approving a recipe does not verify every future image.
Restrict workers to reviewed navigation and non-mutating UI actions. Do not
accept arbitrary agent-authored browser scripts. SSO/MFA completion, account
selection and reauthentication remain explicit human actions.

A job pins recipe, credential reference and source release/deployment identity.
Check current authorization at start and before storing results. Enforce public
network destination/redirect policies and block metadata/private-network
access by default; private-network capture requires a separately reviewed
network design. Isolate storage and browser state between runs and tenants.

Store capture time, environment, viewport, product revision when known, recipe
version, result asset hash and failure reason. Never infer a product commit
from time alone. Expired sessions, login screens and missing expected UI
markers fail explicitly; do not label a login-page image a successful feature
capture. Review redactions and content before admitting the image as evidence.

## Incremental delivery

1. Improve manual upload provenance and review using RFC 047.
2. Pilot one allowed origin and a dedicated demo account, on-demand only.
3. Add expiration, revocation, reauthentication and run cancellation.
4. Enable deployment-triggered recapture only for approved recipes after
   isolated-worker and live-provider checks pass in the pilot environment.

## Acceptance criteria

1. A pilot kit can still be completed using a reviewed upload when this track
   is disabled, unavailable or not economically justified.
2. One authorized private screen can be captured with pinned provenance and
   reviewed redactions; a login screen or missing UI marker is rejected.
3. Cross-tenant browser/session reuse, secret disclosure and redirect escapes
   are rejected in tests against controlled fixtures.
4. Credential revocation or workspace removal stops pending work and prevents
   new artifacts from being delivered; expired sessions request human renewal.
5. A failed retry does not overwrite the last reviewed image or its history;
   repeated successful attempts deduplicate by run/step receipt.
6. Non-approved origins or mutating actions are refused, and costs/timeouts
   are bounded independently of model output.

## Observability

Reviewed usable captures per attempted authorized capture is the primary
metric. Separate expired-session, wrong-screen, redaction and provider failures;
track operator time and cost against the upload baseline.

## Rollout and rollback

Enable one customer and origin at a time behind backend configuration. Disable
triggers and revoke session references to roll back; retain approved artifacts
under existing retention rules. No customer credential is required to approve
this design. Choose the browser provider during implementation based on
session isolation, secret handling, access policy and measured pilot cost.
