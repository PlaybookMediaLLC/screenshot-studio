import { z } from 'zod'
import { defineContract, mirrors } from '@/lib/api/contract'
import { workspaceDocs } from '@/lib/api/contracts/workspace-docs'
import type { AssetDeletionResult, completeAssetUpload, signAssetUpload } from '@/lib/tenant/assets'
import {
  assetCompleteSchema,
  assetDownloadQuerySchema,
  assetUploadSchema,
} from '@/lib/tenant/schemas'

/** Upload states of an asset. */
export const assetStatusSchema = z.enum(['PENDING', 'UPLOADED', 'FAILED', 'DELETED'])

/** An asset record. */
export const assetSchema = z.object({
  id: z.string(),
  objectKey: z.string(),
  status: assetStatusSchema,
})

/** Outcomes of an asset deletion request. */
export const assetDeletionResultSchema = mirrors<AssetDeletionResult>()(
  z.enum(['deleted', 'in-use', 'not-found', 'not-ready'])
)

/** The `{assetId}` path parameter. */
export const assetParamsSchema = assetDownloadQuerySchema

const assetNotFound = 'The asset was not found in this workspace.'

/** `POST /api/v1/assets/upload-url` (also served under `/api/tenant/assets`). */
export const createAssetUploadUrlContract = defineContract({
  body: assetUploadSchema,
  docs: workspaceDocs({
    bodyName: 'AssetUploadRequest',
    description:
      'Creates an asset record and a short-lived signed upload URL. Upload the bytes with `PUT`, the declared `Content-Type`, and `If-None-Match: *`: the URL is write-once and both headers are part of its signature. Requires the `upload:sign` scope.',
    operationId: 'createAssetUploadUrl',
    responses: { '201': 'Signed upload instructions.', '400': 'The asset metadata is invalid.' },
    tag: 'Assets',
  }),
  method: 'POST',
  name: 'assets.upload-url',
  output: mirrors<Awaited<ReturnType<typeof signAssetUpload>>>()(
    z.object({ asset: assetSchema, uploadUrl: z.string() })
  ),
  path: '/api/v1/assets/upload-url',
  status: 201,
  summary: 'Create a signed asset upload URL',
})

/** `POST /api/v1/assets/{assetId}/complete` */
export const completeAssetUploadContract = defineContract({
  body: assetCompleteSchema.omit({ assetId: true }),
  docs: workspaceDocs({
    bodyName: 'AssetCompleteRequest',
    description:
      'Marks a signed upload as complete after storage verification. Requires the `asset:write` scope.',
    operationId: 'completeAssetUpload',
    responses: {
      '200': 'Asset upload completed.',
      '400': 'The completion input is invalid.',
      '404': assetNotFound,
    },
    tag: 'Assets',
  }),
  method: 'POST',
  name: 'assets.complete',
  output: z.object({
    asset: mirrors<NonNullable<Awaited<ReturnType<typeof completeAssetUpload>>>>()(assetSchema),
  }),
  params: assetParamsSchema,
  path: '/api/v1/assets/{assetId}/complete',
  summary: 'Complete an asset upload',
})

/** `GET /api/v1/assets/{assetId}/download-url` */
export const createAssetDownloadUrlContract = defineContract({
  docs: workspaceDocs({
    description:
      'Returns a short-lived signed download URL for a workspace asset. Requires the `artifact:read` scope.',
    operationId: 'createAssetDownloadUrl',
    outputName: 'AssetDownloadResponse',
    responses: {
      '200': 'Signed asset download URL.',
      '400': 'The asset identifier is invalid.',
      '404': assetNotFound,
    },
    tag: 'Assets',
  }),
  method: 'GET',
  name: 'assets.download-url',
  output: z.object({ downloadUrl: z.url() }),
  params: assetParamsSchema,
  path: '/api/v1/assets/{assetId}/download-url',
  summary: 'Create a signed asset download URL',
})

/** `DELETE /api/v1/assets/{assetId}` */
export const deleteAssetContract = defineContract({
  docs: workspaceDocs({
    description:
      'Queues deletion of an uploaded asset that is not in use. Requires the `asset:write` scope and the asset deletion workspace entitlement (Pro or higher by default).',
    extensions: {
      'x-shots-entitlement': {
        feature: 'asset:delete',
        minimumPlan: 'pro',
        quota: 'api:write:minute',
      },
    },
    operationId: 'deleteAsset',
    responses: {
      '202': 'Asset deletion accepted.',
      '400': 'The asset identifier is invalid.',
      '403':
        'The principal lacks the required workspace permission, scope, or pricing entitlement.',
      '404': assetNotFound,
      '409': 'The asset is in use or is not ready for deletion.',
      '429': 'The workspace plan quota has been exceeded.',
    },
    tag: 'Assets',
  }),
  method: 'DELETE',
  name: 'assets.delete',
  output: z.object({ accepted: z.literal(true) }),
  params: assetParamsSchema,
  path: '/api/v1/assets/{assetId}',
  status: 202,
  summary: 'Delete a workspace asset',
})
