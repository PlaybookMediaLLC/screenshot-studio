# RFC 017: Conversational Campaign Creation

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 016
**Owners:** Product and Engineering

## Decision

Add the conversational layer on top of the tool surface. The user states an
intent. The agent plans and calls tools. The resulting campaign appears
beside the conversation as a structured object, not as chat text.

The conversation is a view of an agent run. It is not the campaign, it is not
the state, and losing it loses nothing but history.

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

## Goals

- One sentence produces a reviewable draft campaign.
- Reasoning is visible and every step is inspectable.
- A closed tab, a refresh, or a crash never loses work.
- Ambiguity is resolved by asking once, not by guessing silently.

## Non-goals

- Proactive suggestions. RFC 031 covers Copilot mode.
- Publishing from chat. Approval (RFC 019) gates all publishing.
- Multi-user simultaneous conversation in one thread.
- Chat as a general assistant. The agent has ten tools and no others.

## State model

```ts
Conversation {
  id, workspaceId, createdByUserId
  title                 // derived from the first message
  campaignId?           // the primary artifact under discussion
  status                // active | archived
  createdAt, updatedAt
}

Message {
  id, conversationId, workspaceId
  role                  // user | assistant | system
  content
  agentRunId?           // the run this message started or reported
  createdAt
}
```

The tool trace lives on `AgentRunStep` from RFC 016, not on messages. A
message may reference a run; the run owns the steps. This keeps the
conversation thin and prevents the chat log from becoming a second, divergent
record of what happened.

The campaign is never stored in the conversation. Chat manipulates structured
objects; that is the commitment from RFC 014 and it is what makes the campaign
survive the conversation.

## Turn lifecycle

```text
User sends a message
   ↓
Persist the message immediately
   ↓
Create an AgentRun (RFC 016) linked to the message
   ↓
Stream: model text, tool calls, tool results
   ↓
Each step persists to AgentRunStep as it completes
   ↓
Run reaches a terminal state
   ↓
Persist the assistant message with the run reference
   ↓
The workspace panel refreshes from the database, not from the stream
```

The workspace panel reading from the database rather than the stream is the
important detail. The stream is a progress indicator. The database is truth. A
user who reloads mid-run sees the same campaign state as one who watched the
stream.

## Resumability

Every turn is durable:

- The user message persists before the run starts, so it is never lost.
- Steps persist as they complete, so a crash loses at most one step.
- A disconnected client reconnects to the run by ID and resumes streaming from
  the last persisted step.
- A closed tab does not cancel the run. The user returns to a completed
  campaign.
- A worker crash resumes through Trigger.dev from the last persisted step.

Reconnection is by run ID and is authorized per request. A user cannot attach
to a run in another workspace.

## Failed and retryable steps

A failed tool call surfaces as a visible, retryable step. The rules:

- The failure is shown in place with a human-readable reason, not a stack
  trace or an error code.
- Retryable failures, meaning transient ones like a render timeout, offer a
  retry that re-runs only that step against the existing run context.
- Non-retryable failures, such as a missing product profile, offer the
  corrective action instead, such as opening onboarding.
- A retried step appends to the trace rather than replacing it, so the history
  shows the failure and the recovery.
- The agent continues after a non-fatal tool failure and reports what it could
  not do, rather than abandoning the turn.

A partially successful turn is normal and must read as a normal outcome:
"I created three posts. The demo video failed to render; you can retry it."

## Clarification

The agent asks one clarifying question when the feature is ambiguous.
Otherwise it proceeds. Precisely:

| Situation                                    | Behavior                                  |
| -------------------------------------------- | ----------------------------------------- |
| Feature matches one surface                  | Proceed                                   |
| Feature matches several surfaces             | Ask once, listing them                    |
| Feature matches nothing                      | Proceed, state the fallback explicitly    |
| No product profile                           | Do not ask; route to onboarding           |
| Channels unspecified                         | Use workspace defaults, state the choice  |
| Ambiguity remains after one question         | Choose, state the choice, proceed         |

At most one clarifying question per turn. Two questions before any output makes
the product feel like a form with extra steps, and the founder can correct a
stated assumption faster than they can answer a question.

Every assumption is stated in the response. "I assumed X" is recoverable;
silently assuming X is not.

## Confirmation semantics

The agent never asks for confirmation of an action it is allowed to take. It
creates drafts and reports them. This follows from RFC 016: no tool has an
irreversible effect, so there is nothing to confirm.

The one confirmation point is approval, which is a human decision in the
workspace panel, not a chat message. "Yes, approve them" typed into chat does
not approve anything. Approval requires the session-authenticated action
defined in RFC 019, because that is what makes the audit trail meaningful.

This is a deliberate friction. Making approval clickable-in-chat would make the
approval record indistinguishable from agent output.

## Context limits

The model context is bounded and prioritized:

1. System prompt and tool definitions, always.
2. Product profile, brand profile, and ICP summaries, always.
3. The current campaign's structure, always when one exists.
4. Recent turns in full.
5. Older turns as a rolling summary.

When the budget is exceeded, older turns summarize first and product context
is never dropped, because an agent that forgets the product produces confidently
wrong copy.

Conversations have a soft length limit. Past it, the UI offers to start a fresh
conversation carrying the campaign forward, since the campaign is a database
object and moves for free.

## Authorization

- Creating a conversation requires `workspace:read`.
- Sending a message requires the permissions of the tools the run may call; a
  `viewer` may converse and receives read-only results.
- Reading a conversation requires `workspace:read`; conversations are visible
  to the workspace, not private to their author, because marketing is a team
  activity and a hidden conversation that created a campaign is confusing.
- Deleting a conversation requires being its author or an admin, and never
  deletes the campaign it produced.

Every message and run is workspace-scoped. Cross-workspace access returns
`404`.

## Safety in the UI

The conversation renders untrusted content: page text, PR bodies, and research
results appear in tool results.

- All content renders as text. Markdown rendering is limited to a safe subset
  with no raw HTML, no scripts, and no auto-loaded remote images.
- Tool results are visually labeled by trust level, so a founder can see that a
  quoted claim came from a crawled page rather than from the product profile.
- Links from untrusted content are not auto-linked.
- Content flagged as containing injection patterns is marked in the trace.

## Observability

- Turns per conversation, and campaigns per conversation.
- Time to first token and time to a usable campaign.
- Clarifying-question rate, which should be low.
- Retry rate on failed steps, by tool.
- Share of turns ending partially successful.
- Abandonment: conversations producing a campaign that is never approved.

Time to a usable campaign is the product metric. Time to first token measures
whether streaming feels responsive; it does not measure whether the product
works.

## Failure behavior

| Failure                       | User-visible behavior                                |
| ----------------------------- | ---------------------------------------------------- |
| Model provider outage         | "I could not reach the model. Retry." Message kept.  |
| Stream disconnects            | Reconnect and resume; no work lost                   |
| Run exceeds budget            | Partial campaign shown with what was completed       |
| Run hits the step cap         | Same, with an offer to continue in a new turn        |
| Tool fails transiently        | Inline failure with a retry action                   |
| Tool fails permanently        | Inline failure with the corrective action            |
| Campaign deleted mid-run      | Run ends; the conversation reports it                |
| User cancels                  | Run stops after the current tool call; artifacts kept |

## Acceptance criteria

1. A one-sentence request produces a reviewable draft campaign, with the
   reasoning steps visible.
2. The campaign appears in the workspace panel, not as chat text.
3. Reloading mid-run shows the same state as staying connected.
4. Closing the tab does not cancel the run; the campaign exists on return.
5. A failed render appears as a retryable step, and retrying completes it
   without re-running the whole turn.
6. A permanently failed step offers a corrective action rather than a retry.
7. An ambiguous feature produces exactly one clarifying question.
8. An unmatched feature proceeds with a stated fallback.
9. Typing "approve them" approves nothing.
10. A `viewer` can converse and creates nothing.
11. A conversation from another workspace returns `404`.
12. A tool result containing HTML renders as text.
13. A long conversation trims old turns while retaining product context.
14. Every turn's tool calls are inspectable after the fact.
15. Cancelling mid-turn keeps everything already created.

## Rollout

1. Ship the conversation model and a non-streaming turn against read-only
   tools. Prove durability before adding streaming complexity.
2. Add streaming and reconnection.
3. Add generation tools; run a usability pass on clarification behavior.
4. Add step retry.
5. Ship alongside the RFC 018 workspace panel; the panel must exist first,
   since a campaign that renders only in chat trains the wrong mental model.

## Out of scope

- Proactive suggestions. RFC 031 covers Copilot mode.
- Publishing from chat. Approval (RFC 019) gates all publishing.
