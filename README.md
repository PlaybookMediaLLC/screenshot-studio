# Shots

Ship your product. Shots turns what you build into content people understand.

Shots started as a free, browser-based screenshot editor. It is growing into a
marketing platform for software founders. The editor is the creative engine. An AI copilot
plans campaigns. The platform renders assets, collects approval, and publishes.

**Live platform and editor:** [shots.playbookmedia.io](https://shots.playbookmedia.io) ·
**Image tools:** [shots.playbookmedia.io/tools](https://shots.playbookmedia.io/tools) ·
**Code to image:** [shots.playbookmedia.io/code](https://shots.playbookmedia.io/code)

## The thesis

Founders ship features. Turning those features into marketing content is slow, manual work.
The platform already captures products, composes visuals, applies brand kits, renders images
and video, manages approvals, stores assets, runs durable jobs, and publishes through Postiz.

The missing layer is small:

**intent → plan → tool calls → marketing assets → approval → distribution**

The target experience:

> Paste your app URL. Tell us what you are launching. Get a ready-to-publish marketing campaign.

```text
                     ┌─────────────────────┐
                     │     Founder         │
                     │ "Market my launch"  │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │ Marketing Copilot   │
                     │   Vercel AI SDK     │
                     └──────────┬──────────┘
                                │
                       reasoning / planning
                                │
                                ▼
                  ┌───────────────────────────┐
                  │     Marketing Tools       │
                  │                           │
                  │ analyze_product           │
                  │ capture_page              │
                  │ generate_copy             │
                  │ create_creative           │
                  │ create_demo               │
                  │ apply_brand_kit           │
                  │ create_variants           │
                  │ request_approval          │
                  │ schedule_post             │
                  │ get_post_performance      │
                  └────────────┬──────────────┘
                               │
             ┌─────────────────┼────────────────┐
             ▼                 ▼                ▼
      Shots   Temporal          Postiz
      rendering engine    durable work      publishing
```

The model decides **what to do**. The application decides **how it is done safely**. Every
tool takes a `workspaceId`, validates input with Zod, and calls the same domain services as
the UI. The agent never touches the database or the canvas directly.

Campaigns are structured objects, not chat output:
`Campaign → CampaignBrief → ContentIdeas → Creatives → Posts → Publication`.
The LLM produces structured intent. The database owns the campaign. A founder can regenerate
one image, change one hook, move a post, or approve three posts without replaying a
conversation.

## What works today

### Creative engine (the editor)

One document model and one renderer behind every surface: what the editor
shows is what previews, batch items, every export size, and share links show.
See [docs/editor-platform.md](docs/editor-platform.md).

- **Composition**: several screenshots per canvas (side-by-side, stack, grid, bento, fan); snapping to objects and canvas, thirds, platform safe zones, and App Store crops; zoom callouts, spotlights, numbered badges, and cursors
- **Frames**: in-house device frames (iPhone, Pixel, Galaxy, iPad, MacBook, iMac, Studio Display, Vision Pro) in colours and orientations; Safari, Chrome, Arc, Edge, and Firefox chrome with tabs, bookmarks, and auto appearance; macOS and Windows windows, terminals, and code-to-image
- **Text**: Google Fonts, gradient text, shrink-to-fit, and headline/subheadline templates
- **Motion**: preset animations, keyframes with a cubic Bézier editor, typewriter and word reveals, scroll-through inside frames, audio tracks, and burned-in captions
- **Brand and presets**: workspace brand kits (colours, fonts, logos, background and frame defaults) applied without losing overrides; saved presets that restyle any screenshot
- **Redaction**: on-device detection of emails, keys, cards, names, and faces, reviewed and then drawn into the pixels so exports keep nothing underneath
- **Export**: PNG, JPEG, WebP, SVG, PDF, GIF, MP4, and WebM; several sizes in one ZIP, each laid out again; batch mode for up to 50 screenshots
- **Share**: publish a design at a link with Open Graph previews, embeds, access control, and expiry; deliver it to Slack, Notion, or Figma
- **AI**: a copilot that edits the canvas, side-by-side versions of a design, generated backgrounds, and platform captions with alt text
- **Projects**: cloud projects with autosave, named versions, comparison, restore, and recovery after a reload
- **Image tools**: crop, resize, rotate, compress, format conversion, and background removal; a standalone code image editor at `/code`
- **App Store screenshots**: layered slides, multi-device and panoramic layouts, localization, store compliance checks, every-size export, review links, and App Store Connect and Google Play uploads ([guide](docs/store-screenshots.md))

### Capture API

- Captures any public URL through a screenshot provider
- Redis rate limiting and Postgres-backed caching with maintenance invalidation
- SSRF protection: rejects private-network targets, redirect escapes, and oversized images

### Workspace platform

- Better Auth with organizations, fixed RBAC, OIDC SSO, SCIM deactivation, and two-factor
- Audit logs with retention policies and signed SIEM drains
- Workspace-scoped assets, scoped API keys, and source-app webhooks
- Brand kits, creative templates, variant approval, and scheduled posts through Postiz
- Typed tRPC API for browser and API-key callers, with REST intake routes for machines
- Durable Go backend execution on Temporal with outbox recovery
- Paid plans only (Pro, Business, Enterprise) through Stripe Checkout and the billing portal, with metered AI credits and extra-launch credit packs; a workspace without a subscription has no access
- Launch intelligence: a release becomes a cited launch brief, a plan, visuals, and per-channel copy, each reviewed by a teammate (included in every paid plan through the `campaign:workflow` feature)
- Interactive API reference at `/api-reference` (Scalar), generated from the OpenAPI 3.1 contract at `/openapi.json`

## Roadmap

The design lives in [docs/rfcs/](docs/rfcs/). The status below was checked against the
code on 2026-10-16, not taken from the RFCs' own status lines. The critical path is the
promise in [009](docs/rfcs/009-marketing-platform-thesis.md): a founder pastes a URL, gets seven good posts
built from real product screenshots, approves them, and schedules them.

### Where each RFC stands

| Status      | RFCs                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shipped     | 007 tRPC product surface; 034 phases 1–2 (zod contracts, OpenAPI 3.1, Scalar reference); 035 paid plans, Stripe billing, credit metering                                                                                                                                                                                                                                |
| Partial     | 002 tenant data model; 003 auth, enterprise, audit; 005 inbound webhooks and GitHub App; 006 asset pipeline; 009 thesis (V1 and part of V2); 010 creative engine; 011 brand profile; 013 product surfaces; 014 campaign objects; 016 AI tools; 017 campaign chat; 018 campaign workspace; 019 approval; 020 publishing; 021 core workflows; 022 GitHub integration; 023 deployment capture; 032 onboarding fast path |
| Not started | 008, 012, 024, 025, 026, 027, 028, 029, 030, 031, 037                                                                                                                                                                                                                                                                                                         |
| Superseded  | 001 (by the AI launch pipeline); 004 (by Temporal); 015 (by the launch pipeline in `lib/ai/launch`); 033 (by 037, npm workspaces with the app at the root)                                                                                                                                                                                                              |

There is no free plan. Every workspace needs an active subscription to use the editor, the
tools, or the API ([035](docs/rfcs/035-pricing-and-unit-economics.md)).

### Implementation plan

Each step builds only on the steps before it.

**Phase 0: fix what is broken now that every customer pays**

Status as of 2026-10-16: done, including the campaign UI for steps 2, 3, and 5 (#129).

1. **Paywall experience** ([035](docs/rfcs/035-pricing-and-unit-economics.md)), done
   - `/pricing` explains why someone was sent there and what happened after checkout or a credit purchase.
   - Checkout success returns to the app and applies the plan at once, without waiting for the webhook.
   - Onboarding has a "Choose a plan" step.
   - Workspace settings have a Billing section: plan, status, AI credits, posts, and emails left, the extra launch credit balance, and the billing portal.
   - Credit packs require a subscription. There is no trial.
   - Seat and social channel limits are enforced per plan; a workspace has one product.
2. **Approve → schedule → publish end to end** ([020](docs/rfcs/020-postiz-publishing.md), [014](docs/rfcs/014-structured-marketing-objects.md))
   - Done: approving a launch visual creates an approved creative variant, and scheduling attaches it to the post.
   - Done: the post channel must match the connected platform.
   - Done: a cancelled or failed post can be rescheduled, but a post whose delivery is uncertain never is.
   - Posts report their scheduled post's state.
   - Next: the Approve visual, Schedule, and Channels screens.
3. **Approved content can't change** ([014](docs/rfcs/014-structured-marketing-objects.md), [019](docs/rfcs/019-approval-workflow.md)), done
   - Approval records who approved a post and when.
   - Revising an approved post sends it back to draft.
   - Revising a live scheduled or published post is refused.
4. **Security check**, done: approvals and scheduling refuse API-key, service, webhook, and support actors in the backend itself, with a test for every entrypoint.
5. **Launch runs** ([004](docs/rfcs/004-trigger-dev-background-jobs.md))
   - Done: the database enforces one active run per kind.
   - Done: runs carry a heartbeat lease, so a dead run fails within minutes.
   - Done: runs can be cancelled.
   - Next: the web heartbeat and the Cancel button.
6. **Production data cutover** ([002](docs/rfcs/002-planetscale-tenant-data-model.md))
   - Done: the Go single-database cutover is applied in production (verified 2026-10-16).
   - Done: a trigger makes `audit_log` append-only; only the retention purge deletes rows.
   - Next: run the tenant-isolation matrix against a non-production deployment.

**Phase 1: the critical path**, done (#129, #131)

A founder pastes their URL during onboarding, reviews the product profile Shots drafts,
and gets a launch campaign of seven posts with real product screenshots to approve and
schedule.

7. **Brand profile enforcement** ([011](docs/rfcs/011-brand-profile.md)), done
   - Strict brand kits with a logo upload and a contrast warning.
   - Prohibited terms with a reason and match mode, checked in the backend on every copy write and before scheduling.
8. **Product asset map** ([013](docs/rfcs/013-product-asset-map.md))
   - Done: capture history per product page, freshness, failure reasons, capture now.
   - Done: lookup by feature, which planning uses.
   - Done: deployment captures are recorded.
   - Next: release screenshots as captures.
9. **Product intelligence and the onboarding agent** ([012](docs/rfcs/012-product-intelligence.md), [032](docs/rfcs/032-background-onboarding-agent.md))
   - Done: a cited product profile with per-field provenance and locks on your edits.
   - Done: the "Your product" onboarding step reads the site in about 20 seconds.
   - Next: a background crawl and the ideal-customer profile.
10. **Workflow 1, URL → seven posts** ([021](docs/rfcs/021-core-workflows.md)), done
    - Confirming the profile builds the first launch campaign and lands on Copy.
    - From Copy: batch approve, connect a channel, schedule.
    - Funnel events at start, confirm, and ready.
11. **Campaign workspace** ([018](docs/rfcs/018-campaign-workspace.md)), done
    - Inline editing with autosave and conflict handling.
    - Approve all or selected.
    - Keep or discard when revising.
    - Campaigns are included in every paid plan.
12. **Approval details** ([019](docs/rfcs/019-approval-workflow.md)), done
    - Who decided and when.
    - Email notifications on submit and decision.
    - Per-channel length limits.
    - API-key submit-for-review.

**Phase 2: the AI agent layer**

13. **Marketing tools runtime** ([016](docs/rfcs/016-ai-sdk-marketing-tools.md))
    - Capability records per tool.
    - A step trace and per-tool audit entries.
    - Loop detection and a per-workspace kill switch.
    - A red-team pass.
14. **Conversational campaign creation** ([017](docs/rfcs/017-conversational-campaign-creation.md)).

**Phase 3: product changes become campaigns**

15. **GitHub suggestions** ([022](docs/rfcs/022-github-integration.md))
    - Filters for chores and opted-out PRs.
    - Accept or dismiss a suggested campaign.
    - Digests.
16. **Deployment captures** ([023](docs/rfcs/023-deployment-screenshot-automation.md))
    - Readiness checks.
    - Capture only the changed pages.
    - Before/after comparison against baselines.

**Phase 4: measure, then improve**

17. **Analytics ingestion** ([027](docs/rfcs/027-analytics-ingestion.md)): post metrics through the existing Postiz analytics endpoint.
18. **Feedback-driven generation** ([028](docs/rfcs/028-feedback-driven-generation.md)): report-only first, then bounded adjustments.

**Phase 5: recurring work and autonomy**

19. Content pillars and a weekly calendar ([025](docs/rfcs/025-content-pillars.md)).
20. Recurring campaigns ([029](docs/rfcs/029-recurring-campaign-generation.md)).
21. Approval policies ([030](docs/rfcs/030-approval-policies.md)).
22. Autonomy modes ([031](docs/rfcs/031-autonomy-modes.md)): Manual and Copilot first, then Autopilot.

**Phase 6: expansion**

23. Demo videos ([024](docs/rfcs/024-demo-video-generation.md)).
24. External research ([026](docs/rfcs/026-external-research-tools.md)).
25. Outbound webhooks ([005](docs/rfcs/005-repository-webhook-scheduler-integrations.md)).
26. REST API phase 3 ([034](docs/rfcs/034-rest-api-scalar-reference.md))
    - Campaign, approval, and scheduled-post endpoints.
    - A generated client.
    - An OpenAPI diff check in CI.
27. Creative engine render API and compose helpers ([010](docs/rfcs/010-programmable-creative-engine.md)).
28. Enterprise remainder ([003](docs/rfcs/003-better-auth-enterprise-audit.md)): support-access approvals and required two-factor.
29. Asset verification and quarantine ([006](docs/rfcs/006-release-inputs-and-artifact-pipeline.md)).
30. Store provider verification ([036](docs/rfcs/036-store-provider-e2e-verification.md)): fake Google Play, App Store Connect, Figma, and AI providers on every PR; live runs against test accounts nightly.
31. Workspaces and content drafts ([037](docs/rfcs/037-workspaces-and-content-drafts.md)): npm workspaces, the vendored Plate.js editor, manual drafts scheduled to several channels, and real-time co-editing.
32. MCP server and agent integrations ([038](docs/rfcs/038-mcp-and-agent-integrations.md)): Shots tools on the Go MCP server with workspace API keys and OAuth, schemas from `/openapi.json`, and setup guides for Claude, ChatGPT, and coding agents.

## Where this goes

Onboarding becomes the product. A new user types their URL. The system crawls a few public
pages, derives the product, audience, problems, brand, and content pillars, and generates the
first seven posts on a calendar — built from their actual application.

Later, GitHub closes the loop. A merged PR that looks externally meaningful triggers a
pipeline: understand the diff, capture the new UI, generate before/after assets, write the
announcement, and place the posts in the approval queue. Shipping the product creates the raw
material for marketing the product.

```text
                         PRODUCT
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
        Website           GitHub           Product
          │                 │               events
          └─────────────────┼─────────────────┘
                            ▼
                    Product Intelligence
                            │
                            ▼
                     Marketing Agent
                            │
          ┌─────────────────┼───────────────────────┐
          ▼                 ▼                       ▼
        Ideas              Copy                  Creative
          │                 │              Shots
          └─────────────────┴───────────────────────┐
                                                    ▼
                                                Campaign
                                                    │
                                                 Approval
                                                    │
                                                    ▼
                                                  Postiz
                                                    │
                                  ┌─────────────────┼──────────────┐
                                  ▼                 ▼              ▼
                                  X              LinkedIn       Instagram
                                                    │
                                                    ▼
                                                Analytics → the agent learns
```

The editor stays valuable on its own. Founders can open any generated asset and change it by
hand. The moat compounds: product context + brand context + deterministic rendering +
distribution + performance history.

## Quick start

```bash
git clone https://github.com/PlaybookMediaLLC/screenshot-studio.git
cd screenshot-studio
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Core features need no environment variables; see `.env.example` for optional R2, database, and analytics config.

## Agent and API discovery

The deployed product publishes machine-readable interfaces for agents and API clients:

- [`llms.txt`](https://shots.playbookmedia.io/llms.txt) and
  [`llms-full.txt`](https://shots.playbookmedia.io/llms-full.txt)
- [OpenAPI 3.1 specification](https://shots.playbookmedia.io/openapi.json)
- [API documentation](https://shots.playbookmedia.io/docs) and
  [developer portal](https://shots.playbookmedia.io/developers)
- Markdown representations of supported pages via `Accept: text/markdown`

## Deployment

The app ships production Docker images, a portable Helm chart, and GitHub
Actions workflows for DigitalOcean App Platform. See [deployment instructions](docs/deployment.md).

For the hot-reload local stack, Temporal Go workers, RustFS, and Kind commands,
see [local development](docs/local-development.md). Start with `make help` to view
the team workflow.

Better Auth, fixed organization RBAC, SSO, SCIM, audit logs, retention, and SIEM drains are
documented in [authentication and enterprise access](docs/authentication.md).

The backend is Playbook Core, the organization control plane every Playbook shell
uses. Its API classes, the `/api/v1/bootstrap` shell contract, ownership rules for
other repositories, and the campaign workflow rollout are documented in
[Playbook Core](docs/playbook-core.md).

Campaigns built from a release run through a reviewable AI pipeline: a cited
product spec drafted from the release's sources (with prompt-injection
defenses), a campaign plan, on-brand visuals that review themselves, channel
copy traceable to the spec, and AI revisions a reviewer applies or discards.
See [launch intelligence](docs/launch-intelligence.md).

Email templating, release announcements, audience consent, and unsubscribe
handling are documented in
[customer email and release broadcast](docs/email-and-broadcast.md).

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Go · Ent · PostgreSQL · Zustand · Radix UI ·
Motion · FFmpeg WASM · WebCodecs · Temporal · Postiz

## Third-party providers

Services the deployed application depends on. Each row lists the environment
variables that configure it, so you can trace a credential back to its console.

### Required to run

| Provider                                                                                                           | Role                                               | Environment variables                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform)                                    | Application hosting                                | `DIGITALOCEAN_PRODUCTION_TOKEN` (CI only)                                                                                              |
| [PlanetScale](https://planetscale.com) ([console](https://app.planetscale.com))                                    | Managed Postgres, primary datastore                | `DATABASE_URL`                                                                                                                         |
| [Upstash](https://upstash.com) ([console](https://console.upstash.com))                                            | Serverless Redis for rate limiting and caching     | `REDIS_URL`                                                                                                                            |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) ([dashboard](https://dash.cloudflare.com/?to=/:account/r2)) | Object storage for exports, uploads, and assets    | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_REGION`, `NEXT_PUBLIC_R2_PUBLIC_URL` |
| [Better Auth](https://www.better-auth.com) ([docs](https://www.better-auth.com/docs))                              | Authentication, sessions, organization RBAC        | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`                                                                 |
| [Resend](https://resend.com) ([dashboard](https://resend.com/overview))                                            | Verification, password reset, and invitation email | `RESEND_API_KEY`, `AUTH_EMAIL_FROM`                                                                                                    |

Temporal runs publishing and maintenance in the Go backend. See
[production deployment](docs/digitalocean-deployment.md) for schedules and credentials.

### Optional integrations

| Provider                                                                                                                                  | Role                                                                                                                                 | Environment variables                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [Postiz](https://postiz.com) ([docs](https://docs.postiz.com))                                                                            | Social scheduling and publishing                                                                                                     | `POSTIZ_API_URL`                                                                                                          |
| [Microlink](https://microlink.io) ([docs](https://microlink.io/docs))                                                                     | Screenshot capture API                                                                                                               | `SCREENSHOT_API_URL`                                                                                                      |
| [OpenRouter](https://openrouter.ai) ([models](https://openrouter.ai/models))                                                              | Model access for the campaign studio, editor copilot, captions, and AI backgrounds                                                   | `OPENROUTER_API_KEY`, optional `PLATFORM_AI_MODEL_*`, `PLATFORM_AI_IMAGE_MODEL`                                           |
| [Slack](https://api.slack.com/apps), [Notion](https://www.notion.so/profile/integrations), [Figma](https://www.figma.com/developers/apps) | Delivering published designs ([setup](docs/integrations.md))                                                                         | `INTEGRATION_ENCRYPTION_KEY`, `{SLACK,NOTION,FIGMA}_CLIENT_ID`, `{SLACK,NOTION,FIGMA}_CLIENT_SECRET`                      |
| [PostHog](https://posthog.com) ([app](https://app.posthog.com))                                                                           | Product analytics and session insight                                                                                                | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`                                                                     |
| [Google Cloud](https://console.cloud.google.com/apis/credentials)                                                                         | Google OAuth sign-in                                                                                                                 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                                |
| [GitHub OAuth](https://github.com/settings/developers)                                                                                    | GitHub sign-in and release intake                                                                                                    | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                                                                |
| [Microsoft Entra ID](https://entra.microsoft.com)                                                                                         | Microsoft SSO for enterprise tenants                                                                                                 | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                                                                          |
| Billing provider or support automation                                                                                                    | Signed workspace plan and entitlement synchronization                                                                                | `BILLING_ENTITLEMENT_WEBHOOK_SECRET`                                                                                      |
| [Stripe](https://stripe.com) ([dashboard](https://dashboard.stripe.com))                                                                  | Self-serve Checkout, billing portal, and extra-launch credit packs; events at `/api/webhooks/stripe` sync the plan and grant credits | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{PRO,BUSINESS}_{MONTHLY,ANNUAL}`, `STRIPE_PRICE_EXTRA_LAUNCH` |

Runtime credentials live in Fly secrets (`fly secrets set`), never in the repo or
in GitHub secrets. GitHub holds only the deploy token and the build-time
`NEXT_PUBLIC_*` variables, which are compiled into the client bundle and are
therefore public by design.
