---
name: add-request-middleware
description: Add or change Screenshot Studio request middleware. Use for request IDs, origin policy, route protection hints, rate limits, API-key extraction, webhook preflight, security headers, redirects, or Next.js matcher changes.
---

# Add Request Middleware

Read RFC 003 and RFC 007. Middleware is for small, shared request controls;
tenant authorization stays in tRPC procedures and domain services.

## Choose the smallest boundary

- Use the Next.js request layer for request IDs, secure headers, origin checks,
  simple redirects, and low-cost route matching.
- Use tRPC procedures or route handlers when a decision needs a session,
  organization membership, a database read, or an API-key scope.
- Keep raw-body webhook signature checks in the webhook adapter. Do not parse,
  alter, or consume that body in global middleware.
- Do not create an additional server or duplicate a check already enforced by
  Better Auth, Fly, R2, or the provider.

## Required controls

1. Classify public, authenticated, API-key, and webhook routes explicitly.
2. Add or preserve a request ID and return a safe error shape.
3. Allow only configured trusted origins for browser state-changing requests.
4. Exclude static files, health checks, and vendor callbacks unless the control
   is essential to them.
5. Never derive organization authority from a URL, header, cookie name, or
   request body. Pass transport facts only; the server resolves the tenant.

## Rate limiting

- Apply limits at the narrowest available key: API key, user, IP, connection,
  or destination.
- Use a safe default when identity is absent. Do not trust forwarded headers
  unless the Fly proxy contract is configured.
- Return `429`, a retry hint, and a request ID. Do not leak account state.

## Verification

- Test matcher coverage, preflight behavior, unauthenticated access, bad
  origin, rate-limit rejection, and request-ID propagation.
- Confirm health, R2 upload completion, Better Auth callbacks, and signed
  GitHub/GitLab webhooks still work.
