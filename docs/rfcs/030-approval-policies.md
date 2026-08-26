# RFC 030: Approval Policies

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 003, RFC 019, and RFC 029
**Owners:** Product, Engineering, and Security

## Decision

Let workspaces define which content the AI may publish automatically and
which content requires human approval. The existing RBAC, audit, and
compliance infrastructure becomes genuine product differentiation here.

A policy is a versioned, server-evaluated object. Evaluation happens inside the
same transaction as the state transition it gates, so there is no window in
which content moves without a policy decision.

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

## Goals

- Fail-closed automatic approval that a security reviewer can accept.
- Every automatic decision explainable and attributable to a policy version.
- Classification that is deterministic first and conservative always.
- A default that requires approval for everything.

## Non-goals

- Full autopilot mode. RFC 031 defines the autonomy levels built on these
  policies.
- Policy sharing across workspaces or an org-level policy library.
- A general-purpose rules engine. This governs content approval only.
- Replacing RBAC. Policies narrow what automation may do; they never widen it.

## Policy schema

```ts
ApprovalPolicy {
  id
  workspaceId
  version                 // immutable once active
  status                  // draft | active | archived
  defaultAction           // 'require_approval' — the only permitted default
  rules: PolicyRule[]     // ordered, ≤ 50
  createdBy, activatedAt
}

PolicyRule {
  id
  position                // evaluation order
  name
  when: Condition[]       // all must match
  action                  // require_approval | allow_auto_publish
  enabled
}

Condition =
  | { type: 'classification', value: ClassificationTag, present: boolean }
  | { type: 'channel', values: string[] }
  | { type: 'pillar', values: string[] }
  | { type: 'creativeType', values: string[] }
  | { type: 'template', templateIds: string[] }
  | { type: 'source', values: ('recipe'|'agent'|'recurring'|'manual')[] }
  | { type: 'confidence', min: number }
```

Conditions are a closed set of typed predicates. There is no expression
language, no user-supplied code, and no regular expressions from user input.
The evaluator is total: it terminates, cannot error on well-formed input, and
cannot be made expensive.

## Evaluation semantics

Evaluation is deterministic and ordered:

1. Classify the post, producing a tag set with confidences.
2. Evaluate rules in `position` order.
3. The first matching rule whose action is `require_approval` wins immediately
   and stops evaluation.
4. Otherwise, the first matching `allow_auto_publish` rule applies.
5. With no match, `defaultAction` applies, which is always
   `require_approval`.

Precedence is deliberately asymmetric. A restrictive match short-circuits;
a permissive match does not. Two rules that both match, one permissive and one
restrictive, always resolve to requiring approval regardless of order. Ordering
mistakes therefore produce over-review, never under-review.

Any of these forces approval regardless of every rule:

| Override                                     | Reason                            |
| -------------------------------------------- | --------------------------------- |
| Classification confidence below threshold     | Uncertainty is not permission     |
| Classification failed or timed out            | Fail closed                       |
| Post cites an external source (RFC 026)       | Third-party claims need a human   |
| Post names a competitor                       | Hard rule from RFC 026            |
| Post contains an unsupported factual claim    | Highest-damage failure mode       |
| Post is blocked by the prohibited-term filter | RFC 011                           |
| Workspace is not in Autopilot (RFC 031)       | Mode gates policy application     |
| Policy is `draft` or archived                 | Only active policies apply        |
| Content hash changed since classification     | Re-classify before deciding       |

## Classification

Content classification (announcement, metric claim, competitor reference,
customer name) is a deterministic check first, with an LLM check as backup.
Any uncertain classification routes to review.

### Stage 1: deterministic

| Tag                  | Deterministic signal                                        |
| -------------------- | ----------------------------------------------------------- |
| `product_announcement` | Campaign objective is launch or feature; pillar is product |
| `metric_claim`       | Numeric patterns: percentages, multipliers, currency, "Nx"  |
| `pricing`            | Currency amounts, plan names from the product profile       |
| `competitor_reference` | Competitor names from `ProductProfile.competitors`        |
| `customer_name`      | Customer names from stored proof points                     |
| `external_source`    | The post links a `ResearchSource`                           |
| `approved_template`  | The creative uses a previously approved template            |
| `unsupported_claim`  | A factual assertion with no linked source                   |

Deterministic checks are fast, explainable, and free. They also catch the
highest-risk categories, since metrics, pricing, and competitor names are all
pattern-detectable.

### Stage 2: model backup

Only when stage 1 is inconclusive for a tag a rule depends on. One
schema-validated call returning tags with confidences.

- Below the confidence threshold, the post routes to review.
- On failure or timeout, the post routes to review.
- The model can only *add* restrictive tags. It cannot clear a tag that a
  deterministic check set. A model persuaded by injected content cannot
  declassify a metric claim.

That asymmetry is the security property. Classification is an input to a
permission decision, and a model must never be able to widen permission.

## Enforcement points

Policy evaluates at every transition that could move content toward the public,
and each is a separate check because content and policy can change between
them:

| Point                              | Check                                        |
| ---------------------------------- | -------------------------------------------- |
| Automatic approval attempt         | Full evaluation; failure routes to review    |
| Transition to `SCHEDULED`          | Re-evaluate; content hash must match         |
| Immediately before publishing      | Verify the approval record and hash          |

The agent cannot bypass it. There is no tool that approves (RFC 016), and the
transition service is the only path to `APPROVED`, so policy evaluation is not
optional for any caller.

## Versioning and audit

- Policies are versioned; activating a new version archives the previous one.
- Active versions are immutable. Editing produces a draft.
- Every decision records the policy ID, version, matching rule, classification
  tags with confidences, and the outcome.
- Decisions are written in the same transaction as the transition they gate.
- Policy changes are audited with a diff of rules and their author.

A decision record survives policy deletion, so "why was this published
automatically in March" is answerable in December.

## Explainability

Every decision produces a founder-readable explanation:

```ts
PolicyDecision {
  postId, policyId, policyVersion
  outcome              // auto_approved | requires_approval
  matchedRuleId, matchedRuleName
  classifications      // [{ tag, confidence, method }]
  overrideReason?      // when a hard override applied
  evaluatedAt
}
```

The workspace UI shows, per post, which rule decided and which classification
triggered it. A dry-run mode evaluates a draft policy against recent posts and
shows what would have happened, so an admin can see the consequences of a rule
before activating it.

Dry run is what makes policy authoring safe. Nobody should have to learn their
policy's behavior from live published content.

## Exceptions and inheritance

- There is no per-post policy exception. A post either satisfies the policy or
  goes to review. A one-off bypass is indistinguishable from a mistake.
- There is no inheritance in v1. One workspace, one active policy. A
  multi-workspace policy library is a future feature and is explicitly not
  designed for here.
- A workspace may temporarily suspend automatic publishing entirely, a
  one-click "everything goes to review" that does not require editing rules.

## Migration and rollout

1. Every workspace starts with a default policy: `require_approval` for
   everything and no rules. Behavior is identical to today.
2. Policy evaluation runs in shadow mode on manually approved content,
   recording what it would have decided, changing nothing.
3. Admins author policies with dry run against historical posts.
4. Activation requires an explicit confirmation naming what may publish
   automatically.
5. Automatic publishing is available only in Autopilot (RFC 031).
6. A platform-wide kill switch disables all automatic approval without a
   deploy.

The kill switch is a requirement, not a nicety. A classification regression
that starts auto-approving product announcements must be stoppable in seconds.

## Authorization

| Operation             | Permission          |
| --------------------- | ------------------- |
| Read policy           | `workspace:read`    |
| Read decisions        | `workspace:read`    |
| Create or edit a draft| `workspace:update`  |
| Activate a version    | `workspace:update` plus fresh authentication |
| Suspend automatic publishing | `workspace:update` |

Activation requires recent authentication because it is a privilege-granting
action: it authorizes automation to publish without a human. It is treated like
a security setting, not a preference.

Policies are never editable by an API key or by an agent. Automation cannot
widen its own permissions.

## Failure behavior

| Failure                       | Behavior                                     |
| ----------------------------- | -------------------------------------------- |
| Classification service down   | Everything routes to review                  |
| Model timeout                 | Route to review                              |
| Policy record unreadable      | Route to review                              |
| Conflicting rules             | Restrictive wins                             |
| Content changed post-decision | Re-evaluate; decision invalidated            |
| Evaluation exception          | Route to review; alert                       |

Every failure mode routes to human review. There is no failure that results in
automatic publishing.

## Observability

- Decisions by outcome and matched rule.
- Classification tag distribution and confidence distribution.
- Automatic-approval rate per workspace.
- Override counts by reason.
- Post-hoc corrections: automatically published posts a founder later deletes,
  which is the false-positive measure and the one that matters most.
- Kill-switch activations.

A single automatically published post that a founder would not have approved
costs more trust than a hundred correctly reviewed ones earn. The false
positive rate is the metric that governs whether this feature expands.

## Acceptance criteria

1. An educational post publishes without a human touch. A post naming a
   competitor stops at `ready_for_review`, and the audit log shows the policy
   decision for both.
2. A new workspace requires approval for everything by default.
3. A post matching both a permissive and a restrictive rule requires approval.
4. Classification below the confidence threshold requires approval.
5. Classification failure requires approval.
6. A post containing "3x faster" is tagged `metric_claim` deterministically.
7. A post naming a competitor requires approval regardless of any rule.
8. A post citing an external source requires approval.
9. A post with an unsupported factual claim requires approval.
10. The model cannot clear a deterministically set tag.
11. Editing a post after an automatic approval invalidates it.
12. Every decision records the policy version, rule, and classifications.
13. Dry run shows the outcome for historical posts without changing them.
14. Activating a policy requires fresh authentication.
15. An agent cannot modify a policy.
16. Suspending automatic publishing takes effect immediately.
17. The kill switch stops all automatic approval platform-wide.
18. A workspace not in Autopilot never auto-approves, whatever its policy.
19. Classification service downtime routes everything to review.

## Out of scope

- Full autopilot mode. RFC 031 defines the autonomy levels built on these
  policies.
