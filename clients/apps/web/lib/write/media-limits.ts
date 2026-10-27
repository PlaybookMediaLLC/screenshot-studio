import limits from '../../../../../server/internal/medialimits/limits.json'

/** Shared with Go; destination restrictions are applied separately. */
export const MEDIA_LIMITS = limits

/** Ingestion ceiling. The backend also checks the current workspace entitlement. */
export function uploadByteLimit(mime: string, plan = 'pro'): number {
  if (mime.startsWith('image/')) {
    return ['pro', 'business', 'enterprise'].includes(plan)
      ? limits.paidImageBytes
      : limits.freeImageBytes
  }
  if (mime.startsWith('video/')) return limits.videoBytes
  if (mime === 'application/pdf') return limits.pdfBytes
  return limits.otherBytes
}
