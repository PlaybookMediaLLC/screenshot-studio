import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CanvasPrint, type PrintArtboard } from '@/components/canvas-workspace/CanvasPrint'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import { artboardRect, artboardSize } from '@/lib/canvas/document'
import { readingOrder } from '@/lib/canvas/layout'
import { getDesignAssetIds, mapDesignSources } from '@/lib/design/document'
import { verifyRenderToken } from '@/lib/design/render-token'
import { readTenantObject } from '@/lib/storage/client'
import { getCanvas } from '@/lib/tenant/canvases'

export const metadata: Metadata = { robots: { follow: false, index: false } }

type PrintPageProps = {
  params: Promise<{ canvasId: string }>
  searchParams: Promise<{ token?: string; ids?: string }>
}

/**
 * Chrome-free print page for the headless renderer: the chosen artboards of
 * one canvas, one page each. Only a render token for this canvas opens it.
 * Workspace images are inlined as data URLs, as on the design render page.
 */
export default async function CanvasPrintPage({ params, searchParams }: PrintPageProps) {
  const [{ canvasId }, { token, ids }] = await Promise.all([params, searchParams])
  const claims = verifyRenderToken(token, `canvas:${canvasId}`)
  if (!claims) notFound()
  const tenant: TenantContext = {
    organizationId: claims.organizationId,
    principal: {
      kind: 'trigger_service',
      organizationId: claims.organizationId,
      taskRunId: `canvas-print:${canvasId}`,
    },
    requestId: `canvas-print:${canvasId}`,
  }
  const canvas = await getCanvas(tenant, canvasId)
  if (!canvas) notFound()
  const chosen = ids?.split(',').filter(Boolean) ?? canvas.document.artboards.map((item) => item.id)
  // Pages follow reading order, like every other canvas export.
  const artboards = readingOrder(
    canvas.document.artboards
      .filter((artboard) => chosen.includes(artboard.id))
      .map((artboard) => ({ id: artboard.id, rect: artboardRect(artboard), artboard }))
  ).map((item) => item.artboard)
  if (!artboards.length) notFound()

  const assetIds = [
    ...new Set(artboards.flatMap((artboard) => getDesignAssetIds(artboard.document))),
  ]
  const { assets } = assetIds.length
    ? await backendSDK(tenant).findAssets({ ids: assetIds })
    : { assets: [] }
  const sources: Record<string, string> = {}
  for (const asset of assets.filter((item) => item.status === 'UPLOADED')) {
    const bytes = await readTenantObject({ assetId: asset.id, tenant })
    sources[`asset:${asset.id}`] =
      `data:${asset.mediaType};base64,${Buffer.from(bytes).toString('base64')}`
  }
  const pages: PrintArtboard[] = artboards.map((artboard) => ({
    id: artboard.id,
    ...artboardSize(artboard),
    document: mapDesignSources(artboard.document, (ref) => sources[ref] ?? ref),
    raster: artboard.document.redactions.some((region) => region.visible !== false),
  }))
  return <CanvasPrint artboards={pages} />
}
