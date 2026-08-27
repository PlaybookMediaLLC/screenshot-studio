# RFC 016: AI SDK and Typed Marketing Tools

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 004, RFC 010 through RFC 015
**Owners:** Engineering and Security

## Decision

Add the Vercel AI SDK now — after the primitives work. The agent decides
which working capability to call. It is not responsible for making anything
work. Expose about ten domain tools. Give the agent domain capabilities, not
infrastructure capabilities.

The security model is the design. The agent is untrusted code running inside a
tenant boundary it cannot name, holding no credentials, reaching no network,
and unable to approve or publish anything.

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

## The workspaceId rule, stated precisely

"Every tool takes a `workspaceId`" is a schema convention, not an
authorization mechanism, and treating it as one would be the single most
dangerous mistake in this RFC.

The binding rule: **the workspace is injected by the runtime from the
authenticated principal that started the run. It is never read from model
output.** If a tool schema exposes a workspace field at all, the executor
overwrites it before dispatch and logs a security event when the model supplied
a different value. A model that emits another tenant's ID achieves nothing and
raises an alarm.

The agent therefore cannot express a cross-tenant request. There is no
serialization of "act on workspace B" that survives the executor.

## Tool contracts

Each tool declares an explicit capability record, and the executor enforces
every field:

```ts
Tool {
  name
  description             // model-facing, behavioral, no data
  inputSchema             // Zod, strict, no workspace field
  effect                  // read | write | render | external | approval-request
  permission              // required session permission
  apiKeyScope?            // when a key-authenticated run may call it
  quota?                  // metered capability
  maxCallsPerRun
  timeout
  redactions              // fields never written to the trace
}
```

### The surface

| Tool                   | Effect | Permission        | Max/run | Notes                              |
| ---------------------- | ------ | ----------------- | ------- | ---------------------------------- |
| `getProduct`           | read   | `workspace:read`  | 5       | Cached per run                     |
| `getBrand`             | read   | `workspace:read`  | 5       | Cached per run                     |
| `listProductSurfaces`  | read   | `workspace:read`  | 10      | Deterministic lookup (RFC 013)     |
| `generateContentAngles`| write  | `release:create`  | 3       | Wraps the RFC 015 step             |
| `createCampaign`       | write  | `release:create`  | 2       | Always `DRAFT`                     |
| `captureProductSurface`| render | `release:create`  | 10      | Metered; SSRF-guarded              |
| `createCreative`       | render | `artifact:edit`   | 20      | Metered; RFC 010                   |
| `createDemo`           | render | `artifact:edit`   | 3       | Metered; video, async              |
| `generatePost`         | write  | `release:create`  | 30      | Prohibited-term filtered           |
| `requestApproval`      | approval-request | `release:create` | 2 | Submits to review; never approves |

Ten tools. Every one maps to a capability that already works because RFC 010
through RFC 015 built it. The agent composes; it does not implement.

### What is structurally impossible

| Absent capability          | Why                                                     |
| -------------------------- | ------------------------------------------------------- |
| Approve content            | No tool has the `approval` effect; RFC 019 requires a session user |
| Schedule or publish        | No tool touches `ScheduledPost`                         |
| Delete anything            | No destructive tool exists                               |
| Read another workspace     | Workspace is runtime-injected                            |
| Fetch an arbitrary URL     | Capture accepts a surface slug, never a URL              |
| Modify brand or policy     | `brand:manage` is not granted to any tool                |
| Change its own permissions | Permissions are resolved per run from the principal      |
| Spend without limit        | Per-run call caps and token budgets                      |

`captureProductSurface` taking a slug rather than a URL is deliberate. A URL
parameter would make the agent an SSRF vector regardless of downstream guards,
because the model can be persuaded to emit any string. A slug can only resolve
to a surface the workspace already registered and already validated.

## Execution model

Agent runs execute as durable Trigger.dev tasks, which support AI SDK
conversations with streaming, multi-step execution, and human approval of
tool calls.

```text
Request (session or API key)
   ↓
Resolve principal → workspace, permissions, entitlements, budget
   ↓
Create AgentRun row (queued)
   ↓
Trigger.dev task
   ↓
┌─────────────────────────────────────────┐
│ loop, bounded by maxSteps               │
│   model call → tool calls               │
│   executor: authorize, validate,        │
│     inject workspace, meter, dispatch   │
│   persist step to AgentRunStep          │
└─────────────────────────────────────────┘
   ↓
requestApproval → durable wait (RFC 019)
   ↓
Run completes; campaign exists in DRAFT
```

`maxSteps` is 20. Reaching it ends the run with whatever was created, reported
as incomplete. An agent looping without progress is a cost problem, and an
unbounded loop against a paid model is the most likely way to lose real money
on a single bug.

Loop detection ends a run early when the same tool is called with identical
arguments three times consecutively.

### Run state

```ts
AgentRun {
  id, workspaceId, principalRef
  status          // queued | running | awaiting_approval | completed | failed | cancelled | budget_exhausted
  intent          // the user's request
  model, promptVersion
  stepCount, toolCallCount
  tokensIn, tokensOut, estimatedCostCents
  campaignId?     // the primary artifact, once created
  error
  startedAt, completedAt, deadlineAt
}

AgentRunStep {
  id, runId, index
  kind            // model | tool
  toolName?, input?, output?, errorCode?
  tokensIn, tokensOut, durationMs
  createdAt
}
```

Steps are the reviewable trace. RFC 017 renders them, and support uses them to
answer "what did the agent actually do".

## Authorization

Tool authorization is the intersection of three things:

1. The permissions of the principal that started the run.
2. The tool's declared permission.
3. The workspace's entitlement for any metered capability.

An agent started by a `viewer` can read and can generate nothing. An agent
started by a `creator` can generate and cannot approve, because no tool
approves. An agent started by an API key can call only tools declaring a
matching scope, which excludes `requestApproval` if the workspace requires
human-initiated review.

Authorization is re-evaluated per tool call, not once per run. A run in
progress when a member is demoted loses access at the next call.

Permissions never escalate mid-run. There is no elevation path, no service
principal fallback, and no "the agent needs this to finish" exception.

## Prompt injection

The agent reads untrusted content: product page text from RFC 012, PR titles
and bodies from RFC 022, and research results from RFC 026. All of it can
contain instructions.

Defenses in order of importance:

1. **Capability limits.** The dominant defense. A fully successful injection
   still cannot approve, publish, delete, read another tenant, or reach the
   network, because those tools do not exist. The blast radius is a bad draft
   campaign that a human reviews.
2. **Data and instruction separation.** Untrusted content is delivered in
   delimited data blocks with an explicit statement that content inside is data
   and never instruction. Tool results are labeled by trust level.
3. **Schema-constrained outputs.** Tool arguments are strictly validated. An
   injection cannot invent a parameter or a tool.
4. **Runtime-injected identity.** Workspace and permissions never come from the
   context window.
5. **Human gate.** Everything terminates at `DRAFT` and RFC 019 approval.
6. **Detection.** Content matching known injection patterns is flagged, the
   affected output is marked low-trust, and a security event is recorded. The
   run continues, because blocking on pattern matching produces false positives
   and would not be the real defense anyway.

The honest position: we assume injection will sometimes succeed. The design
ensures success is not worth much.

## Cost control

| Control                    | Value                                       |
| -------------------------- | ------------------------------------------- |
| Tokens per run             | Plan-scoped cap                             |
| Cost ceiling per run       | Hard cents cap; exceeding ends the run      |
| Steps per run              | 20                                          |
| Tool calls per tool        | Per-tool cap in the table above             |
| Concurrent runs/workspace  | 1 free, 3 pro, 10 business                  |
| Runs per hour              | Plan-scoped                                 |
| Wall clock per run         | 15 minutes excluding approval waits         |

Token usage accumulates per step and is checked before each model call. A run
that would exceed its budget ends as `budget_exhausted` with its artifacts
intact. Cost is attributed to the workspace and reported in usage.

Context is trimmed rather than allowed to grow unbounded: full recent steps,
summarized older ones, with product and brand context always retained since
that is what keeps output grounded.

## Tracing and observability

Every run records the full model and tool trace. Traces are workspace-scoped
and readable with `workspace:read`. Tool inputs and outputs are stored with
declared redactions applied, and no trace contains a credential, an
`Authorization` header, a signed URL, or a secret reference.

Metrics:

- Runs by terminal status, and the `budget_exhausted` share.
- Steps and tool calls per run.
- Tool error rate by tool and by code.
- Tokens and cost per run at p50, p95, and max.
- Injection-pattern detections.
- Cross-tenant workspace mismatches, which must be zero and page when not.
- Downstream: share of agent-created campaigns reaching approval, and edit
  distance on their copy.

The metric that actually matters is the share of agent-created campaigns that
reach approval without edits. Run counts, token cost, and tool error rates
measure whether the agent is functioning; only that share measures whether it
is useful. An agent with a perfect success rate whose every output gets
rewritten has produced expensive drafts, not marketing.

Cross-tenant workspace mismatches are the exception to that framing. They must
be zero, and a single one is an incident rather than a metric to trend.

## Failure behavior

| Failure                        | Behavior                                                |
| ------------------------------ | ------------------------------------------------------- |
| Tool input fails validation    | Error returned to the model; it may retry once          |
| Tool call unauthorized         | Error returned; permission never widened; audited       |
| Tool exceeds its per-run cap   | Error returned naming the cap                            |
| Tool times out                 | Error returned; the run continues                       |
| Model provider outage          | Retried with backoff, then the run fails                |
| Model returns malformed calls  | Retried twice, then the run fails                       |
| Budget exceeded                | Run ends `budget_exhausted`; artifacts kept             |
| Step cap reached               | Run ends incomplete; artifacts kept                     |
| Loop detected                  | Run ends early; artifacts kept                          |
| Worker crash                   | Trigger.dev resumes from the last persisted step        |

Tool errors are returned to the model as structured results rather than
thrown, so the agent can adapt. Authorization errors are the exception: they
are returned and audited, and repeated authorization failures end the run.

Runs are cancellable at any point. Cancellation stops after the in-flight tool
call, keeps created artifacts, and marks the run `cancelled`.

## Acceptance criteria

1. The agent completes "create a launch campaign for feature X" end to end
   using only the exposed tools, and every step appears in the audit log.
2. A model emitting another workspace's ID has no effect and raises a security
   event.
3. No tool call sequence produces an approved, scheduled, or published post.
4. A run started by a `viewer` performs reads and produces nothing.
5. A run started by an API key cannot call session-only tools.
6. Demoting a member mid-run causes the next tool call to fail authorization.
7. A run reaching 20 steps ends incomplete with its artifacts intact.
8. A run exceeding its token budget ends `budget_exhausted` with artifacts.
9. Three identical consecutive tool calls end the run.
10. A product page containing injected instructions changes no control flow
    and produces a flagged, low-trust output.
11. `captureProductSurface` cannot be induced to fetch an arbitrary URL.
12. Every tool call writes an audit entry with the actor, run ID, and outcome.
13. No trace, log, or audit entry contains a credential.
14. A killed worker resumes without repeating a completed tool call.
15. Generated copy containing a prohibited term does not persist as approved.

## Rollout

1. Ship the executor with read-only tools. Verify tracing, budgets, and
   workspace injection with no write path at all.
2. Add generation tools behind a flag for internal workspaces.
3. Add render tools; verify metering against real cost.
4. Add `requestApproval` and the durable wait.
5. Run a red-team pass: injection corpus, cross-tenant attempts, budget
   exhaustion, and loop induction. Gate the general rollout on it.
6. Enable per workspace, with a workspace-level agent kill switch.

The kill switch is operational, not a feature. Disabling the agent for one
workspace or globally must not require a deploy.

## Out of scope

- Chat UX. RFC 017 covers the conversational layer.
- Autonomy. The agent acts only on direct requests.
- External research tools. RFC 026 adds them after the loop is proven.
