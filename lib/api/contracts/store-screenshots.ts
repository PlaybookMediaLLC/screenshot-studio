import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'

/**
 * Contracts for the store screenshot studio's server features: AI
 * translation and copy, Figma import, and review links. Store uploads
 * live in `store-publishing.ts`.
 * Screenshot editing itself stays in the browser.
 */

/** A BCP 47 locale code as the studio uses them. */
export const storeLocaleSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Use a locale code such as de-DE.')

/** One string to translate. Formatting is carried as numbered tags (`<0>word</0>`). */
export const translationItemSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(600),
})

/** `POST /api/store-screenshots/translate` request. */
export const translateRequestSchema = z.object({
  sourceLocale: storeLocaleSchema,
  targetLocale: storeLocaleSchema,
  items: z.array(translationItemSchema).min(1).max(80),
  /** Optional product context so terms are translated consistently. */
  context: z.string().max(2000).default(''),
})

/** Translated strings, one per requested id. */
export const translateResponseSchema = z.object({
  translations: z.array(z.object({ id: z.string(), text: z.string() })),
})

/** One of {@link translateRequestSchema}. */
export type TranslateRequest = z.infer<typeof translateRequestSchema>

/** `POST /api/store-screenshots/translate` */
export const storeTranslateContract = defineContract({
  body: translateRequestSchema,
  method: 'POST',
  name: 'store-screenshots.translate',
  output: translateResponseSchema,
  path: '/api/store-screenshots/translate',
  summary: 'Translate store screenshot copy',
})

/** Copy length presets. */
export const copyLengthSchema = z.enum(['short', 'long'])

/** Copy tone presets. */
export const copyToneSchema = z.enum([
  'confident',
  'friendly',
  'playful',
  'premium',
  'calm',
  'direct',
])

/** `POST /api/store-screenshots/copy` request. */
export const copyRequestSchema = z.object({
  /** Product facts the copy may rely on. Nothing else is assumed. */
  brief: z.string().min(20).max(4000),
  locale: storeLocaleSchema,
  tone: copyToneSchema,
  length: copyLengthSchema,
  count: z.number().int().min(1).max(6),
  slides: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        /** What the slide's screenshot shows, in the user's words. */
        topic: z.string().max(300),
        currentHeadline: z.string().max(200),
      })
    )
    .min(1)
    .max(12),
})

/** Suggestions per slide. */
export const copyResponseSchema = z.object({
  slides: z.array(
    z.object({
      id: z.string(),
      suggestions: z.array(
        z.object({ headline: z.string(), subheadline: z.string(), rationale: z.string() })
      ),
    })
  ),
})

/** One of {@link copyRequestSchema}. */
export type CopyRequest = z.infer<typeof copyRequestSchema>

/** `POST /api/store-screenshots/copy` */
export const storeCopyContract = defineContract({
  body: copyRequestSchema,
  method: 'POST',
  name: 'store-screenshots.copy',
  output: copyResponseSchema,
  path: '/api/store-screenshots/copy',
  summary: 'Suggest store screenshot headlines grounded in product facts',
})

/** A Figma personal access token; used for one request, never stored. */
export const figmaTokenSchema = z.string().min(10).max(200)

/** A Figma file key. */
export const figmaFileKeySchema = z.string().regex(/^[A-Za-z0-9]{10,64}$/)

/** `POST /api/store-screenshots/figma/frames` request. */
export const figmaFramesRequestSchema = z.object({
  fileKey: figmaFileKeySchema,
  token: figmaTokenSchema,
})

/** Top-level frames in a Figma file. */
export const figmaFramesResponseSchema = z.object({
  frames: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      page: z.string(),
      width: z.number(),
      height: z.number(),
    })
  ),
})

/** `POST /api/store-screenshots/figma/frames` */
export const figmaFramesContract = defineContract({
  body: figmaFramesRequestSchema,
  method: 'POST',
  name: 'store-screenshots.figma-frames',
  output: figmaFramesResponseSchema,
  path: '/api/store-screenshots/figma/frames',
  summary: 'List importable frames in a Figma file',
})

/** `POST /api/store-screenshots/figma/image` request. */
export const figmaImageRequestSchema = z.object({
  fileKey: figmaFileKeySchema,
  nodeId: z.string().regex(/^\d+[:-]\d+$/),
  token: figmaTokenSchema,
  scale: z.number().min(1).max(4),
})

/** `POST /api/store-screenshots/figma/image` (returns image/png bytes) */
export const figmaImageContract = defineContract({
  body: figmaImageRequestSchema,
  method: 'POST',
  name: 'store-screenshots.figma-image',
  output: z.never(),
  path: '/api/store-screenshots/figma/image',
  summary: 'Render one Figma frame as PNG',
})

/** A slide image for a review, as base64 JPEG. */
export const reviewImageRequestSchema = z.object({
  name: z.string().min(1).max(80),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(8192),
  /** Base64 JPEG, at most about 6 MB decoded. */
  image: z.string().min(100).max(8_500_000),
})

/** `POST /api/store-screenshots/reviews/images` */
export const reviewImageContract = defineContract({
  body: reviewImageRequestSchema,
  method: 'POST',
  name: 'store-screenshots.review-image',
  output: z.object({ assetId: z.string() }),
  path: '/api/store-screenshots/reviews/images',
  summary: 'Store one rendered slide for a review',
})

/** A review slide reference. */
export const reviewSlideSchema = z.object({
  slideId: z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/),
  name: z.string().max(80),
  assetId: z.uuid(),
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
})

/** A review comment as returned to the studio and the review page. */
export const reviewCommentSchema = z.object({
  id: z.string(),
  slideId: z.string(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  authorName: z.string(),
  body: z.string(),
  fromLink: z.boolean(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})

/** A review as the studio sees it, with its share link (null once revoked). */
export const reviewSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  versionLabel: z.string(),
  projectRevision: z.number(),
  slides: z.array(reviewSlideSchema),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  comments: z.array(reviewCommentSchema),
  url: z.string().nullable(),
})

/** One {@link reviewSummarySchema} value. */
export type ReviewSummary = z.infer<typeof reviewSummarySchema>

/** `POST /api/store-screenshots/reviews` request. */
export const createReviewRequestSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  name: z.string().min(1).max(120),
  versionLabel: z.string().max(80),
  projectRevision: z.number().int().min(0),
  slides: z.array(reviewSlideSchema).min(1).max(30),
})

/** `POST /api/store-screenshots/reviews` */
export const createReviewContract = defineContract({
  body: createReviewRequestSchema,
  method: 'POST',
  name: 'store-screenshots.create-review',
  output: reviewSummarySchema,
  path: '/api/store-screenshots/reviews',
  status: 201,
  summary: 'Create a shareable review of a screenshot set',
})

/** `GET /api/store-screenshots/reviews?projectId=` */
export const listReviewsContract = defineContract({
  method: 'GET',
  name: 'store-screenshots.list-reviews',
  output: z.object({ reviews: z.array(reviewSummarySchema) }),
  path: '/api/store-screenshots/reviews',
  query: z.object({ projectId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }),
  summary: 'List reviews of a project',
})

/** Path parameters naming a review. */
export const reviewParamsSchema = z.object({ reviewId: z.string().regex(/^[a-z0-9]{10,32}$/) })

/** `POST /api/store-screenshots/reviews/{reviewId}/revoke` */
export const revokeReviewContract = defineContract({
  method: 'POST',
  name: 'store-screenshots.revoke-review',
  output: z.object({ revoked: z.boolean() }),
  params: reviewParamsSchema,
  path: '/api/store-screenshots/reviews/{reviewId}/revoke',
  summary: 'Turn off a review link',
})

/** `PUT /api/store-screenshots/reviews/{reviewId}/comments/{commentId}` */
export const resolveCommentContract = defineContract({
  body: z.object({ resolved: z.boolean() }),
  method: 'PUT',
  name: 'store-screenshots.resolve-comment',
  output: z.object({ resolved: z.boolean() }),
  params: reviewParamsSchema.extend({ commentId: z.string().regex(/^[a-z0-9]{10,32}$/) }),
  path: '/api/store-screenshots/reviews/{reviewId}/comments/{commentId}',
  summary: 'Resolve or reopen a review comment',
})

/** A comment posted through a review link. */
export const linkCommentRequestSchema = z.object({
  slideId: z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/),
  x: z.number().min(0).max(100).nullable(),
  y: z.number().min(0).max(100).nullable(),
  authorName: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
})

/** `POST /api/review/{token}/comments` (public; the signed link is the credential) */
export const linkCommentContract = defineContract({
  body: linkCommentRequestSchema,
  method: 'POST',
  name: 'store-screenshots.link-comment',
  output: reviewCommentSchema,
  params: z.object({ token: z.string().min(20).max(600) }),
  path: '/api/review/{token}/comments',
  status: 201,
  summary: 'Comment on a shared review',
})
