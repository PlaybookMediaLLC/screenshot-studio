# RFC 019: Campaign Approval Workflow

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 014 and RFC 018
**Owners:** Product, Engineering, and Security

## Decision

Make post states explicit and gate all publishing on human approval. AI never
publishes without approval in this phase.

## Design

State machine:

```text
draft
  ↓
ready_for_review
  ↓
approved
  ↓
scheduled
  ↓
published
```

Plus side states:

```text
rejected
needs_changes
```

Rules:

- Only `approved` posts can move to `scheduled`.
- State transitions require the existing RBAC permissions and write audit log
  entries (RFC 003).
- Batch approval is the primary CTA: "Approve all 7 posts". Users must not
  approve every individual action.
- An agent run pauses at `requestApproval` and resumes on decision, using the
  durable human-in-the-loop support in Trigger.dev.

## Exit criterion

A campaign moves draft → review → approved → scheduled with one batch
approval, and every transition appears in the audit log.

## Out of scope

- Policy-based automatic approval. RFC 030 covers approval policies.
