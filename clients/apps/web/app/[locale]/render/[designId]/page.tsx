import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DesignRenderStage } from '@/components/design/DesignRenderStage'
import type { TenantContext } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import { getDesignAssetIds } from '@/lib/design/document'
import { verifyRenderToken } from '@/lib/design/render-token'
import { readTenantObject } from '@/lib/storage/client'
import { getDesign } from '@/lib/tenant/designs'

export const metadata: Metadata = { robots: { follow: false, index: false } }

type RenderPageProps = {
  params: Promise<{ designId: string }>
  searchParams: Promise<{ format?: string; scale?: string; token?: string }>
}

/**
 * Chrome-free stage for the headless renderer. Only a valid render token for
 * this design opens it. Workspace images are inlined as data URLs so the
 * editor's DOM capture never sees a cross-origin (canvas-tainting) image and
 * the page needs no storage session.
 */
export default async function RenderPage({ params, searchParams }: RenderPageProps) {
  const [{ designId }, { format, scale, token }] = await Promise.all([params, searchParams])
  const claims = verifyRenderToken(token, designId)
  if (!claims) notFound()
  // The renderer is a service caller: it reads through the service path.
  const tenant: TenantContext = {
    organizationId: claims.organizationId,
    principal: {
      kind: 'trigger_service',
      organizationId: claims.organizationId,
      taskRunId: designId,
    },
    requestId: designId,
  }
  const design = await getDesign(tenant, designId)
  if (!design) notFound()

  const assetIds = getDesignAssetIds(design.document)
  const { assets } = assetIds.length
    ? await backendSDK(tenant).findAssets({ ids: assetIds })
    : { assets: [] }
  const sources: Record<string, string> = {}
  for (const asset of assets.filter((item) => item.status === 'UPLOADED')) {
    const bytes = await readTenantObject({
      assetId: asset.id,
      tenant,
    })
    sources[`asset:${asset.id}`] =
      `data:${asset.mediaType};base64,${Buffer.from(bytes).toString('base64')}`
  }

  // The editor's defaults: PNG at 2x.
  const output = {
    format: format === 'jpeg' || format === 'webp' ? format : 'png',
    scale: scale === '1' ? 1 : scale === '3' ? 3 : 2,
  } as const

  return <DesignRenderStage document={design.document} output={output} sources={sources} />
}
