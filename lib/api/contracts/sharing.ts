import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'
import { shareMediaVariantSchema, shareTokenSchema } from '@/lib/sharing/schema'

/** `GET /api/share/{token}/media`: the bytes a share link publishes, or its poster image. */
export const shareMediaContract = defineContract({
  method: 'GET',
  name: 'share.media',
  output: z.undefined(),
  params: z.object({ token: shareTokenSchema }),
  path: '/api/share/{token}/media',
  query: z.object({ variant: shareMediaVariantSchema.default('media') }),
  summary: 'Read the media a share link publishes',
})
