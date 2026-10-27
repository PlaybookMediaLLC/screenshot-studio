import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'

/** Path parameters of a canvas route. */
export const canvasParamsSchema = z.object({ canvasId: z.string().regex(/^c[a-z0-9]{24}$/) })

/** The artboards to print; pages follow the canvas's reading order. */
export const canvasPdfRequestSchema = z.object({
  artboardIds: z.array(z.string().min(1).max(80)).min(1).max(200),
})

/** `POST /api/tenant/canvases/{canvasId}/pdf` (returns application/pdf bytes) */
export const canvasPdfContract = defineContract({
  access: { apiKeyScope: 'artifact:read', permission: 'artifact:read' },
  body: canvasPdfRequestSchema,
  method: 'POST',
  name: 'canvases.pdf',
  output: z.never(),
  params: canvasParamsSchema,
  path: '/api/tenant/canvases/{canvasId}/pdf',
  summary: 'Print canvas artboards to a PDF with selectable text',
})
