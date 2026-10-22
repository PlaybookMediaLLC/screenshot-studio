import 'server-only'

import { createHash } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import type { TenantContext } from '@/lib/auth/access'
import { artboardFromProject } from '@/lib/canvas/import'
import { canvasDocumentSchema } from '@/lib/canvas/document'
import { createCanvas, getCanvas, listCanvases } from './canvases'
import { getProject } from './projects'

/** Open the project's existing canvas, creating one from its stored document only when needed. */
export async function openProjectCanvas(context: TenantContext, projectId: string) {
  const project = await getProject(context, projectId)
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' })
  // A stable, workspace-scoped id also deduplicates simultaneous first opens.
  const id = `c${createHash('sha256')
    .update(JSON.stringify([project.organizationId, projectId]))
    .digest('hex')
    .slice(0, 24)}`
  const existing = await getCanvas(context, id)
  if (existing) return { id: existing.id }

  // shortcut: legacy links scan pages; use an indexed project link when libraries grow.
  let cursor: string | undefined
  do {
    const page = await listCanvases(context, { limit: 100, cursor })
    const linked = page.items.find((canvas) =>
      canvas.document?.artboards.some(
        ({ origin }) => origin?.kind === 'project' && origin.id === projectId
      )
    )
    if (linked) return { id: linked.id }
    cursor = page.nextCursor ?? undefined
  } while (cursor)

  const artboard = await artboardFromProject(project, { x: 0, y: 0 })
  try {
    await createCanvas(context, {
      id,
      name: project.name,
      document: canvasDocumentSchema.parse({ version: 1, kind: 'canvas', artboards: [artboard] }),
    })
  } catch (error) {
    // Another first open may have won with different layer ids or copy time.
    if (!(await getCanvas(context, id))) throw error
  }
  return { id }
}
