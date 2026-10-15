import { z } from 'zod'

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)
  }, 'URL must use http or https protocol.')

/** Body of `POST /api/screenshot`. */
export const screenshotRequestSchema = z.object({
  colorScheme: z.enum(['light', 'dark']).default('light'),
  deviceType: z.enum(['desktop', 'mobile']).default('desktop'),
  forceRefresh: z.boolean().default(false),
  url: httpUrl,
})

/** Body of `POST /api/screenshot/invalidate`: one URL or a non-empty list. */
export const cacheInvalidationSchema = z.union([
  z.object({ url: httpUrl, urls: z.never().optional() }),
  z.object({ url: z.never().optional(), urls: z.array(httpUrl).min(1) }),
])

/** A JSON body that must be exactly `{}`. */
export const emptyRequestSchema = z.object({}).strict()

/** One of {@link screenshotRequestSchema}. */
export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>

/** Query of `GET /api/image-proxy`. */
export const imageProxyRequestSchema = z.object({ url: httpUrl })

/** Form fields of `POST /api/export`. */
export const exportRequestSchema = z.object({
  format: z.enum(['png', 'jpeg', 'webp']),
  image: z.instanceof(File),
  qualityPreset: z.enum(['high', 'medium', 'low']),
})

/** One of {@link exportRequestSchema}. */
export type ExportRequest = z.infer<typeof exportRequestSchema>
