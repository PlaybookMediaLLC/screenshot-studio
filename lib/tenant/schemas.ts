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

export const assetListQuerySchema = z.object({
  /** Opaque id of the last asset on the previous page. */
  cursor: assetIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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

export const brandProfileUpsertSchema = z.object({
  audience: z.string().trim().min(1).max(1_000),
  ctaConventions: z.string().trim().max(1_000).optional(),
  preferredStyles: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  productDescription: z.string().trim().min(1).max(2_000),
  prohibitedTerms: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
  socialHandles: z.record(z.string(), z.string().trim().max(160)).default({}),
  tagline: z.string().trim().max(200).optional(),
  tone: z.string().trim().min(1).max(500),
})

const channelSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/)
  .max(64)

/** Absolute http(s) URL. Rejects javascript:, data:, and other schemes. */
const webUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an http(s) URL.')

/**
 * Plain-text prose. Release briefs are rendered as text, never as HTML, and
 * markup is rejected here so no stored value depends on output escaping alone.
 */
const plainTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/<\/?[a-z!][^>]*>/i.test(value), 'HTML is not allowed.')

export const productEnvironments = ['production', 'staging', 'demo', 'development'] as const

const productSurfaceFields = {
  description: z.string().trim().max(1_000),
  environment: z.enum(productEnvironments),
  featureTags: z.array(z.string().trim().min(1).max(100)).max(50),
  name: z.string().trim().min(1).max(160),
  screenshotAssetIds: z.array(z.string().uuid()).max(50),
  url: webUrlSchema,
}

export const productSurfaceCreateSchema = z.object({
  ...productSurfaceFields,
  description: productSurfaceFields.description.optional(),
  environment: productSurfaceFields.environment.default('production'),
  featureTags: productSurfaceFields.featureTags.default([]),
  screenshotAssetIds: productSurfaceFields.screenshotAssetIds.default([]),
})

// Built from the undefaulted fields: a partial of the create schema would
// apply its defaults and reset omitted arrays and the environment on update.
export const productSurfaceUpdateSchema = z.object(productSurfaceFields).partial()

export const campaignCreateSchema = z.object({
  angles: z
    .array(
      z.object({
        hook: z.string().trim().min(1).max(1_000),
        title: z.string().trim().min(1).max(200),
      })
    )
    .max(20)
    .default([]),
  audience: z.string().trim().max(1_000).optional(),
  feature: z.string().trim().max(500).optional(),
  messaging: z.string().trim().max(2_000).optional(),
  name: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(500),
  productSurfaceId: z.string().cuid().optional(),
  releaseId: z.string().uuid().optional(),
  posts: z
    .array(
      z.object({
        angleIndex: z.number().int().min(0).optional(),
        callToAction: z.string().trim().max(300).optional(),
        channel: channelSlugSchema,
        copy: z.string().trim().min(1).max(10_000),
      })
    )
    .max(50)
    .default([]),
})

export const campaignApprovalSchema = z.object({
  decision: z.enum(['submit', 'approve', 'reject', 'request_changes']),
  /** Why, when rejecting or requesting changes; it guides the next generation. */
  note: z.string().trim().max(1_000).optional(),
  postIds: z.array(z.string().cuid()).min(1).max(100).optional(),
})

export const campaignTransitionSchema = z.object({
  campaignId: z.string().cuid(),
  status: z.enum(['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ARCHIVED']),
})

export const campaignPostScheduleSchema = z.object({
  channelConnectionId: z.string().cuid(),
  scheduledAt: z.coerce
    .date()
    .refine((value) => value.getTime() > Date.now(), {
      message: 'Scheduled time must be in the future.',
    })
    .optional(),
})

const releaseFields = {
  audience: plainTextSchema(1_000),
  benefitStatement: z.string().trim().min(1).max(500),
  description: plainTextSchema(10_000),
  productSurfaceId: z.string().cuid(),
  sourceUrls: z.array(webUrlSchema).max(20),
  title: z.string().trim().min(1).max(160),
}

export const releaseCreateSchema = z.object({
  ...releaseFields,
  audience: releaseFields.audience.optional(),
  // Optional when a source link is given (checked in createRelease): the spec
  // drafter reads why it matters from the sources.
  benefitStatement: z.string().trim().max(500).default(''),
  description: releaseFields.description.optional(),
  productSurfaceId: releaseFields.productSurfaceId.optional(),
  sourceUrls: releaseFields.sourceUrls.optional(),
})

/** Edits the brief only; linked campaigns and generated artifacts are untouched. */
export const releaseUpdateSchema = z
  .object({
    ...releaseFields,
    audience: releaseFields.audience.nullable(),
    // May be cleared while a source link remains (checked in updateRelease).
    benefitStatement: z.string().trim().max(500),
    description: releaseFields.description.nullable(),
    productSurfaceId: releaseFields.productSurfaceId.nullable(),
  })
  .partial()

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

/**
 * Schedule a release announcement.
 *
 * `scheduledFor` is optional and defaults to immediate dispatch, since
 * announcing on approval is the common case. When supplied it must be in
 * the future: a past time would be picked up by the very next dispatch
 * tick, which silently turns "schedule" into "send now".
 */
export const announcementScheduleSchema = z.object({
  ctaUrl: z.string().url().max(2_000).optional(),
  releaseDocumentId: z.string().cuid(),
  scheduledFor: z.coerce
    .date()
    .refine((value) => value.getTime() > Date.now(), {
      message: 'Scheduled time must be in the future.',
    })
    .optional(),
})

export const announcementListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/**
 * Add customers to an announcement audience.
 *
 * Addresses are lowercased so consent cannot be bypassed by varying case:
 * without it, `Customer@example.com` would create a second subscriber row
 * that an unsubscribe on `customer@example.com` would not suppress.
 */
export const audienceSubscriberCreateSchema = z.object({
  subscribers: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email().max(320),
        name: z.string().trim().max(200).optional(),
      })
    )
    .min(1)
    .max(1_000),
})

export const audienceListQuerySchema = z.object({
  includeUnsubscribed: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export type AssetListQuery = z.infer<typeof assetListQuerySchema>
export type AssetUploadInput = z.infer<typeof assetUploadSchema>
export type AnnouncementScheduleInput = z.infer<typeof announcementScheduleSchema>
export type AudienceSubscriberCreateInput = z.infer<typeof audienceSubscriberCreateSchema>
export type BrandKitCreateInput = z.infer<typeof brandKitCreateSchema>
export type BrandProfileUpsertInput = z.infer<typeof brandProfileUpsertSchema>
export type CampaignApprovalInput = z.infer<typeof campaignApprovalSchema>
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>
export type CampaignPostScheduleInput = z.infer<typeof campaignPostScheduleSchema>
export type CampaignTransitionInput = z.infer<typeof campaignTransitionSchema>
export type ProductSurfaceCreateInput = z.infer<typeof productSurfaceCreateSchema>
export type ProductSurfaceUpdateInput = z.infer<typeof productSurfaceUpdateSchema>
export type ChannelConnectionCreateInput = z.infer<typeof channelConnectionCreateSchema>
export type CreativeTemplateCreateInput = z.infer<typeof creativeTemplateCreateSchema>
export type CreativeVariantApprovalInput = z.infer<typeof creativeVariantApprovalSchema>
export type CreativeVariantCreateInput = z.infer<typeof creativeVariantCreateSchema>
export type ReleaseCreateInput = z.infer<typeof releaseCreateSchema>
export type ReleaseUpdateInput = z.infer<typeof releaseUpdateSchema>
export type ScheduledPostCreateInput = z.infer<typeof scheduledPostCreateSchema>
export type SourceAppCreateInput = z.infer<typeof sourceAppCreateSchema>
