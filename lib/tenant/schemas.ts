import { z } from 'zod'
import { assetClassifications } from './object-key'

const contentTypeSchema = z
  .string()
  .trim()
  .regex(/^(image\/(gif|jpeg|png|webp)|video\/(mp4|webm))$/, 'Unsupported media type.')

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'SHA-256 must be hexadecimal.')
const assetIdSchema = z.string().uuid()

export const assetCompleteSchema = z.object({
  assetId: assetIdSchema,
  sha256: sha256Schema.optional(),
})

export const assetDownloadQuerySchema = z.object({
  assetId: assetIdSchema,
})

export const assetUploadSchema = z.object({
  bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  classification: z.enum(assetClassifications).default('input'),
  contentType: contentTypeSchema,
  fileName: z.string().trim().min(1).max(128),
  sha256: sha256Schema.optional(),
})

export const brandKitCreateSchema = z.object({
  definition: z.record(z.string(), z.json()),
  name: z.string().trim().min(1).max(100),
  publish: z.boolean().default(false),
})

export const releaseCreateSchema = z.object({
  benefitStatement: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(160),
})

export const releaseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const sourceAppCreateSchema = z.object({
  allowedHosts: z.array(z.string().url()).min(1).max(50),
  externalId: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(100),
  provider: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]+$/)
    .max(64)
    .default('generic'),
  secretReference: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,127}$/)
    .optional(),
})

const postizSecretReferenceSchema = z
  .string()
  .regex(/^POSTIZ_(?:API_KEY|OAUTH_TOKEN)(?:_[A-Z0-9_]+)?$/)

const providerSettingsSchema = z.record(z.string(), z.json()).default({})

export const channelConnectionCreateSchema = z.object({
  externalAccountId: z.string().trim().min(1).max(160),
  platform: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .default('x'),
  providerSettings: providerSettingsSchema,
  secretReference: postizSecretReferenceSchema.default('POSTIZ_API_KEY'),
})

export const scheduledPostCreateSchema = z.object({
  caption: z.string().trim().min(1).max(3_000),
  channelConnectionId: z.string().cuid(),
  scheduledFor: z.coerce.date().refine((value) => value.getTime() > Date.now(), {
    message: 'Scheduled time must be in the future.',
  }),
  variantId: z.string().cuid(),
})

export const scheduledPostListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const cuidSchema = z.string().cuid()

export const creativeTemplateCreateSchema = z.object({
  definition: z.record(z.string(), z.json()),
  name: z.string().trim().min(1).max(100),
})

export const creativeVariantCreateSchema = z.object({
  aspectRatio: z
    .string()
    .trim()
    .regex(/^\d+:\d+$/)
    .max(16),
  brandKitId: cuidSchema,
  releaseId: z.string().uuid(),
  sourceAssetId: assetIdSchema,
  templateId: cuidSchema,
})

export const creativeVariantApprovalSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  status: z.enum(['APPROVED', 'REJECTED']),
})

export type AssetUploadInput = z.infer<typeof assetUploadSchema>
export type BrandKitCreateInput = z.infer<typeof brandKitCreateSchema>
export type ChannelConnectionCreateInput = z.infer<typeof channelConnectionCreateSchema>
export type CreativeTemplateCreateInput = z.infer<typeof creativeTemplateCreateSchema>
export type CreativeVariantApprovalInput = z.infer<typeof creativeVariantApprovalSchema>
export type CreativeVariantCreateInput = z.infer<typeof creativeVariantCreateSchema>
export type ReleaseCreateInput = z.infer<typeof releaseCreateSchema>
export type ScheduledPostCreateInput = z.infer<typeof scheduledPostCreateSchema>
export type SourceAppCreateInput = z.infer<typeof sourceAppCreateSchema>
