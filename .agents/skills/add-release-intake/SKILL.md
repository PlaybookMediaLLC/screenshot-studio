---
name: add-release-intake
description: Add or change a Screenshot Studio release source. Use for GitHub or GitLab webhooks, changelog APIs, manual Markdown, direct media uploads, external API-key intake, Steel captures, source normalization, or artifact generation triggers.
---

# Add Release Intake

Read RFC 005, RFC 006, and RFC 007 before changing intake. Every new source
must normalize into `SourceMaterial` on exactly one tenant `Release`.

## Choose the boundary

- Use a thin Next.js route only for a vendor callback that needs a raw body,
  such as GitHub or GitLab. Verify the signature before JSON parsing.
- Use tenant tRPC procedures for manual Markdown, external API-key requests,
  upload intents, upload completion, and release operations.
- Keep adapters small. They validate transport facts, call one shared domain
  service, and return a safe acknowledgement. They never contain generation
  logic.

## Intake contract

1. Authenticate the session, organization API key, or vendor signature.
2. Resolve the organization from trusted connection configuration or the key;
   never from an unauthenticated payload.
3. Enforce an idempotency key and a content hash scoped to that organization.
4. Write the source, audit event, and outbox event in one transaction.
5. Send IDs only to Trigger.dev. The task re-reads state before processing.

## Upload rules

- Authorize and quota-check before issuing a short, single-object R2 PUT URL.
- Do not proxy large media through the Next.js process.
- Mark the asset pending until a worker verifies its object, checksum, type,
  size, and safe decode.
- Keep private source media out of public R2 prefixes and logs.

## Verification

- Replay the same webhook and confirm one release source is created.
- Test invalid signature, expired API key, wrong organization, unsupported
  media type, and cancelled release.
- Test that a generated artifact stays in review until a person approves it.
