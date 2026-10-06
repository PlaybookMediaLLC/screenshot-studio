import 'server-only'

import type { TenantContext } from '@/lib/auth/access'
import { DESIGN_RENDER_RATE_LIMIT } from '@/lib/api/rate-limit-policy'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { readTenantObject } from '@/lib/storage/client'
import { storeGeneratedAsset } from '@/lib/tenant/assets'
import { setDesignRender } from '@/lib/tenant/designs'
import { type DesignDocument, getDesignAssetIds } from './document'
import { designRenderKey } from './render-key'
import type { DesignRenderer, DesignRenderOptions } from './renderer'

/**
 * Render a design for a workspace, reusing an identical render when one exists.
 *
 * Every render path (the campaign agent, editor directions) goes through here:
 *
 * - **Cache.** The render key hashes the document, the output options, and
 *   the content of every referenced image. A design with the same key anywhere
 *   in the workspace (the same design re-checked, or an identical variant)
 *   reuses its stored image instead of rendering again.
 * - **Fairness.** Real renders are limited per workspace so one burst cannot
 *   crowd out everyone on the shared render service. Cache hits are free.
 */

export class DesignRenderLimitError extends Error {
  constructor() {
    super('This workspace is rendering too fast. Wait a minute and try again.')
    this.name = 'DesignRenderLimitError'
  }
}

export type TenantRender = {
  asset: { id: string; mediaType: string; objectKey: string }
  cached: boolean
  height: number
  /** The image bytes; read from storage only when a caller needs them. */
  readBytes: () => Promise<Uint8Array>
  width: number
}

async function assetFingerprints(organizationId: string, document: DesignDocument) {
  const ids = getDesignAssetIds(document)
  if (ids.length === 0) return {}
  const assets = await prisma.asset.findMany({
    select: { id: true, sha256: true, updatedAt: true },
    where: { id: { in: ids }, organizationId },
  })
  return Object.fromEntries(
    assets.map((asset) => [asset.id, asset.sha256 ?? `updated:${asset.updatedAt.toISOString()}`])
  )
}

async function enforceRenderLimit(organizationId: string) {
  try {
    const result = await checkRateLimit(`design-render:${organizationId}`, DESIGN_RENDER_RATE_LIMIT)
    if (!result.allowed) throw new DesignRenderLimitError()
  } catch (error) {
    if (error instanceof DesignRenderLimitError) throw error
    // The render service bounds its own load; a Redis outage should not stop
    // workspaces from rendering, so the per-workspace limit fails open.
    console.warn('Design render limit check failed; allowing render.', error)
  }
}

export async function renderDesignForTenant(
  tenant: TenantContext,
  getRenderer: () => Promise<DesignRenderer>,
  design: { document: DesignDocument; id: string },
  options: DesignRenderOptions = {}
): Promise<TenantRender> {
  const { organizationId } = tenant
  const output = { format: options.format ?? 'png', scale: options.scale ?? 2 } as const
  const renderKey = designRenderKey({
    assets: await assetFingerprints(organizationId, design.document),
    document: design.document,
    options: output,
  })

  const hit = await prisma.design.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: {
      renderedAsset: {
        select: {
          height: true,
          id: true,
          mediaType: true,
          objectKey: true,
          status: true,
          width: true,
        },
      },
    },
    where: { organizationId, renderKey, renderedAssetId: { not: null } },
  })
  const cached = hit?.renderedAsset
  if (cached?.status === 'UPLOADED' && cached.width && cached.height) {
    await setDesignRender(tenant, design.id, cached.id, renderKey)
    return {
      asset: cached,
      cached: true,
      height: cached.height,
      readBytes: () => readTenantObject({ objectKey: cached.objectKey, organizationId }),
      width: cached.width,
    }
  }

  await enforceRenderLimit(organizationId)
  const rendered = await (await getRenderer()).render(design.id, organizationId, output)
  const extension = output.format === 'jpeg' ? 'jpg' : output.format
  const asset = await storeGeneratedAsset(tenant, {
    body: rendered.bytes,
    classification: 'export',
    contentType: rendered.mediaType,
    fileName: `design.${extension}`,
    height: rendered.height,
    width: rendered.width,
  })
  await setDesignRender(tenant, design.id, asset.id, renderKey)
  return {
    asset,
    cached: false,
    height: rendered.height,
    readBytes: async () => rendered.bytes,
    width: rendered.width,
  }
}
