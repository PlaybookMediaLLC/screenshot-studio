# RFC 018: Campaign Workspace

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 017
**Owners:** Product and Engineering

## Decision

Build a campaign workspace UI and make it more important than chat. AI
manipulates the workspace. The workspace is not merely the output of AI. This
is an architectural distinction, not a styling choice.

## Design

Layout:

```text
┌─────────────────────────────┬───────────────────┐
│ Campaign                    │ Copilot           │
│                             │                   │
│ Recurring Invoices Launch   │ "Make this more   │
│                             │ founder-focused." │
│ [X] [LinkedIn] [Instagram]  │                   │
│                             │                   │
│ ┌────────┐ ┌────────┐       │                   │
│ │ Asset  │ │ Asset  │       │                   │
│ └────────┘ └────────┘       │                   │
│                             │                   │
│ Monday                      │                   │
│ X post                      │                   │
│                             │                   │
│ Tuesday                     │                   │
│ LinkedIn                    │                   │
└─────────────────────────────┴───────────────────┘
```

Capabilities:

- View a campaign's angles, creatives, posts, and schedule in one place.
- Edit copy inline. Open any creative in the full editor.
- Regenerate one asset or one post without touching the rest.
- Address the copilot about the selected object ("make this more
  founder-focused").

The workspace reads and writes the structured objects from RFC 014. The
copilot manipulates the same objects through the tools from RFC 016.

## Exit criterion

A founder edits, regenerates, and rearranges a campaign entirely in the
workspace. Chat is optional at every step.

## Out of scope

- Calendar planning across campaigns. RFC 025 introduces content pillars and
  the weekly calendar.
