# RFC 016: AI SDK and Typed Marketing Tools

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 015
**Owners:** Engineering and Security

## Decision

Add the Vercel AI SDK now — after the primitives work. The agent decides
which working capability to call. It is not responsible for making anything
work. Expose about ten domain tools. Give the agent domain capabilities, not
infrastructure capabilities.

## Design

Initial tool surface:

```ts
tools = {
  getProduct,
  getBrand,
  listProductSurfaces,

  createCampaign,
  generateContentAngles,

  captureProductSurface,

  createCreative,
  createDemo,

  generatePost,

  requestApproval,
}
```

Deliberately absent:

```text
executeSQL
browseAnything
writeDatabaseRow
arbitraryHTTP
runJavaScript
```

Rules for every tool:

1. The tool takes a `workspaceId`.
2. The tool validates input with a Zod schema.
3. The tool calls the same domain services as the UI (RFC 010).
4. The tool writes an audit log entry (RFC 003).

The model decides **what to do**. The application decides **how it is done
safely**. The agent never touches the database or the canvas directly.

Agent runs execute as durable Trigger.dev tasks, which support AI SDK
conversations with streaming, multi-step execution, and human approval of
tool calls.

## Exit criterion

The agent completes "create a launch campaign for feature X" end to end using
only the exposed tools, and every step appears in the audit log.

## Out of scope

- Chat UX. RFC 017 covers the conversational layer.
- Autonomy. The agent acts only on direct requests.
