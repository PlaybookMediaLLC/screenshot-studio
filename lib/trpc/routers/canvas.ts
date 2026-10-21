import 'server-only'

import { TRPCError } from '@trpc/server'
import type { TenantAccessRequirement } from '@/lib/api/access-requirements'
import {
  canvasArchiveInputSchema,
  canvasCreateInputSchema,
  canvasDocumentInputSchema,
  canvasDuplicateInputSchema,
  canvasHandoffSchema,
  canvasListInputSchema,
  canvasRefInputSchema,
  canvasRenameInputSchema,
  canvasRestoreInputSchema,
  canvasVersionCreateInputSchema,
  canvasVersionRefInputSchema,
} from '@/lib/canvas/schema'
import {
  archiveCanvas,
  attachCanvasDelivery,
  createCanvas,
  createCanvasVersion,
  duplicateCanvas,
  getCanvas,
  getCanvasVersion,
  listCanvases,
  listCanvasVersions,
  renameCanvas,
  restoreCanvasVersion,
  updateCanvasDocument,
  createCanvasCollabToken,
} from '@/lib/tenant/canvases'
import { router } from '../init'
import { organizationProcedure, tenantProcedure } from '../procedures'
import { projectRefInputSchema } from '@/lib/projects/schema'
import { openProjectCanvas } from '@/lib/tenant/project-canvas'

const READ: TenantAccessRequirement = { apiKeyScope: 'artifact:read', permission: 'artifact:read' }
const EDIT: TenantAccessRequirement = { apiKeyScope: 'asset:write', permission: 'artifact:edit' }

function found<T>(value: T | null | false, what = 'Canvas'): T {
  if (!value) throw new TRPCError({ code: 'NOT_FOUND', message: `${what} not found.` })
  return value
}

/**
 * Canvas workspaces (RFC 041): the library, the open canvas's autosave, its
 * version history and campaign handoff. A document write based on an older
 * revision fails with `CONFLICT`.
 */
export const canvasRouter = router({
  openProject: tenantProcedure(EDIT)
    .input(projectRefInputSchema)
    .mutation(({ ctx, input }) => openProjectCanvas(ctx.tenant, input.projectId)),
  list: tenantProcedure(READ)
    .input(canvasListInputSchema)
    .query(({ ctx, input }) => listCanvases(ctx.tenant, input)),
  get: tenantProcedure(READ)
    .input(canvasRefInputSchema)
    .query(async ({ ctx, input }) => found(await getCanvas(ctx.tenant, input.canvasId))),
  /** A presence credential for the signed-in member; presence never carries canvas content. */
  collabToken: organizationProcedure('artifact:read')
    .input(canvasRefInputSchema)
    .mutation(async ({ ctx, input }) =>
      found(await createCanvasCollabToken(ctx.access, input.canvasId))
    ),
  create: tenantProcedure(EDIT)
    .input(canvasCreateInputSchema)
    .mutation(({ ctx, input }) => createCanvas(ctx.tenant, input)),
  rename: tenantProcedure(EDIT)
    .input(canvasRenameInputSchema)
    .mutation(async ({ ctx, input }) =>
      found(await renameCanvas(ctx.tenant, input.canvasId, input.name))
    ),
  updateDocument: tenantProcedure(EDIT)
    .input(canvasDocumentInputSchema)
    .mutation(({ ctx, input }) => updateCanvasDocument(ctx.tenant, input.canvasId, input)),
  duplicate: tenantProcedure(EDIT)
    .input(canvasDuplicateInputSchema)
    .mutation(async ({ ctx, input }) =>
      found(await duplicateCanvas(ctx.tenant, input.canvasId, input.name))
    ),
  archive: tenantProcedure(EDIT)
    .input(canvasArchiveInputSchema)
    .mutation(async ({ ctx, input }) => {
      found(await archiveCanvas(ctx.tenant, input.canvasId, input.archived))
      return { archived: input.archived }
    }),
  versions: tenantProcedure(READ)
    .input(canvasRefInputSchema)
    .query(async ({ ctx, input }) => found(await listCanvasVersions(ctx.tenant, input.canvasId))),
  version: tenantProcedure(READ)
    .input(canvasVersionRefInputSchema)
    .query(async ({ ctx, input }) =>
      found(await getCanvasVersion(ctx.tenant, input.canvasId, input.versionId), 'Version')
    ),
  createVersion: tenantProcedure(EDIT)
    .input(canvasVersionCreateInputSchema)
    .mutation(async ({ ctx, input }) =>
      found(await createCanvasVersion(ctx.tenant, input.canvasId, input.name, input.baseRevision))
    ),
  restoreVersion: tenantProcedure(EDIT)
    .input(canvasRestoreInputSchema)
    .mutation(async ({ ctx, input }) =>
      found(
        await restoreCanvasVersion(ctx.tenant, input.canvasId, input.versionId, input.baseRevision),
        'Version'
      )
    ),
  attachCampaign: organizationProcedure('release:create')
    .input(canvasHandoffSchema)
    .mutation(async ({ ctx, input }) => found(await attachCanvasDelivery(ctx.access, input))),
})
