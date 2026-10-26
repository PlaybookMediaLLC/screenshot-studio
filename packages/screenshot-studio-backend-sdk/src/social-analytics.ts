import { z } from 'zod'

/** Timestamped observations; missing metrics are unknown, never implicit zeros. */
export const socialObservationSchema = z.object({
  id: z.string(),
  draftId: z.string().optional(),
  title: z.string().optional(),
  caption: z.string().optional(),
  url: z.string().url().nullable().optional(),
  connectionId: z.string(),
  subjectId: z.string(),
  kind: z.enum(['post', 'account', 'feed']),
  platform: z.string(),
  observedAt: z.iso.datetime(),
  status: z.enum(['available', 'unavailable', 'failed']),
  metrics: z.record(z.string(), z.number().nonnegative()),
  series: z.array(
    z.object({
      label: z.string(),
      average: z.boolean(),
      data: z.array(z.object({ date: z.string(), total: z.string() })),
    })
  ),
})

/** An attributed snapshot returned by the analytics API. */
export type SocialObservation = z.infer<typeof socialObservationSchema>
