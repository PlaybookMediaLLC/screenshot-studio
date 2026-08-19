import 'server-only'

import { TRPCError } from '@trpc/server'
import {
  completeAssetUpload,
  deleteAsset,
  listAssets,
  signAssetDownload,
  signAssetUpload,
} from '@/lib/tenant/assets'
import {
  assetCompleteSchema,
  assetDownloadQuerySchema,
  assetListQuerySchema,
  assetUploadSchema,
} from '@/lib/tenant/schemas'
import { router } from '../init'
import { tenantProcedure } from '../procedures'

export const assetRouter = router({
  list: tenantProcedure({ apiKeyScope: 'artifact:read', permission: 'artifact:read' })
    .input(assetListQuerySchema.optional())
    .query(async ({ ctx, input }) =>
      listAssets(ctx.tenant.organizationId, {
        cursor: input?.cursor,
        take: input?.limit ?? 50,
      })
    ),
  signUpload: tenantProcedure({ apiKeyScope: 'upload:sign', permission: 'artifact:edit' })
    .input(assetUploadSchema)
    .mutation(async ({ ctx, input }) => signAssetUpload(ctx.tenant, input)),
  completeUpload: tenantProcedure({ apiKeyScope: 'asset:write', permission: 'artifact:edit' })
    .input(assetCompleteSchema)
    .mutation(async ({ ctx, input }) => {
      const asset = await completeAssetUpload(ctx.tenant, input.assetId, input.sha256)
      if (!asset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' })
      }
      return { asset }
    }),
  signDownload: tenantProcedure({ apiKeyScope: 'artifact:read', permission: 'artifact:read' })
    .input(assetDownloadQuerySchema)
    .query(async ({ ctx, input }) => {
      const downloadUrl = await signAssetDownload(ctx.tenant, input.assetId)
      if (!downloadUrl) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' })
      }
      return { downloadUrl }
    }),
  delete: tenantProcedure({ apiKeyScope: 'asset:write', permission: 'artifact:edit' })
    .input(assetDownloadQuerySchema)
    .mutation(async ({ ctx, input }) => {
      const result = await deleteAsset(ctx.tenant, input.assetId)
      if (result === 'not-found') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asset not found.' })
      }
      if (result === 'in-use') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Asset is in use by a creative variant.',
        })
      }
      if (result === 'not-ready') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Only uploaded assets can be deleted.',
        })
      }
      return { accepted: true as const }
    }),
})
