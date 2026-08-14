---
name: review-artifact-policy
description: Review Screenshot Studio generated or edited release artifacts for source-grounded claims, brand compliance, accessibility, channel limits, approval rules, and safe publication. Use before changing generation, templates, brand rules, artifact validation, approval UX, or publication policy.
---

# Review Artifact Policy

Read RFC 003, RFC 005, RFC 006, and RFC 007. The goal is to make a founder's
draft safer and clearer, not to approve it automatically.

## Review order

1. Verify that product claims, availability, links, and CTA trace to an
   approved release fact or founder-provided source.
2. Verify the pinned brand-kit and template versions, approved names, required
   legal language, colors, logo, typography tokens, and prohibited terms.
3. Check destination capability: media type, aspect ratio, caption length,
   alt text, link handling, and scheduled time.
4. Check that the artifact exposes no private R2 object, source screenshot,
   token, cookie, or signed URL.
5. Produce `pass`, `warn`, or `block` with the source rule, artifact revision,
   and one concrete remediation.

## Non-negotiable rules

- A policy pass does not replace human approval.
- Do not turn missing evidence into a factual claim.
- Do not mutate an approved revision. Create a new revision for each fix.
- Treat accessibility and required legal copy as block or explicit approver
  waiver according to organization policy.

## Evidence

Keep review metadata concise, tenant-scoped, and redacted. Store rules and
policy versions so a later audit can explain the result.
