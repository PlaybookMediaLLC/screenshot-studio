import { z } from 'zod'

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, 'URL must use http or https protocol.')

export const screenshotRequestSchema = z.object({
  colorScheme: z.enum(['light', 'dark']).default('light'),
  deviceType: z.enum(['desktop', 'mobile']).default('desktop'),
  forceRefresh: z.boolean().default(false),
  url: httpUrl,
})

export const cacheInvalidationSchema = z.union([
  z.object({ url: httpUrl, urls: z.never().optional() }),
  z.object({ url: z.never().optional(), urls: z.array(httpUrl).min(1) }),
])

export const emptyRequestSchema = z.object({}).strict()

export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>

export const imageProxyRequestSchema = z.object({ url: httpUrl })

export const exportRequestSchema = z.object({
  format: z.enum(['png', 'jpeg', 'webp']),
  image: z.instanceof(File),
  qualityPreset: z.enum(['high', 'medium', 'low']),
})

export type ExportRequest = z.infer<typeof exportRequestSchema>
