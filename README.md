# Screenshot Studio

Ship your product. Screenshot Studio turns what you build into content people understand.

Screenshot Studio started as a free, browser-based screenshot editor. It is growing into a
marketing platform for software founders. The editor is the creative engine. An AI copilot
plans campaigns. The platform renders assets, collects approval, and publishes.

**Live editor:** [screenshot-studio.com](https://screenshot-studio.com)

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
      Screenshot Studio   Trigger.dev       Postiz
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

- **100+ backgrounds** — gradients, solid colors, images, blur, noise
- **Browser mockups** — Safari and Chrome (light/dark) with realistic toolbars and custom URL
- **Device frames** — Arc browser, Polaroid, glass, outline, border styles
- **3D transforms** — 30+ perspective presets with realistic depth
- **Draw and markup** — arrows, shapes, blur regions, text overlays
- **Tweet and code snippets** — import tweets, generate code images
- **Animations** — 20+ presets, timeline editor, keyframe control
- **Video export** — MP4, WebM, GIF with hardware-accelerated encoding
- **High-res export** — PNG/JPG up to 5x scale, fully in-browser

### Capture API

- Captures any public URL through a screenshot provider
- Redis rate limiting and Postgres-backed caching with maintenance invalidation
- SSRF protection: rejects private-network targets, redirect escapes, and oversized images

### Workspace platform

- Better Auth with organizations, fixed RBAC, OIDC SSO, SCIM deactivation, and two-factor
- Audit logs with retention policies and signed SIEM drains
- Workspace-scoped assets, scoped API keys, and source-app webhooks
- Brand kits, creative templates, variant approval, and scheduled posts through Postiz
- Durable background execution on Trigger.dev with outbox recovery

## Roadmap

The build order, in sequence:

1. **`MarketingAgent` with 8–10 typed tools** on the
   [Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
   A constrained environment with strong tools — no autonomous browsing, no direct data access.
2. **One primary workflow: `URL → Launch Pack`.** The founder enters an app URL and one
   sentence. The system analyzes the site, captures relevant screens, generates campaign
   angles, builds assets from existing templates, writes channel-specific copy, and shows an
   approval screen. Nothing publishes automatically.
3. **The editor as the agent's rendering API.** The agent does not "make an image". It calls
   `createCreative({template, captureId, headline, perspective, brandKitId})` and the editor
   renders the asset deterministically.
4. **Durable agent execution on [Trigger.dev](https://trigger.dev/changelog/v4-5-0).**
   Campaign generation fans out into capture, copy, render, and scheduling jobs. The run
   pauses for human approval before `publishPost`.
5. **[Postiz OAuth](https://postiz.com/blog/direct-postiz-integration-oauth-api) as the social
   infrastructure.** Users connect their accounts once. The platform never stores their API keys.
6. **Three recipes before any autonomy:** `Launch a product`, `Announce a feature`, and
   `Keep my product visible`.
7. **Close the feedback loop.** Post performance flows back through Postiz. The agent gains
   `getCampaignPerformance()`, `findWinningHooks()`, and `generateFollowupCampaign()`.

The first tool surface stays deliberately small:

```ts
const marketingTools = {
  getProductContext,
  getBrandKit,

  captureProductPage,
  captureElement,

  createScreenshotCreative,
  createCarousel,
  createAnimatedDemo,

  generateSocialCopy,

  createCampaign,
  requestCampaignApproval,

  listSocialChannels,
  scheduleSocialPost,
}
```

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
          │                 │              Screenshot Studio
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

Open [localhost:3000](http://localhost:3000).

## Deployment

The app ships a production Docker image, a portable Helm chart, Fly.io deployment
configuration, and GitHub Actions workflows. See [deployment instructions](docs/deployment.md).

For the hot-reload local stack, Trigger.dev development worker, Supabase Storage, MinIO, and
Kind commands, see [local development](docs/local-development.md). Start with `make help` to
view the team workflow.

Better Auth, fixed organization RBAC, SSO, SCIM, audit logs, retention, and SIEM drains are
documented in [authentication and enterprise access](docs/authentication.md).

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Prisma · Zustand · Radix UI · Motion ·
FFmpeg WASM · WebCodecs · Trigger.dev · Postiz

## Acknowledgements

Built on the open-source
[Screenshot Studio](https://github.com/KartikLabhshetwar/screenshot-studio) editor by
Kartik Labhshetwar.
