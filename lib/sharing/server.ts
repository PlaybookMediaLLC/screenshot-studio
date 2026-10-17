import 'server-only'

import type { TenantContext } from '@/lib/auth/access'
import { backendSDK, orNull, serviceBackend } from '@/lib/backend/sdk'
import {
  expiryDate,
  type ShareLink,
  type ShareLinkCreateInput,
  shareLinkSchema,
  type ShareLinkUpdateInput,
  type ShareMediaVariant,
} from './schema'

/** The workspace's share links, newest first. */
export async function listShareLinks(context: TenantContext): Promise<ShareLink[]> {
  const { shareLinks } = await backendSDK(context).listShareLinks()
  return shareLinks.map((link) => shareLinkSchema.parse(link))
}

/** One of the workspace's links by id, or null. */
export async function getShareLink(context: TenantContext, id: string): Promise<ShareLink | null> {
  const link = await orNull(backendSDK(context).getShareLink(id))
  return link && shareLinkSchema.parse(link)
}

/** Publish an uploaded asset at a new link. */
export async function createShareLink(
  context: TenantContext,
  input: ShareLinkCreateInput
): Promise<ShareLink> {
  const { expiry, ...rest } = input
  return shareLinkSchema.parse(
    await backendSDK(context).createShareLink({ ...rest, expiresAt: expiryDate(expiry) })
  )
}

/** Change a live link's text, access, or lifetime (counted from now). */
export async function updateShareLink(
  context: TenantContext,
  input: ShareLinkUpdateInput
): Promise<ShareLink> {
  const { altText, description, expiry, id, ...rest } = input
  return shareLinkSchema.parse(
    await backendSDK(context).updateShareLink(id, {
      ...rest,
      // The backend clears a text field on an empty string (null means "unchanged").
      ...(altText !== undefined ? { altText: altText ?? '' } : {}),
      ...(description !== undefined ? { description: description ?? '' } : {}),
      ...(expiry === 'never'
        ? { clearExpiry: true }
        : expiry
          ? { expiresAt: expiryDate(expiry) }
          : {}),
    })
  )
}

/** Turn a link off for good. */
export async function revokeShareLink(context: TenantContext, id: string): Promise<void> {
  await backendSDK(context).revokeShareLink(id)
}

/** A live link by its token, or null when unknown, revoked, or expired. */
export function resolveShareLink(token: string) {
  return orNull(serviceBackend().resolveShareLink(token))
}

/** A short-lived signed URL for a live link's media or poster, or null. */
export function signedShareMedia(token: string, variant: ShareMediaVariant) {
  return orNull(serviceBackend().shareLinkObjectUrl(token, variant))
}
