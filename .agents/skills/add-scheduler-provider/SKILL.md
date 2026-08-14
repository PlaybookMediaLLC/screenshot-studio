---
name: add-scheduler-provider
description: Add or change a Screenshot Studio social scheduling provider. Use for Postiz, Buffer, Post Bridge, a direct social network adapter, OAuth connection, destination discovery, media upload, scheduling, webhooks, reconciliation, or provider capability changes.
---

# Add Scheduler Provider

Read RFC 005, RFC 006, and RFC 007. Add one provider adapter behind the shared
connection, destination, distribution, and publication-attempt model.

## Capability-first design

1. Document required OAuth scopes, token refresh behavior, supported media,
   caption limits, destination types, schedule semantics, idempotency support,
   callbacks, and rate limits from the provider's current primary docs.
2. Represent capability gaps explicitly. Do not silently resize, truncate,
   downgrade, or publish unsupported content.
3. Store tokens only through a secret reference. Database rows contain provider
   IDs, safe labels, capabilities, status, and redacted error codes.
4. Upload selected R2 media to the provider only after approval. Never give a
   provider a permanent private R2 URL.

## Publishing contract

- Recheck the artifact revision, approval, tenant, connection, destination,
  and provider capability before handoff.
- Use a provider idempotency reference when supported; otherwise persist one
  internal reference and reconcile before retrying.
- Map remote states into the shared lifecycle. Save each attempt and the remote
  post ID or safe failure code.
- Treat an inbound provider callback as untrusted until signature and expected
  connection identity are verified.

## Verification

- Test expired credentials, revoked access, unsupported media, 429, timeout,
  duplicate schedule requests, callback replay, and tenant isolation.
- Run a harmless real connection test before enabling a provider for customers.
