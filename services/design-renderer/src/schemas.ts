import { z } from 'zod'

const httpUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = URL.parse(value)
  return url !== null && !url.username && !url.password
}, 'URL credentials are not allowed.')
const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback)

export const environmentSchema = z
  .object({
    RENDER_ALLOWED_ORIGIN: httpUrl.refine((value) => {
      const url = URL.parse(value)
      return url !== null && url.pathname === '/' && !url.search && !url.hash
    }, 'Use an HTTP(S) origin without a path, query, or fragment.'),
    RENDER_SERVICE_SECRET: z
      .string()
      .min(32)
      .refine((value) => value.trim().length >= 32),
    CHROMIUM_PATH: z.string().min(1).optional(),
    PORT: integer(8080, 1, 65535),
    RENDER_CONCURRENCY: integer(2, 1, 32),
    RENDER_MAX_QUEUE: integer(20, 0, 1000),
    RENDER_QUEUE_TIMEOUT_MS: integer(10000, 100, 300000),
    RENDER_RECYCLE_AFTER: integer(200, 1, 100000),
    RENDER_TIMEOUT_MS: integer(60000, 100, 300000),
    RENDER_SHUTDOWN_TIMEOUT_MS: integer(30000, 100, 300000),
  })
  .transform((env) => ({
    appOrigin: new URL(env.RENDER_ALLOWED_ORIGIN).origin,
    secret: env.RENDER_SERVICE_SECRET,
    chromiumPath: env.CHROMIUM_PATH,
    port: env.PORT,
    concurrency: env.RENDER_CONCURRENCY,
    maxQueue: env.RENDER_MAX_QUEUE,
    queueTimeoutMs: env.RENDER_QUEUE_TIMEOUT_MS,
    recycleAfter: env.RENDER_RECYCLE_AFTER,
    timeoutMs: env.RENDER_TIMEOUT_MS,
    shutdownTimeoutMs: env.RENDER_SHUTDOWN_TIMEOUT_MS,
  }))

export type RendererConfig = z.infer<typeof environmentSchema>
export const renderRequestSchema = z.object({ url: httpUrl }).strict()
export const renderResultSchema = z.object({
  base64: z.base64().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  // Older app versions omit this; the caller already knows the requested format.
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
})
export type RenderResult = z.infer<typeof renderResultSchema>
export const renderPath = /^\/(?:[a-z]{2}\/)?render\/[\w-]+$/
