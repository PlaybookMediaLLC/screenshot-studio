# RFC 030: Approval Policies

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 019 and RFC 029
**Owners:** Product, Engineering, and Security

## Decision

Let workspaces define which content the AI may publish automatically and
which content requires human approval. The existing RBAC, audit, and
compliance infrastructure becomes genuine product differentiation here.

## Design

Example policy:

```text
AI may automatically publish:
✓ educational posts
✓ previously approved templates

AI must request approval:
✓ product announcements
✓ claims containing metrics
✓ pricing
✓ competitor references
✓ customer names
```

Details:

- Policies are workspace-scoped objects, editable only by admins, and
  versioned in the audit log (RFC 003).
- Policy evaluation runs server-side on post content and metadata before any
  transition to `scheduled`. The agent cannot bypass it.
- Content classification (announcement, metric claim, competitor reference,
  customer name) is a deterministic check first, with an LLM check as backup.
  Any uncertain classification routes to review.
- The default policy for every workspace requires approval for everything.

## Exit criterion

An educational post publishes without a human touch. A post naming a
competitor stops at `ready_for_review`, and the audit log shows the policy
decision for both.

## Out of scope

- Full autopilot mode. RFC 031 defines the autonomy levels built on these
  policies.
