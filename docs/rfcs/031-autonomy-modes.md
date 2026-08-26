# RFC 031: Autonomy Modes

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 029 and RFC 030
**Owners:** Product, Engineering, and Security

## Decision

Offer three explicit autonomy modes per workspace. Users choose their level.
The progression Manual → Copilot → Autopilot replaces any jump directly into
autonomy.

Mode is a gate on triggers and on automatic approval. It is never a gate on the
tool surface, and it never widens a role's permissions. A mode change cannot
grant a capability that RBAC and policy do not already permit.

## The modes

```text
Manual
Copilot
Autopilot
```

### Manual

AI creates things when asked. Nothing proactive. This is the behavior from
RFC 017.

### Copilot

AI proactively suggests things: detected PR launches (RFC 022), weekly plans
(RFC 029), and performance recommendations (RFC 028). Every suggestion waits
for a human decision.

### Autopilot

AI creates and schedules according to the workspace's approval policies
(RFC 030). Policy-permitted content publishes automatically. Everything else
queues for review.

## Capability matrix

The normative definition of each mode. Columns are capabilities; cells state
what the mode permits without a human in the loop.

| Capability                          | Manual            | Copilot           | Autopilot              |
| ----------------------------------- | ----------------- | ----------------- | ---------------------- |
| Read product, brand, surfaces       | on request        | on request        | on request             |
| Read performance                     | on request        | on request        | on request             |
| Generate copy and creatives         | on request        | on request        | on request             |
| Modify draft content                | on request        | on request        | on request             |
| Modify approved content             | never             | never             | never                  |
| Modify brand, profile, or policy    | never             | never             | never                  |
| Run on a GitHub trigger (RFC 022)   | no                | suggestion only   | suggestion only        |
| Run the weekly cycle (RFC 029)      | no                | plan to review    | plan to review         |
| Propose weight adjustments (RFC 028)| no                | proposal only     | may apply within bounds |
| Approve content                     | never             | never             | policy-permitted only  |
| Schedule content                    | never             | never             | policy-permitted only  |
| Publish content                     | never             | never             | policy-permitted only  |
| Cancel a scheduled post             | never             | never             | never                  |
| Delete anything                     | never             | never             | never                  |
| Connect or modify channels          | never             | never             | never                  |
| Change autonomy mode                | never             | never             | never                  |

Three rows hold across every mode and are the durable safety guarantees:

1. **Automation never modifies approved content.** RFC 014's content hash
   enforces it structurally.
2. **Automation never changes its own governance.** Mode, policy, brand, and
   channel connections are human-only in all modes.
3. **Automation never deletes or cancels.** Every autonomous action is additive
   and reversible by a human.

Autopilot's publishing rights are entirely delegated to RFC 030 policy. The
mode does not itself decide what may publish; it decides whether policy is
consulted at all. A workspace in Autopilot with a default policy behaves
identically to Copilot, which is the correct and safe outcome.

## Design

- The mode is one workspace setting, changeable by admins, audited on change.
- Mode gates which triggers run, not which tools exist. The tool surface and
  policy checks stay identical across modes.
- Downgrading a mode takes effect immediately and cancels pending autonomous
  schedules that policies no longer permit.

### Enforcement

Mode is checked server-side at three points, and nowhere else is it trusted:

1. **Trigger admission.** Before a scheduled or event-driven run starts, the
   mode is read and the trigger is dropped if the mode does not permit it.
   Manual admits no triggers at all.
2. **Automatic approval.** Before any policy-driven approval, the mode must be
   Autopilot. A Copilot workspace with a permissive policy still requires human
   approval.
3. **Adjustment application.** Before applying an RFC 028 weight adjustment
   automatically, the mode must be Autopilot.

Mode is never checked in the UI as an authorization mechanism, and never
checked once and cached across a long-running task. A run that starts in
Autopilot and continues after a downgrade re-checks before every gated action.

## Mode transitions

```text
Manual ←→ Copilot ←→ Autopilot
```

| Transition            | Requirement                                            |
| --------------------- | ------------------------------------------------------ |
| Manual → Copilot      | `workspace:update`                                     |
| Copilot → Autopilot   | `workspace:update`, fresh authentication, an active policy, and an explicit confirmation naming what may auto-publish |
| Any → lower mode      | `workspace:update`; takes effect immediately           |
| Emergency stop        | Any admin, no confirmation, immediate                  |

Upgrading to Autopilot is a privilege grant and is treated like one. Downgrading
is always frictionless. Asking a founder to confirm that they want less
automation would be exactly backwards.

Skipping directly from Manual to Autopilot is permitted mechanically but the UI
requires passing through the Autopilot confirmation, which names the policy and
shows a dry run of what would have published over the last 30 days. A founder
should see the consequence before accepting it.

### Downgrade semantics

A downgrade takes effect immediately and deterministically:

| State at downgrade                       | Effect                                        |
| ---------------------------------------- | --------------------------------------------- |
| Post `SCHEDULED` by policy, not yet published | Cancelled and returned to `APPROVED`      |
| Post `SCHEDULED` after human approval    | Left alone; a human decided it                |
| Post published                           | Untouched; it is public already               |
| Agent run in progress                    | Continues; gated actions re-check and fail    |
| Weekly cycle scheduled                   | Still generates a plan in Copilot; disabled in Manual |
| Applied weight adjustments               | Retained; revertible by hand                  |

Distinguishing human-approved from policy-approved scheduled posts is the
important part. A downgrade should withdraw the machine's decisions, not the
founder's.

## Emergency stop

A single control, available to any admin, with no confirmation dialog:

1. Sets the mode to Manual.
2. Cancels every policy-approved scheduled post that has not published.
3. Halts every in-flight agent run and every scheduled cycle.
4. Writes a prominent audit entry.
5. Notifies workspace admins.

It never deletes content, never revokes channel connections, and never touches
published posts. It is a stop button, not an undo button, and it must be
predictable enough that using it is not itself a risky decision.

A platform-wide equivalent exists for operators, disabling autonomy across all
workspaces without a deploy. Both are runtime controls.

## Escalation

Some situations warrant returning to a human even inside Autopilot:

| Condition                                     | Behavior                          |
| --------------------------------------------- | --------------------------------- |
| Classification unavailable                    | All content routes to review      |
| Publication failure rate exceeds a threshold  | Pause automatic publishing; notify |
| A founder deletes an auto-published post      | Pause automatic publishing; notify |
| Repeated policy overrides on one tag          | Suggest a policy change           |
| Quota or budget exhausted                     | Pause autonomous triggers; notify |
| Workspace suspended or past due               | All autonomy halts                |

The third row is the important one. A founder deleting an automatically
published post is the clearest possible signal that automatic publishing is not
trusted, and the system should stop and ask rather than continue.

## Authorization and audit

| Operation             | Permission                                    |
| --------------------- | --------------------------------------------- |
| Read the mode         | `workspace:read`                              |
| Change the mode       | `workspace:update`                            |
| Upgrade to Autopilot  | `workspace:update` plus fresh authentication  |
| Emergency stop        | `workspace:update`                            |

`workspace:update` is held by `owner` and `admin`. Neither an API key nor an
agent may read the mode as a decision input or change it. Automation must not
be able to observe or alter its own leash.

Audited: every mode change with previous and new values, the actor, and the
authentication method; every emergency stop; every autonomous action with its
mode, policy version, and rule; and every escalation pause with its reason.

Every autonomous action traces to a policy that allowed it, in a mode that
permitted the trigger, under a role that granted the permission. All three are
recorded on the action.

## Observability

- Workspaces by mode, and transition counts in both directions.
- Downgrade rate from Autopilot, which is the trust metric.
- Autonomous actions per workspace by type.
- Emergency-stop activations.
- Escalation pauses by reason.
- Auto-published posts later deleted by a founder.

Downgrades from Autopilot are the number that matters. Founders moving back to
Copilot are reporting that automation published something they did not want,
and no other metric captures that as directly.

## Failure behavior

| Failure                    | Behavior                                    |
| -------------------------- | ------------------------------------------- |
| Mode record unreadable     | Treated as Manual; fail closed              |
| Policy unavailable         | Autopilot behaves as Copilot                |
| Mode changed mid-run       | Next gated action re-checks and complies    |
| Concurrent mode changes    | Serialized; last write wins; both audited   |
| Downgrade cancellation fails | Retried; posts remain `SCHEDULED` and are surfaced as needing manual cancellation |

Every ambiguity resolves toward less autonomy.

## Acceptance criteria

1. A workspace switches between all three modes. Each mode's observable
   behavior matches this document, and every autonomous action traces to a
   policy that allowed it.
2. Manual admits no trigger: no GitHub suggestion, no weekly cycle, no
   proposal.
3. Copilot produces suggestions and plans, and approves nothing.
4. Autopilot with a default policy behaves exactly like Copilot.
5. Autopilot with a permissive policy auto-publishes only matching content.
6. Upgrading to Autopilot requires fresh authentication and an active policy.
7. The upgrade confirmation shows a 30-day dry run.
8. Downgrading cancels policy-approved scheduled posts and leaves
   human-approved ones.
9. Downgrading mid-run causes the next gated action to fail.
10. Emergency stop halts everything within seconds and audits it.
11. Emergency stop does not delete or unpublish anything.
12. Deleting an auto-published post pauses automatic publishing.
13. Classification downtime routes all content to review in Autopilot.
14. An agent cannot read or change the mode.
15. An unreadable mode record is treated as Manual.
16. No mode permits modifying approved content, brand, policy, or connections.
17. No mode permits deletion or cancellation.
18. Every autonomous action records its mode, policy version, and rule.

## Rollout

1. Ship the mode setting with Manual and Copilot only. Autopilot is not
   selectable.
2. Run Copilot broadly; measure suggestion acceptance and plan approval rates.
3. Ship RFC 030 policies with dry run.
4. Enable Autopilot for opted-in workspaces with a demonstrated approval
   history, meaning several weeks of consistently approved plans.
5. Measure downgrade rate and post-hoc deletions before broadening.
6. Ship escalation rules alongside Autopilot, not after. Autopilot without an
   automatic pause on distrust signals is not safe to offer.

## Out of scope

- Cross-workspace or agency-level autonomy controls.
- New marketing channels. Autonomy applies to the existing object model.
