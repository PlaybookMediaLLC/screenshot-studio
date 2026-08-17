# RFC 031: Autonomy Modes

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 029 and RFC 030
**Owners:** Product, Engineering, and Security

## Decision

Offer three explicit autonomy modes per workspace. Users choose their level.
The progression Manual → Copilot → Autopilot replaces any jump directly into
autonomy.

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

## Design

- The mode is one workspace setting, changeable by admins, audited on change.
- Mode gates which triggers run, not which tools exist. The tool surface and
  policy checks stay identical across modes.
- Downgrading a mode takes effect immediately and cancels pending autonomous
  schedules that policies no longer permit.

## Exit criterion

A workspace switches between all three modes. Each mode's observable behavior
matches this document, and every autonomous action traces to a policy that
allowed it.

## Out of scope

- Cross-workspace or agency-level autonomy controls.
- New marketing channels. Autonomy applies to the existing object model.
