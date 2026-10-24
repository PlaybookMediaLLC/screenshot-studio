# Shots vision

**Every meaningful product change becomes accurate, approved communication
that the right people can use and keep current.**

Shots is the release-readiness layer between a B2B software team shipping a
change and its customers understanding it. The unit of value is a useful
release kit, grounded in product evidence and approved by accountable people.
The [company brief](company.md) defines the initial customer and business
hypotheses; the [audit](docs/release-readiness-audit-2026-10-23.md) records the
implementation starting point.

## North-star experience

A launch owner selects a meaningful change. Shots gathers source material and
real screenshots, identifies uncertainties, and asks the responsible product
owner to confirm facts, rollout, audience and limitations. The owner can also
decide that the change does not need external communication.

From those facts, Shots creates a versioned fact sheet, sales and CS talking
points, customer announcement, FAQ and branded screenshots. Reviewers see the
evidence behind each material claim. The approved kit is exported or delivered
to the team's existing workspace, and the launch owner can see what version
was delivered and whether recipients used it.

When a later release changes a source, claim or screen, Shots identifies the
affected materials and proposes a review. Humans decide whether a correction
is needed. Delivered history stays inspectable.

```text
Selected change → qualified release → verified facts → role-specific kit
                                                        ↓
Later change → affected-material review ← use evidence ← approved handoff
```

## Product principles

1. **Evidence before confidence.** A valid citation is necessary but does not
   prove a claim. Preserve source versions, supporting passages, conflicts,
   unknowns and the human decision. AI suggestions are not verification.
2. **Approval binds exact versions.** Review facts, audience, rollout and the
   actual deliverables. Editing a dependency requires re-evaluation before
   the revised kit can be delivered as approved.
3. **A release determines its communication.** Internal refactors may need
   nothing. A customer-visible change may need a FAQ and CS note without a
   social post. Avoid fixed output quotas as a product goal.
4. **Keep the customer's tools.** Start with exports and selected handoffs to
   existing workspaces. Customers should not have to move their source of
   engineering truth, design work or distribution calendar into Shots.
5. **Make every stage useful without an agent.** Forms, human review and
   assisted service can complete the workflow. Automation removes proven
   repetitive work and uses the same authorized domain operations.
6. **Maintain trust over time.** Separate old, changed, unavailable and
   confirmed-current evidence. Propose updates with reasons and preserve the
   approval and delivery history.
7. **Earn breadth through paid repeat use.** Prefer improvements that shorten
   time to an accurate, adopted kit. Protect existing capabilities while
   deferring unrelated expansion.

## Outcome definition

The proposed north-star metric is **adopted release kits per active customer
organization per month**, with the total count and eligible-release denominator
reported alongside it.

A release counts once when a qualified meaningful change has a versioned,
fact-checked, human-approved kit, the required audience handoffs have succeeded,
and there is recorded use for each required audience. Version
updates, retries, asset variants and additional social posts do not add another
release. Track coverage and use separately for each audience; do not infer use
from a successful API call, an email open or an impression.

Initially, use can be documented manually: a sales or CS owner confirms using
the material, or a customer communication has a verifiable publication/use
record. Record who supplied the evidence, when and for which kit revision.
Missing evidence remains unknown. Automated receipts later replace manual
steps without changing the definition.

Guardrails are substantive factual corrections, release-to-approval time,
customer labor saved, operator assistance and cost per kit, repeat use,
payment and retention. Do not claim savings without a comparable baseline or
hide human service time in software margins. Definitions and pilot collection
are in [RFC 001](docs/rfcs/001-release-readiness-pilots.md).

## Incremental path

| Milestone | Customer value | Exit evidence |
| --- | --- | --- |
| 0. Assisted pilot | A real release becomes a useful kit with current tools and human checks. | Paid commitment, reviewed facts, delivered material, measured effort and downstream-use evidence. |
| 1. Qualified and verified release | An owner can resolve uncertainty and establish what actually shipped. | Replayed inputs do not duplicate releases; each material claim has reviewable evidence or an explicit unresolved state. |
| 2. Approved role-specific kit | Sales, CS and customers receive consistent materials from the same facts. | Exact-version readiness checks block unsupported or outdated deliverables; a complete kit can be exported. |
| 3. Accountable handoff | The launch owner can see which audiences received and used which revision. | Destination receipts, safe retry/reconciliation, per-audience use evidence and repeat release cycles. |
| 4. Maintained communication | Later product changes lead to targeted, reviewable updates. | Source/claim/image changes identify affected kits and destinations; a human resolves each finding. |

Authenticated capture is a conditional supporting track. Reviewed uploads and
public capture let the first kits ship while customer need determines whether
to invest in private-app automation. Full dependencies, acceptance criteria and
rollout gates are in the [RFC execution order](docs/rfcs/README.md).

## Boundaries

The present focus excludes wider social-network parity, general-purpose design
expansion, autonomous marketing calendars and a separate interactive-demo
product. Existing scheduling, Canvas, Story Sets and store exports remain
supporting capabilities. Their presence is not an obligation to expand them.

Source implementation, local tests, production readiness and customer demand
are separate kinds of evidence. The long-term vision is conditional on repeated
paid demand; it is not a description of today's shipped product.
