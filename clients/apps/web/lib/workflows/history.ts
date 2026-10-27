import type { AutomationHistoryItem } from '@/lib/api/contracts/release-automation'

/** Convert a picked local day to an inclusive start or exclusive next-day boundary. */
export function runDateBoundary(day: string, end = false): string {
  if (!day) return ''
  const date = new Date(`${day}T00:00:00`)
  if (!Number.isFinite(date.getTime())) return ''
  if (end) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

/** Recover the selected local day from a stored boundary, including across DST. */
export function runDateDay(boundary?: string, end = false): string {
  if (!boundary) return ''
  const date = new Date(boundary)
  if (!Number.isFinite(date.getTime())) return ''
  if (end) date.setMilliseconds(date.getMilliseconds() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Explain runs without a selected definition without attributing legacy work to workflows. */
export function runHandler(item: {
  event: Pick<AutomationHistoryItem['event'], 'mode'>
  run: Pick<AutomationHistoryItem['run'], 'definitionId'>
}): string {
  return item.event.mode === 'legacy'
    ? 'Manual release intake'
    : item.run.definitionId
      ? 'Archived workflow'
      : 'No matching workflow'
}
