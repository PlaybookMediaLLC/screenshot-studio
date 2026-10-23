# Release-readiness codebase audit — 2026-10-23

## Scope and conclusion

Audited revision: `5bc7b8d0ea551b95ed836263f87ab2169200159f`.
The input is the supplied **PlaybookMedia | Shots — Release-ready product
communication for B2B software teams** brief. This is a source and focused
local-test audit, not a production certification or evidence of customer demand.

Shots has substantial reusable infrastructure for the new direction. Its
current launch workflow produces cited specs, campaign plans, visual assets,
and channel copy. The missing product is a release-readiness workflow that
verifies what those citations support, binds approval to a complete kit for
specific audiences, records delivery and use, and reviews affected material
when product facts change. Building another canvas or increasing social post
volume does not close those gaps.

## Evidence matrix

“Present” means implementation was inspected. It does not mean every path was
executed or deployed. “Gap” describes the narrower product brief, not a claim
that the existing implementation violates its original contract.

| Capability | Code evidence | Present behavior and remaining gap |
| --- | --- | --- |
| Tenant platform and durable work | [backend SDK](../lib/backend/sdk.ts), [Ent schemas](../services/ent/schema), [Temporal release automation](../services/internal/temporalreleaseautomation/workflow.go), [CI](../.github/workflows/ci.yml) | Next.js calls the Go backend; Go owns product data in PostgreSQL. Temporal executes durable workflows. Reuse these boundaries; no new database owner or orchestrator is needed. Deployment reliability and tenant-isolation evidence must be collected for the pilot environment. |
| Release intake and qualification | [release schema](../services/ent/schema/release.go), [GitHub events](../services/internal/product/github_events.go), [relevance classifier](../services/internal/product/release_automation_relevance.go), [workflow executor](../services/internal/temporalreleaseautomation/workflow.go) | Manual/source releases, merged-change collection, deployment intake, deterministic qualification and optional AI relevance decisions exist. Historical events do not execute marketing actions. Missing: a unified human qualification decision, accountable owner, rollout facts, grouping of signals into a meaningful release, and explicit “no communication needed” outcomes. |
| Versioned facts and citations | [spec schema](../lib/launch/spec-schema.ts), [source collection](../lib/launch/sources.ts), [citation checks](../lib/launch/citations.ts), [spec generation](../lib/ai/launch/spec.ts), [launch persistence](../services/ent/schema/launch.go) | Specs hold source excerpts, fetch times, source status, limitations, FAQs and open questions. Citation validation checks known IDs. It does not establish that a passage supports a claim. The brief is accepted as a citation, and an unsupported summary can fall back to it with an open question. No stable claim identity, evidence-span assessment, or per-claim human verification lifecycle was found. |
| Copy provenance | [copy guards](../lib/launch/guards.ts), [claim references](../lib/launch/spec-schema.ts), [copy generation](../lib/ai/launch/copy.ts) | Copy checks reject unknown spec references, prohibited language, disallowed links and format violations. References are section/index paths. The code can compare referenced text between versions, but a valid reference alone does not prove that every factual statement in the output is supported. |
| Human approval | [launch decisions](../services/internal/product/launch.go), [decision authority](../services/internal/product/configuration.go), [campaign transitions](../services/internal/product/campaign_transitions.go), [approval tests](../services/internal/product/approvals_integration_test.go) | Backend decisions enforce human authority; specs and plans have approval records and revision history. Spec approval does not evaluate a release-readiness checklist for rollout, unresolved factual blockers, audience-specific materials, and verified evidence. Draft specs can be used for planning; distinguish drafting from approved delivery. |
| Screenshots and product surfaces | [capture client](../services/internal/capture/capture.go), [capture history](../services/internal/product/surfaces.go), [deployment capture](../services/internal/product/github_events.go), [freshness](../lib/tenant/surface-freshness.ts) | Public-page capture, manual image binding, feature/surface lookup and capture history exist. Freshness is a 30-day age heuristic. It does not establish that an image still matches a release, UI state or claim. No authenticated product-capture session lifecycle was found. |
| Creative assets and editing | [creative-set schema](../services/ent/schema/platform_creative_set.go), [delivery](../lib/creative-sets/delivery.ts), [editor documentation](editor-platform.md) | Story Sets and Canvas persist revisioned native documents and export media with review checks. Existing image/video, brand and store tooling is reusable. A creative set is not a complete sales/CS/customer release kit; further general-purpose canvas expansion is not a prerequisite. |
| Role-specific materials | [launch schema](../lib/launch/spec-schema.ts), [production pipeline](../lib/ai/launch/produce.ts), [content drafts](../services/internal/product/content_drafts.go), [announcements](../services/internal/product/announcements.go) | FAQs and limitations exist inside the spec; campaign channels include email and changelog. Drafts, email and publishing are useful outputs. Missing: one versioned kit manifest linking the fact sheet, sales and CS talking points, customer announcement, FAQ and approved screenshots to the same approved facts. |
| Delivery into existing tools | [delivery adapters](../lib/integrations/deliver.ts), [share delivery](../lib/integrations/server.ts), [outbound webhooks](outbound-webhooks.md) | Existing delivery uploads design media to Notion, sends design shares through Slack, and comments with a share link in Figma. Figma delivery does not insert an editable design. These are not full role-specific document handoffs with durable receipts, correction lineage or downstream-use evidence. |
| Maintenance and outcome measurement | [surface freshness](../lib/tenant/surface-freshness.ts), [revision proposals](../lib/ai/launch/revise.ts), [launch run schema](../services/ent/schema/launch.go) | Capture ages, proposed revisions, run costs and activity are useful foundations. No end-to-end source-change → affected claim → affected kit/destination review queue or adopted-release metric was found. Social analytics cannot substitute for evidence that sales, CS or customers used the kit. |
| Billing | [plan gates](../lib/billing/plans.ts), [billing RFC](rfcs/035-pricing-and-unit-economics.md) | Paid plan entitlements and metered AI exist. The supplied pilot price and ICP are hypotheses. This documentation change does not create a new Stripe price, discount, entitlement or free plan. |

## Priority findings

1. **Trust needs more than valid citation IDs.** Add versioned evidence and
   claim-level human decisions before calling content factually verified.
   Keep failed fetches, conflicting sources and unsupported claims visible.
2. **Approval must cover the deliverable.** Bind readiness to an exact facts,
   artifact and audience manifest. Changing an approved dependency requires
   another decision; draft work may continue without being deliverable.
3. **The object model must serve downstream teams.** Reuse release specs,
   drafts and assets, but add an explicit release-kit relationship. Sales/CS
   material must not be forced into a social-channel field.
4. **Distribution needs accountable handoffs.** Start with exports and the
   existing Slack/Notion connections. Record what version went where and
   separate successful delivery from evidence of use.
5. **Freshness needs change evidence.** Capture age can prompt review, but
   cannot prove invalidity or correctness. Preserve old approvals and receipts;
   propose corrections rather than silently changing delivered material.
6. **Customer and production validation remain gates.** Start assisted pilots
   immediately with human checks, then automate the repeated bottlenecks.
   Do not wait for every integration or claim customer traction from tests.

## Documentation drift

The old README prioritized seven social posts from a URL, claimed the missing
layer was small, and mixed source status with production assertions. RFC 009
and RFC 021 reflect that earlier promise; RFC 039 prioritizes network parity.
Those priorities are superseded by the [new execution order](rfcs/README.md).

RFC 012 says nothing is built despite the product-profile and onboarding
implementation. RFCs 011, 013 and 014 omit existing enforcement, capture history
or versioning in their status summaries. RFC 037 and RFC 038 have implementation
behind older “Accepted” or “Proposed” labels. The current inventory corrects
those summaries without asserting that every original acceptance criterion is
complete.

Older RFC bodies and parts of [ARCHITECTURE.md](../ARCHITECTURE.md) retain
Prisma, Trigger.dev and earlier hosting assumptions. For implementation, use
[Playbook Core](playbook-core.md), [local development](local-development.md),
the [backend README](../services/README.md), and the inspected code. New work
uses Go/Ent, PostgreSQL, Temporal and the existing SDK/API boundaries.

## Validation performed

- Baseline `npm run verify:rfcs`: **17/17 checks passed**.
- Baseline `python3 scripts/verify-rfcs.py --self-test`: **passed**.
- After the documentation changes, RFC verification and its self-test passed
  again. Local-link checks covered 58 documents; inventory checks accounted
  for all 52 numbered RFCs exactly once. The new-work dependency chain is
  acyclic, with authenticated capture outside the mandatory path.
- Focused source-behavior tests: **48 passed, 0 failed, 0 skipped**:

  ```sh
  ./node_modules/.bin/tsx --test test/launch-spec.test.ts test/launch-sources.test.ts test/launch-guards.test.ts test/surface-freshness.test.ts test/campaign-status.test.ts test/integrations.test.ts test/workflow-contracts.test.ts
  ```

These tests cover citations, source defenses, copy guards, approval transitions,
age-based freshness, adapter request shapes and workflow contracts. They do
not verify semantic factual accuracy, live providers, customer adoption or a
deployed end-to-end release kit. The Go integration tests and browser fixtures
were inspected, not executed in this audit. In particular, the launch database
test skips when its test database URL is absent; its existence is not a pass.

## Resulting sequence

[RFC 045](rfcs/045-release-readiness-pilots.md) establishes the product decision,
assisted pilot and measurement contract. Then build qualification (046), claim
verification (047), release kits and readiness (049), delivery and use (050),
and evidence-based freshness (051). Authenticated capture (048) is conditional
on pilot needs; uploaded evidence is the initial fallback. The
[RFC index](rfcs/README.md) assigns every older RFC a disposition and preserves
stable IDs and links.
