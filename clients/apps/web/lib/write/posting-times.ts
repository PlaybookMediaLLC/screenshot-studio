import { dayOfWeek, zonedDayKey, zonedParts } from '@/lib/settings/zoned-time'

/** Observed engagement by local publication weekday/hour; missing measurements stay missing. */
export function postingTimeBuckets(
  posts: {
    status: string
    scheduledFor: string
    metrics: Record<string, number> | null
    metricsAt?: string | null
  }[],
  zone: string
) {
  const days = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({ weekday, hour, count: 0, total: 0, average: 0 }))
  )
  for (const post of posts) {
    if (post.status !== 'PUBLISHED' || !post.metrics || !post.metricsAt) continue
    const scores = ['likes', 'reposts', 'replies']
      .map((key) => post.metrics?.[key])
      .filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0
      )
    if (!scores.length) continue
    const at = new Date(post.scheduledFor)
    const bucket = days[dayOfWeek(zonedDayKey(at, zone))][zonedParts(at, zone).hour]
    bucket.count++
    bucket.total += scores.reduce((sum, value) => sum + value, 0)
    bucket.average = bucket.total / bucket.count
  }
  return days
}
