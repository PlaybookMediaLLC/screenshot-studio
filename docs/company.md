# PlaybookMedia

**Building Shots: release-ready product communication for B2B software teams.**

PlaybookMedia helps software companies turn genuine product changes into
accurate, source-linked materials that marketing, sales, customer success and
customers can use. Shots is our release-readiness product. Customers retain
their existing engineering, design, documentation and publishing tools.

## The problem

Software teams ship faster than they communicate. Launch facts sit across
GitHub, tickets, product discussions and live interfaces. Product marketers
chase engineers for context; sales and customer success receive incomplete or
late explanations; screenshots, one-pagers and FAQs become stale.

A minor update can trigger unnecessary posts while a meaningful release goes
poorly explained. The cost is recurring coordination work and avoidable
misinformation, as well as time spent creating materials.

## Initial customer hypothesis

Focus on B2B SaaS organizations with roughly **20–200 employees**, at least
**two externally meaningful release moments per month**, and customer-facing
teams that depend on product updates. Size and cadence are targeting
hypotheses to validate, not established customer demographics.

Daily users are product marketers, product operations and launch owners.
Likely budget owners are heads of marketing, product leaders and founders.
Engineering and product owners confirm facts; sales, customer success and
customers use the approved materials.

## The product promise

**One approved product change becomes one reusable, role-specific release kit.**

1. **Detect and qualify:** select a GitHub release, merged PR, deployment or
   manual change; decide whether it warrants customer communication.
2. **Establish the facts:** collect source material and real screenshots;
   confirm what shipped, for whom, rollout status, benefits and limitations
   with a responsible human.
3. **Create:** produce a versioned fact sheet, sales and CS talking points,
   customer announcement, FAQ and branded screenshots. Add email or social
   variations when justified by the release and audience.
4. **Review and deliver:** expose supporting evidence, collect approval and
   export or hand off to the tools the team already uses.
5. **Maintain:** detect potentially stale claims and images after later
   changes and propose reviewable updates.

This is the intended product, not a statement that the entire workflow is
available today. See the [codebase audit](release-readiness-audit-2026-10-23.md).

## Positioning

Shots competes on the handoff from product truth to customer-ready
communication. Release-note vendors publish updates, design tools create
visuals, and social platforms schedule posts. Shots connects those workflows
without requiring buyers to replace Slack, Notion, Figma, Jira or a scheduler.

The standard is a trustworthy, approved kit used by downstream teams. A fixed
volume of automatically generated social content is not the success measure.
Wider social-network parity, general-purpose canvas expansion, autonomous
marketing campaigns and a separate interactive-demo product are deferred until
customers demonstrate a compelling reason to pay for them.

## Foundation and current stage

The repository includes image/video editing, brand kits, multi-size and App
Store exports, public product capture, structured release specs and campaign
plans, GitHub-triggered workflows, versioned assets, human approval and social
scheduling. Next.js/React, Go services, PostgreSQL, Temporal, object storage
and metered AI underpin it.

The next product gaps are claim-to-source verification, explicit readiness
checks, role-specific kits and distribution, and evidence-based freshness.
Source implementation and local tests do not establish full production
reliability. The narrowed positioning, willingness to pay and repeat adoption
still require direct validation.

## Business model

The existing subscription structure is **Pro $29/month**, **Business
$79/month**, and **Enterprise starting at $799/month**, priced against social
schedulers, with metered AI usage and no free plan. The billing implementation and current allowances are
documented in [RFC 023](rfcs/023-pricing-and-unit-economics.md).

For release readiness, test a guided paid pilot at approximately
**$199–$399/month**, or a defined per-release fee. This is a commercial
hypothesis, not a newly implemented plan. Final packaging depends on labor
savings, purchasing behavior, repeat usage and retention; include human
assistance and provider costs in the economics.

## Go to market and first 90 days

Recruit design partners directly from product marketers and product leaders
at SaaS companies with frequent releases. Reconstruct recent launches,
identify expensive manual handoffs and deliver three to five real kits using
existing Shots capabilities with controlled human assistance. Adoption should
require minimal workflow disruption.

The clock starts with the pilot program. These are proposed validation targets,
not traction figures or promises of engineering completion.

| Period | Target and evidence |
| --- | --- |
| Days 1–14 | Conduct 15 buyer interviews and seek three credible paid-pilot commitments. Record the release workflow, buyer, budget and baseline effort. |
| Days 15–30 | Deliver kits for actual releases and secure payment authorization from at least two buyers. Capture factual corrections and downstream use. |
| Days 31–60 | Demonstrate repeat use across release cycles with at least three customers and measurable labor savings. |
| Days 61–90 | Test whether at least five organizations will pay, with repeat use, renewal intent and a credible customer acquisition process. |

If evidence is weak, revise the segment, workflow or offer before expanding
feature breadth. Product and engineering own the pilot evidence together.

## Success and long-term direction

The primary outcome is meaningful releases converted into accurate, approved
communications that reach and are used by their intended audiences. Track
release-to-approval time, hours saved per kit, substantive factual correction
rates, downstream adoption, repeat usage and retention. Social impressions and
generated asset counts remain secondary.

With repeated paid demand, Shots can become a continuously maintained system
connecting product evidence to customer-facing materials: claim histories,
stale-content review, audience-specific distribution and feedback on what
people received and understood.

The [vision](vision.md) defines the north star and product principles. The
[RFC execution order](rfcs/README.md) turns it into incremental work.

- **Company:** PlaybookMedia
- **Product:** Shots
- **Website:** [shots.playbookmedia.io](https://shots.playbookmedia.io)
- **Repository:** [PlaybookMediaLLC/screenshot-studio](https://github.com/PlaybookMediaLLC/screenshot-studio)
