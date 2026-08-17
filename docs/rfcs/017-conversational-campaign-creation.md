# RFC 017: Conversational Campaign Creation

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 016
**Owners:** Product and Engineering

## Decision

Add the conversational layer on top of the tool surface. The user states an
intent. The agent plans and calls tools. The resulting campaign appears
beside the conversation as a structured object, not as chat text.

## Design

Example input:

> We just shipped recurring invoices. Market it.

Expected agent plan:

```text
getProduct()
     ↓
getBrand()
     ↓
identify feature
     ↓
listProductSurfaces()
     ↓
generateContentAngles()
     ↓
createCampaign()
     ↓
createCreative()
     ↓
generatePost()
     ↓
requestApproval()
```

Expected agent response style:

> I found your recurring invoices screen and created three campaign angles.
> I recommend leading with "stop recreating the same invoice every month."

The campaign renders in the workspace panel (RFC 018), not inline in chat.

## Requirements

- The conversation stores tool calls and results for review.
- A failed tool call surfaces as a visible, retryable step.
- The agent asks one clarifying question when the feature is ambiguous.
  Otherwise it proceeds.

## Exit criterion

A one-sentence request produces a reviewable draft campaign, with the
reasoning steps visible.

## Out of scope

- Proactive suggestions. RFC 031 covers Copilot mode.
- Publishing from chat. Approval (RFC 019) gates all publishing.
