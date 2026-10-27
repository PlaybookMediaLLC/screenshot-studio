import 'server-only'

import type { TenantContext } from '@/lib/auth/access'
import { enforceRenderLimit } from '@/lib/design/render-design'
import { createDesignRenderer, isDesignRendererReady } from '@/lib/design/renderer'
import { getCanvas } from '@/lib/tenant/canvases'

/** The deployment has no server renderer; image PDFs still work in the browser. */
export class CanvasPdfUnavailableError extends Error {
  constructor() {
    super('Selectable-text PDFs need the server renderer, which is off on this deployment.')
    this.name = 'CanvasPdfUnavailableError'
  }
}

/**
 * Print a canvas's artboards to one PDF through the server renderer: a page
 * per artboard at its own size, with real text and vector shapes. Null when
 * the canvas is not in this workspace or none of the artboards are on it.
 */
export async function printCanvasPdf(
  tenant: TenantContext,
  canvasId: string,
  artboardIds: readonly string[]
): Promise<Buffer | null> {
  const canvas = await getCanvas(tenant, canvasId)
  if (!canvas) return null
  const ids = artboardIds.filter((id) =>
    canvas.document.artboards.some((artboard) => artboard.id === id)
  )
  if (!ids.length) return null
  if (!(await isDesignRendererReady())) throw new CanvasPdfUnavailableError()
  await enforceRenderLimit(tenant.organizationId)
  const renderer = await createDesignRenderer()
  try {
    return await renderer.printCanvas(canvasId, tenant.organizationId, ids)
  } finally {
    await renderer.close().catch(() => undefined)
  }
}
