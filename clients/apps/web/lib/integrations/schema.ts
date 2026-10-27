import { z } from 'zod'

/**
 * Integrations deliver published work to Slack, Notion, and Figma through
 * each provider's own API and OAuth. Each provider gets what it supports:
 * Slack takes the file in a channel, Notion takes it as a block on a page,
 * Figma takes a comment linking the share page on a frame (Figma's REST API
 * cannot place images on a canvas; designs paste into Figma from the clipboard).
 */

/** A provider, as the backend stores it. */
export const integrationProviderSchema = z.enum(['SLACK', 'NOTION', 'FIGMA'])
/** An integration provider. */
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>

/** A provider as it appears in URLs: `/api/integrations/slack/connect`. */
export const providerSlugSchema = z.enum(['slack', 'notion', 'figma'])
/** A provider URL slug. */
export type ProviderSlug = z.infer<typeof providerSlugSchema>

/** The provider of a URL slug. */
export function providerOfSlug(slug: ProviderSlug): IntegrationProvider {
  return integrationProviderSchema.parse(slug.toUpperCase())
}

/** Display names. */
export const PROVIDER_NAMES: Record<IntegrationProvider, string> = {
  FIGMA: 'Figma',
  NOTION: 'Notion',
  SLACK: 'Slack',
}

/** A connection, without credentials. */
export const integrationSchema = z.object({
  createdAt: z.coerce.date(),
  displayName: z.string(),
  externalId: z.string(),
  id: z.string(),
  provider: integrationProviderSchema,
  scopes: z.array(z.string()),
  tokenExpiresAt: z.coerce.date().nullable(),
})
/** An integration connection. */
export type Integration = z.infer<typeof integrationSchema>

/** Where to deliver a share link. */
export const deliveryTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    channelId: z.string().regex(/^[CGD][A-Z0-9]{2,30}$/),
    kind: z.literal('slack'),
    message: z.string().max(3000).optional(),
  }),
  z.object({ kind: z.literal('notion'), pageId: z.string().regex(/^[0-9a-f-]{32,36}$/i) }),
  z.object({
    fileUrl: z.string().url().max(2000),
    kind: z.literal('figma'),
    message: z.string().max(3000).optional(),
  }),
])
/** A delivery target. */
export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>

/** Deliver a share link through a connection. */
export const deliverySchema = z.object({
  integrationId: z.string().cuid(),
  shareLinkId: z.string().cuid(),
  target: deliveryTargetSchema,
})

/** A Figma file (and optional frame) from a link copied in Figma. */
export function parseFigmaUrl(value: string): { fileKey: string; nodeId: string | null } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return null
  const match = url.pathname.match(/^\/(?:file|design|board|proto)\/([A-Za-z0-9]{10,64})(?:\/|$)/)
  if (!match) return null
  const node = url.searchParams.get('node-id')
  return {
    fileKey: match[1]!,
    nodeId: node && /^\d+[-:]\d+$/.test(node) ? node.replace('-', ':') : null,
  }
}
