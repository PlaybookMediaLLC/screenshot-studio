# RFC 020: Postiz Publishing Abstraction

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 019
**Owners:** Engineering

## Decision

Keep Postiz as the social infrastructure. Do not build direct Twitter,
LinkedIn, or Instagram integrations. Hide Postiz behind one application-owned
abstraction so it stays replaceable.

## Design

The application-facing contract:

```ts
schedulePost({
  workspaceId,
  postId,
  channel,
  scheduledAt,
})
```

The application decides how Postiz is invoked. The agent must not know which
provider exists underneath.

Account connection uses the Postiz OAuth 2.0 integration for multi-tenant
products. Users connect Postiz once. We operate their connected social
accounts without collecting their Postiz API keys.

Existing scheduled-post infrastructure (workers, retries, cancellation,
recovery) carries over unchanged.

## Exit criterion

An `approved` post schedules through the abstraction, publishes at the
scheduled time, and stores a `Publication` record. Cancellation before
publish works.

## Out of scope

- Performance ingestion. RFC 027 covers analytics.
- Any direct social-network API integration.
