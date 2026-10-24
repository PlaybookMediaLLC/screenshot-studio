# RFC execution order

**Updated:** 2026-10-23, after the [release-readiness codebase audit](../release-readiness-audit-2026-10-23.md).

This is the authoritative order for new product work toward the
[Shots north star](../../vision.md): meaningful releases become accurate,
approved communications that reach and are used by their intended audiences.
The [company brief](../../company.md) defines the customer and commercial
hypotheses. Historical numerical order is not the delivery plan.

Keep RFC IDs and filenames stable so code comments, issues and links continue
to resolve. The order below supersedes the marketing-first sequence in RFC 009,
the seven-post milestone in RFC 021, the expansion order in RFC 000 and the
network-parity priorities in RFC 039. Older dependency lists describe the
original designs; they are not instructions to rebuild completed foundations
or complete deferred proposals before starting the new slices.

## Build order and exit gates

Each milestone produces usable customer value. Begin assisted pilots now;
advance automation based on the observed bottlenecks and acceptance evidence,
not completion of every historical RFC. Existing access control, approval,
billing and reliability obligations remain prerequisites throughout.

| Order | Work | Reuse | Exit gate |
| --- | --- | --- | --- |
| 0 | [045 — Paid pilots and measurement](045-release-readiness-pilots.md) | Release intake, specs, editing, human approval, exports and billing | A reviewable assisted kit for a real release, explicit facts/approval checklist, actual handoff/use evidence or recorded unknowns, baseline effort/cost and commercial commitment. Start the 90-day validation targets; do not claim them as results. |
| 1a | [046 — Qualified releases](046-release-qualification.md) | 005/006 intake, 022 source changes and existing workflow relevance checks | An owner can qualify, defer or decline a change; grouped/replayed signals preserve one release identity and explicit rollout facts. |
| 1b | [047 — Claim evidence and verification](047-claim-evidence-and-verification.md) | Versioned specs, source collection, 012 product context, 019 human decisions | Material claims have stable IDs, pinned supporting evidence and human decisions. Unsupported/conflicting facts stay unresolved. |
| 2 | [049 — Role-specific kits and readiness](049-release-kits-and-readiness.md) | 010/011 rendering and brand, 037 drafts, existing specs/assets/review | One complete kit can be reviewed and exported; exact-version gates reject unverified facts, unsafe materials and stale approvals. |
| 3 | [050 — Handoffs and adoption](050-release-kit-handoffs-and-adoption.md) | Existing exports, Slack/Notion connections, outbox, Temporal and API contracts | Delivery receipts distinguish accepted, failed and uncertain outcomes; intended-audience use is recorded; repeated release cycles use the same measurement contract. |
| 4 | [051 — Evidence-based freshness](051-evidence-based-material-freshness.md) | 013 capture history, 023 deployment signals and revision proposals | A second release identifies affected claims/images/kits/destinations; humans review and approve corrections without rewriting history. |

The new-work dependency chain is **045 → 046 → 047 → 049 → 050 → 051**.
RFC 045's customer discovery, effort measurement and commercial validation
continue across every stage. A milestone passing local tests does not establish
production readiness or paid repeat adoption.

### Conditional supporting work

[048 — Authenticated product capture](048-authenticated-product-capture.md)
follows verified evidence when private-screen uploads are a demonstrated
bottleneck. It reuses 013/023 and depends on 047's evidence contract. It is
**not** a prerequisite for 049, 050 or 051: reviewed uploads and public capture
support those milestones. The first slice is one isolated, authorized demo
account and origin, followed by revocation and controlled recapture.

Live-provider verification from 036 is required when a pilot actually relies
on those store/Figma flows; it does not justify expanding store features.
Maintain reliability for existing publishing and creative workflows without
making their unused features prerequisites for release readiness.

## Architecture and compatibility rules

- RFCs 045–051 now include proposed schemas, commands, state transitions,
  failure handling and implementation test gates. Their
  [shared technical contracts](../release-readiness-technical-contracts.md)
  define tenant keys, authorization, transaction/lock order, version hashes,
  API errors, outbox dispatch and migration rules. These are implementation
  designs, not claims that the new workflows have shipped.
- Reuse Next.js/React, the backend SDK, Go/Ent, PostgreSQL, object storage and
  Temporal. The web never owns database access. New API contracts use the
  existing Zod/route boundary; agent and UI operations share backend authority.
- Add release qualification, claim/evidence, kit and delivery relations around
  existing specs, drafts and assets. Avoid another editor, renderer, job system,
  scheduler or generic autonomous agent framework.
- Preserve existing releases, campaigns and approvals. New verification and
  kit-readiness guarantees require explicit review; migration cannot invent it.
- A new RFC's dependency means the **specific reusable slice** described in its
  design, not every original acceptance criterion of an older partial RFC.
- Older bodies may retain Prisma, Trigger.dev and prior hosting assumptions.
  They are historical where they conflict with the audited architecture. Use
  [Playbook Core](../playbook-core.md), [local development](../local-development.md),
  [deployment](../deployment.md) and the backend implementation for current work.

## Complete RFC inventory

Every numbered document appears once below. “Implementation present” means code
was identified, not all original criteria or live-provider behavior verified.
For detailed evidence and local tests see the audit. Historical status notes
remain dated records; the current disposition controls investment priority.

### Active new work, in delivery order

| RFC | Current state | Disposition |
| --- | --- | --- |
| [045 — Release-readiness pilots](045-release-readiness-pilots.md) | Proposed; validation unperformed | Start first; program and outcome definitions continue throughout. |
| [046 — Release qualification](046-release-qualification.md) | Proposed; intake/classification primitives exist | Milestone 1a: accountable intake and rollout facts. |
| [047 — Claim evidence](047-claim-evidence-and-verification.md) | Proposed; citation/spec primitives exist | Milestone 1b: supporting evidence and human verification. |
| [049 — Release kits and readiness](049-release-kits-and-readiness.md) | Proposed; editing/approval primitives exist | Milestone 2: audience materials, manifest, gates and export. |
| [050 — Handoffs and adoption](050-release-kit-handoffs-and-adoption.md) | Proposed; design-delivery adapters exist | Milestone 3: role handoffs, receipts and use evidence. |
| [051 — Evidence-based freshness](051-evidence-based-material-freshness.md) | Proposed; age labels/revision proposals exist | Milestone 4 after repeat use: affected-material review. |

### Reusable foundations and supporting surfaces

These are maintained and extended only as needed by the active sequence.

| RFC | Audited starting point | Disposition |
| --- | --- | --- |
| [002 — Tenant data and media lineage](002-planetscale-tenant-data-model.md) | Go/Ent data model and migrations present; deployment verification separate | Foundation: tenant isolation, additive migrations and lineage. |
| [003 — Auth, enterprise and audit](003-better-auth-enterprise-audit.md) | Auth/RBAC/audit implementation present; full acceptance not re-certified | Foundation: human decisions, membership and access revocation. |
| [005 — Repository/webhook/provider integrations](005-repository-webhook-scheduler-integrations.md) | Source intake and integrations present | Reuse for 046 and 050; add only pilot-required adapters. |
| [006 — Release inputs and artifact pipeline](006-release-inputs-and-artifact-pipeline.md) | Releases, notes, uploaded media and assets present | Foundation: preserve original source and artifact lineage. |
| [007 — RPC product surface](007-mvp-rpc-product-surface.md) | tRPC surface present; original single-service architecture superseded | Reuse contracts; Go backend remains data owner. |
| [010 — Creative engine](010-programmable-creative-engine.md) | Shared design/render/export implementation present | Reuse branded screenshots; no renderer rewrite. |
| [011 — Brand context](011-brand-profile.md) | Brand kit/profile and copy-rule enforcement present | Reuse visual identity and voice for kit artifacts. |
| [012 — Product intelligence](012-product-intelligence.md) | Product profile, field provenance and human locks present | Reuse context; add release claim verification in 047. |
| [013 — Product asset map](013-product-asset-map.md) | Surface matching, capture binding/history and age labels present | Reuse in 047/048/051; age is not semantic freshness. |
| [014 — Structured marketing objects](014-structured-marketing-objects.md) | Campaigns, creative links, spec/plan revisions and provenance present | Preserve compatibility; add kit relationships in 049. |
| [016 — AI tools](016-ai-sdk-marketing-tools.md) | Typed campaign tool layer and guarded runs present | Reuse bounded draft assistance; no AI factual approval. |
| [017 — Conversational creation](017-conversational-campaign-creation.md) | Campaign copilot implementation present | Optional input surface; manual workflow stays complete. |
| [018 — Campaign workspace](018-campaign-workspace.md) | Campaign/review UI present | Reuse review components; prioritize kit and facts workflow. |
| [019 — Approval workflow](019-approval-workflow.md) | Backend human decisions and post transitions present | Preserve authority; extend exact-version kit readiness in 049. |
| [020 — Social publishing](020-social-publishing.md) | Scheduling/publishing lifecycle present; live reliability separate | Maintain existing delivery; optional kit variants only. |
| [022 — GitHub integration](022-github-integration.md) | PR/release intake and workflow relevance checks present | Reuse for 046; classification is not human qualification. |
| [023 — Deployment screenshots](023-deployment-screenshot-automation.md) | Public capture and workflow rendering present | Reuse history/signals; authenticated extension is 048. |
| [032 — Onboarding agent](032-background-onboarding-agent.md) | Go onboarding/profile pipeline present behind configuration | Reuse optional context; URL onboarding is not required for a manual kit. |
| [034 — REST and Scalar](034-rest-api-scalar-reference.md) | Versioned API, OpenAPI and client present | Extend existing contracts for new resources. |
| [035 — Pricing and unit economics](035-pricing-and-unit-economics.md) | Paid subscription gates and metering present | Maintain pricing; validate pilot packaging and service cost in 045. |
| [037 — Workspaces and content drafts](037-workspaces-and-content-drafts.md) | npm workspaces, Plate editor, drafts and collaboration present | Reuse document editing and revisions for role artifacts. |
| [038 — MCP and agents](038-mcp-and-agent-integrations.md) | Go MCP server, tools and OAuth implementation present | Keep parity with backend authority; expose kit operations only as needed. |
| [040 — Story Sets](040-story-sets.md) | Revisioned composition and delivery implementation present; pilot validation pending | Reuse visuals; broader creative expansion deferred. |
| [041 — Creative Canvas](041-creative-canvas.md) | Implementation present; earlier RFC reports local-only validation | Maintain existing surface; no new canvas scope on the critical path. |
| [042 — Write workspace](042-write-workspace.md) | Draft/write/publish implementation present with coverage matrix | Reuse authoring; social feature parity deferred. |
| [043 — Settings and social sets](043-settings-platform.md) | Implementation present with coverage matrix | Maintain workspace/connection controls; unrelated expansion deferred. |
| [044 — Canvas layers and automation](044-canvas-layers-and-automation.md) | Implementation present; earlier RFC reports local-only validation | Reuse existing capabilities; additional canvas work deferred. |

### Conditional work

| RFC | Current state | Trigger |
| --- | --- | --- |
| [048 — Authenticated capture](048-authenticated-product-capture.md) | Proposed | Repeated private-screen capture pain with paid pilot demand; uploads remain supported. |
| [036 — Store-provider verification](036-store-provider-e2e-verification.md) | Accepted testing design; live-provider result not revalidated | Maintain tests for used flows; run the relevant live gate before relying on a provider. |

### Deferred expansion

Reopen only with repeated paid customer evidence and an explicit decision that
the work improves release-kit adoption, correctness, effort or retention.
Existing implementation within these areas still receives necessary fixes.

| RFC | Current state or limit | Why deferred |
| --- | --- | --- |
| [008 — Cloudflare data plane](008-cloudflare-native-data-pipeline.md) | Original Workers/queue proposal not established; R2/rendering already used | No data-plane rewrite is required for the kit workflow; old Trigger.dev premise is obsolete. |
| [024 — Demo video generation](024-demo-video-generation.md) | Video editing exists; captured-workflow demo product not established | Static evidence and usable kits first; no separate interactive-demo product. |
| [025 — Content pillars/calendar](025-content-pillars.md) | Dedicated pillar-planning proposal not established | Weekly marketing volume is outside the initial job. |
| [026 — External research](026-external-research-tools.md) | Some onboarding enrichment exists; broad research toolset is not the milestone | Prioritize the customer's own release evidence. |
| [027 — Social analytics](027-analytics-ingestion.md) | Some provider analytics code exists; normalized RFC-wide loop not established | Measure adopted kits in 045/050; impressions are secondary. |
| [028 — Feedback-driven generation](028-feedback-driven-generation.md) | Proposed performance-weight feedback loop | First learn from corrections and audience use. |
| [029 — Recurring campaigns](029-recurring-campaign-generation.md) | Proposed weekly planner; event workflows are a distinct existing capability | No weekly post quota or autonomous calendar commitment. |
| [030 — Approval policies](030-approval-policies.md) | Generic automatic-approval proposal | New release facts and kit delivery retain explicit human decisions. |
| [031 — Autonomy modes](031-autonomy-modes.md) | Generic autopilot proposal | Automate evidence preparation and bounded handoffs first. |
| [039 — Scheduling priorities](039-scheduling-feature-priorities.md) | Some related Write/settings work exists; priority order superseded | Network parity, bulk social scheduling and social dashboards are not the current critical path. |

### Historical or superseded

| RFC | Disposition |
| --- | --- |
| [000 — Detail audit](000-detail-audit-2026-08-26.md) | Historical design-completeness audit; retain its checks, use the October audit for the current product baseline. |
| [001 — Guided release kit](001-guided-release-kit.md) | Original architecture superseded; retain the release-kit insight. Current kit scope and readiness are defined in 045/049. |
| [004 — Trigger.dev jobs](004-trigger-dev-background-jobs.md) | Superseded by existing Go/Temporal execution. |
| [009 — Marketing platform thesis](009-marketing-platform-thesis.md) | Product direction superseded by 045 and the vision; retain reusable implemented primitives. |
| [015 — Feature-launch recipe](015-feature-launch-recipe.md) | Superseded by the current launch pipeline; reuse bounded stages where useful. |
| [021 — Three core workflows](021-core-workflows.md) | Seven-post chargeable milestone superseded by approved, adopted release kits. Existing workflows remain compatible. |
| [033 — Workspace migration](033-workspace-migration.md) | Superseded by 037; npm workspaces already exist. |

## Completion evidence

Each new RFC includes a bounded first slice, data/authority boundaries,
acceptance criteria, an outcome metric and rollback behavior. Mark implementation,
local validation, deployed validation and paid customer use separately when
updating status. Do not mark an RFC complete because files exist or its model
produced valid JSON. Run the repository RFC checks and verify the affected
workflow before promoting a milestone.
