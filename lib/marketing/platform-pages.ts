import type { Metadata } from 'next'
import { z } from 'zod'
import { OG_DEFAULTS } from '@/lib/seo/metadata'

/**
 * Public marketing pages for the platform. One registry feeds page metadata,
 * the navigation and footer, the sitemap, and the Markdown alternates agents
 * read, so a page added here shows up everywhere at once.
 */

/** Every platform marketing route. */
export const platformPagePathSchema = z.enum([
  '/pricing',
  '/product',
  '/product/launch-intelligence',
  '/product/creative-engine',
  '/product/approvals',
  '/product/publishing',
  '/product/release-intake',
  '/product/guardrails',
  '/use-cases',
  '/use-cases/feature-launches',
  '/use-cases/product-launches',
  '/use-cases/changelog-and-email',
  '/solutions/founders',
  '/solutions/product-marketing',
  '/solutions/developer-tools',
  '/integrations',
  '/security',
  '/enterprise',
  '/roadmap',
  '/design-partners',
  '/principles',
])

/** A platform marketing route. */
export type PlatformPagePath = z.infer<typeof platformPagePathSchema>

/** Menu a page belongs to in the navigation. */
export const navGroupSchema = z.enum(['product', 'solutions', 'developers', 'company'])

/** Menu a page belongs to in the navigation. */
export type NavGroup = z.infer<typeof navGroupSchema>

/** Everything the site needs to know about one platform page. */
export type PlatformPage = {
  /** Browser title. The root layout appends the brand. */
  title: string
  /** Meta and Open Graph description. */
  description: string
  /** Short label for menus and cards. */
  label: string
  /** One line under the label in menus and cards. */
  blurb: string
  /** Navigation menu, or null for pages reached another way. */
  group: NavGroup | null
  /** Markdown alternate summary for agents. */
  summary: string
  /** Markdown alternate bullet points for agents. */
  points?: string[]
}

const P = platformPagePathSchema.enum
const G = navGroupSchema.enum

/** The registry itself, in menu order within each group. */
export const PLATFORM_PAGES: Record<PlatformPagePath, PlatformPage> = {
  [P['/product']]: {
    title: 'Product: Release to Launch in One Workspace',
    description:
      'The Screenshot Studio platform: release intake, launch intelligence, the creative engine, approvals, publishing, and guardrails, in one workspace.',
    label: 'Overview',
    blurb: 'Every part, one workspace',
    group: G.product,
    summary:
      'Overview of the Screenshot Studio platform. Six parts turn a release into a reviewed, scheduled launch: release intake, launch intelligence, the creative engine, approvals, publishing, and guardrails.',
  },
  [P['/product/launch-intelligence']]: {
    title: 'Launch Intelligence: Cited Specs, Plans, and Posts',
    description:
      'Launch intelligence turns a release into a cited launch spec, a campaign plan, on-brand visuals, and channel copy. Every claim cites a source. You approve each stage.',
    label: 'Launch intelligence',
    blurb: 'Cited spec, plan, visuals, and copy',
    group: G.product,
    summary:
      'Launch intelligence reads a release and its sources, drafts a cited launch spec, plans the campaign, produces on-brand visuals and channel copy, and proposes revisions a reviewer applies or discards. Claims without a source become open questions.',
    points: [
      'Eleven spec sections, each claim citing the brief or a numbered source',
      'Plans with channel roles, angles, asset capture hints, and a teaser, launch day, and follow-up timeline',
      'Copy checked against channel limits, hype terms, prohibited terms, unknown links, and uncited claims',
      'Revisions arrive as proposals with word diffs; nothing changes until applied',
      'Team preferences retrieved from the workspace history at generation time',
    ],
  },
  [P['/product/creative-engine']]: {
    title: 'Creative Engine: Real Screenshots, Framed on Brand',
    description:
      'The open-source screenshot editor is the platform renderer. Captures of your live product are framed, branded, and rendered as editor designs you can change by hand.',
    label: 'Creative engine',
    blurb: 'The editor renders every asset',
    group: G.product,
    summary:
      'The creative engine is the Screenshot Studio editor used as a renderer. Agents capture the product surface and source pages, compose them in device and browser frames with the brand kit, and save editor designs that open for manual changes.',
  },
  [P['/product/approvals']]: {
    title: 'Approvals: A Server-Side Gate for Every Post',
    description:
      'Approval is a server-side state machine with six fixed roles. API keys and agents can draft, never approve. Batch approval is one transaction and one audit entry.',
    label: 'Approvals',
    blurb: 'Nothing ships without a person',
    group: G.product,
    summary:
      'Campaign posts move through DRAFT, READY_FOR_REVIEW, APPROVED or NEEDS_CHANGES or REJECTED, then SCHEDULED and PUBLISHED. Only signed-in members with the release:approve permission can approve. Batch approval is atomic and audited once.',
  },
  [P['/product/publishing']]: {
    title: 'Publishing: Scheduled Once, Published Exactly Once',
    description:
      'Approved posts run on durable workflows, are re-checked at send time, and are marked published only with a network receipt. Consented release email with one-click unsubscribe.',
    label: 'Publishing',
    blurb: 'Durable, receipted delivery',
    group: G.product,
    summary:
      'Publishing schedules approved posts on durable Temporal workflows. Each post is re-checked at send time, retried safely on rate limits, and marked published only with a confirmed receipt. Uncertain deliveries are held for a person. Social channels are in early access.',
  },
  [P['/product/release-intake']]: {
    title: 'Release Intake: REST API, Webhooks, and the Release Form',
    description:
      'Send releases from CI, a deploy hook, or a signed GitHub, GitLab, or custom webhook. Scoped API keys, idempotency keys, an OpenAPI 3.1 spec, and a stable error envelope.',
    label: 'Release intake',
    blurb: 'API, webhooks, and the form',
    group: G.developers,
    summary:
      'Releases enter through the release form, POST /api/v1/releases with an X-API-Key and an Idempotency-Key, or signed GitHub, GitLab, and generic webhooks to /api/webhooks/source/{sourceAppId}. Keys carry one of five scopes and cannot approve or publish.',
  },
  [P['/product/guardrails']]: {
    title: 'Guardrails: How Untrusted Sources Stay Evidence',
    description:
      'Prompt-injection defense, SSRF-safe fetching, enforced citations, copy guards, side-effect-free reading stages, and audited, metered AI actions.',
    label: 'Guardrails',
    blurb: 'Sources are evidence, not orders',
    group: G.product,
    summary:
      'Release sources are sanitized, fenced as untrusted, and flagged for instruction-like text before a model reads them. Fetching is SSRF-safe, citations are checked after generation, copy is guarded, and every AI action is metered and audited.',
  },
  [P['/use-cases']]: {
    title: 'Use Cases: Launches, Features, Changelogs, and Email',
    description:
      'What teams use Screenshot Studio for: feature launches, product launches, and release notes that reach the changelog and the inbox.',
    label: 'All use cases',
    blurb: 'What teams launch with it',
    group: G.solutions,
    summary:
      'Use cases for Screenshot Studio: announcing a shipped feature, planning a product launch across teaser, launch day, and follow-up, and turning release notes into a changelog entry and a consented email.',
  },
  [P['/use-cases/feature-launches']]: {
    title: 'Feature Launches: Announce What You Shipped the Same Day',
    description:
      'Turn a merged feature into a cited brief, real screenshots, and posts for X, LinkedIn, Instagram, Product Hunt, your changelog, and email, approved in one click.',
    label: 'Feature launches',
    blurb: 'Ship it, then say so',
    group: G.solutions,
    summary:
      'Feature launches with Screenshot Studio: describe the release or send it from GitHub, review the cited spec, approve a plan, and approve channel posts with real product screenshots in one batch.',
  },
  [P['/use-cases/product-launches']]: {
    title: 'Product Launches: Teaser, Launch Day, and Follow-Up',
    description:
      'Plan a product launch as a timeline: teaser, launch day, and follow-up, with assets in every format and Product Hunt copy inside its limits.',
    label: 'Product launches',
    blurb: 'A launch plan, not a scramble',
    group: G.solutions,
    summary:
      'Product launches with Screenshot Studio: a campaign plan split into teaser, launch day, and follow-up, hero and feature assets in 16:9, 1:1, 4:5, and 9:16, and channel copy checked against each channel limit.',
  },
  [P['/use-cases/changelog-and-email']]: {
    title: 'Changelog and Email: Release Notes People Read',
    description:
      'Turn every release into a changelog entry and a release email, sent only to consenting subscribers, with one-click unsubscribe and exactly one delivery per address.',
    label: 'Changelog and email',
    blurb: 'Release notes that land',
    group: G.solutions,
    summary:
      'Screenshot Studio drafts a changelog entry and an email announcement for each release. Release email goes only to consenting subscribers, honors per-organization unsubscribe and suppression, and delivers exactly once per address.',
  },
  [P['/solutions/founders']]: {
    title: 'For Founders: Marketing That Ships When You Do',
    description:
      'You build the product, review the PRs, and write the announcement. Screenshot Studio drafts the launch from your release so marketing stops waiting for a free afternoon.',
    label: 'Founders',
    blurb: 'For teams of one to ten',
    group: G.solutions,
    summary:
      'Screenshot Studio for founders: the release you already wrote becomes a cited brief, real screenshots, and channel posts. Self-approval is allowed, the editor is free, and nothing publishes without you.',
  },
  [P['/solutions/product-marketing']]: {
    title: 'For Product Marketing: From Brief to Launch Kit',
    description:
      'A cited spec as the single source of truth, plans you approve, creators, approvers, and publishers with separate permissions, and revisions you can diff.',
    label: 'Product marketing',
    blurb: 'One source of truth per launch',
    group: G.solutions,
    summary:
      'Screenshot Studio for product marketing teams: a versioned, cited launch spec, approved campaign plans, separate creator, approver, and publisher roles, brand kits on every design, and an audit trail of every decision.',
  },
  [P['/solutions/developer-tools']]: {
    title: 'For Developer Tools: Launches Your Users Trust',
    description:
      'For teams whose users read code: releases from CI or GitHub webhooks, claims that cite the pull request, code images, and machine-readable docs.',
    label: 'Developer tools',
    blurb: 'For products developers use',
    group: G.solutions,
    summary:
      'Screenshot Studio for developer tool companies: releases from CI or GitHub and GitLab webhooks, specs that cite the pull request, code-to-image rendering, changelog copy, and llms.txt and Markdown pages for agents.',
  },
  [P['/integrations']]: {
    title: 'Integrations: GitHub, GitLab, Social, Email, and SIEM',
    description:
      'Where Screenshot Studio connects: GitHub and GitLab release webhooks, the REST API, X, LinkedIn, and Instagram, release email, SSO providers, and Splunk and Datadog audit drains.',
    label: 'Integrations',
    blurb: 'Where it connects',
    group: G.developers,
    summary:
      'Screenshot Studio integrations, each marked available, early access, or planned: release intake from GitHub, GitLab, generic webhooks, and the REST API; publishing to X, LinkedIn, and Instagram; release email; Google, GitHub, and Microsoft sign-in with SAML and OIDC SSO; and Splunk, Datadog, and HTTPS audit drains.',
  },
  [P['/security']]: {
    title: 'Security: Every Control, Written Down',
    description:
      'How Screenshot Studio protects your workspace: SSO and SCIM, six roles, an append-only audit log, SIEM drains, tenant isolation, private storage, AI safeguards, and the providers we run on.',
    label: 'Security',
    blurb: 'Controls, data, and providers',
    group: G.company,
    summary:
      'Security at Screenshot Studio: Better Auth organizations with six roles, SAML and OIDC SSO, SCIM, TOTP two-factor, an append-only audit log with hashed IPs, signed SIEM drains, 90-day default retention with legal hold, organization-scoped private storage, and AI inputs treated as untrusted. Hosting is in the United States.',
  },
  [P['/enterprise']]: {
    title: 'Enterprise: SSO, SCIM, Audit Drains, and Legal Hold',
    description:
      'Screenshot Studio Enterprise: SAML and OIDC SSO, SCIM provisioning, Splunk and Datadog audit drains, extended retention, legal hold, enterprise quotas, and self-hosting.',
    label: 'Enterprise',
    blurb: 'For security reviews',
    group: G.company,
    summary:
      'Screenshot Studio Enterprise adds SAML and OIDC SSO, SCIM provisioning, signed audit drains to Splunk, Datadog, or any HTTPS endpoint, longer audit retention, legal hold, and the highest workspace quotas. The platform can also be self-hosted with Docker and Helm.',
  },
  [P['/pricing']]: {
    title: 'Pricing: Free, Pro, Business, and Enterprise',
    description:
      'Screenshot Studio plans and limits: AI credits, scheduled posts, and release emails per month, API writes per minute, concurrent jobs, and storage, from a free workspace to Enterprise.',
    label: 'Pricing',
    blurb: 'Plans and limits',
    group: null,
    summary:
      'Screenshot Studio workspace plans: Free ($0), Pro ($199 a month, or $169 billed annually), Business ($699 a month, or $594 billed annually), and Enterprise (from $3,000 a month, billed annually), with monthly generation, API write, concurrent job, and storage limits. The editor is free. Launch intelligence is in early access for design partners.',
  },
  [P['/roadmap']]: {
    title: 'Roadmap: What Ships Now and What Comes Next',
    description:
      'The public Screenshot Studio roadmap, from shipped primitives to URL onboarding, GitHub change detection, demo videos, the weekly plan, and autonomy modes.',
    label: 'Roadmap',
    blurb: 'Shipped, now, next, later',
    group: G.company,
    summary:
      'The Screenshot Studio roadmap, grouped as shipped, in progress, next, and later, with links to the RFC behind each item.',
  },
  [P['/design-partners']]: {
    title: 'Design Partners: Shape the Launch Platform',
    description:
      'Join the Screenshot Studio design partner program: early access to launch intelligence, a direct line to the team, and a say in what ships next.',
    label: 'Design partners',
    blurb: 'Early access program',
    group: G.company,
    summary:
      'The Screenshot Studio design partner program gives teams that ship every week early access to launch intelligence and a direct line to the builders, in exchange for real releases and honest feedback.',
  },
  [P['/principles']]: {
    title: 'Principles: How Screenshot Studio Is Built',
    description:
      'The decisions behind the platform: primitives before agents, recipes before autonomy, the workspace over chat, structural approval, and cite or ask.',
    label: 'Principles',
    blurb: 'How we build it',
    group: G.company,
    summary:
      'The design principles behind Screenshot Studio, quoted from its RFCs: freeze the promise, build inside-out, recipes before agents, the workspace over chat, approval as structure, cite or ask, and degrade into something useful.',
  },
}

/** Pages in a navigation group, in registry order. */
export function pagesInGroup(group: NavGroup): { path: PlatformPagePath; page: PlatformPage }[] {
  return platformPagePathSchema.options
    .filter((path) => PLATFORM_PAGES[path].group === group)
    .map((path) => ({ path, page: PLATFORM_PAGES[path] }))
}

/** Next.js metadata for a platform page, with canonical URL and Open Graph. */
export function platformMetadata(path: PlatformPagePath): Metadata {
  const { description, title } = PLATFORM_PAGES[path]
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...OG_DEFAULTS, title: `${title} | Screenshot Studio`, description, url: path },
  }
}

/** Markdown alternates for agents, one per platform page, in registry order. */
export function platformAgentPages(): {
  path: PlatformPagePath
  title: string
  summary: string
  points?: string[]
}[] {
  return platformPagePathSchema.options.map((path) => {
    const { points, summary, title } = PLATFORM_PAGES[path]
    return { path, title: `${title} - Screenshot Studio`, summary, points }
  })
}
