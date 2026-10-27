import type { SocialObservation } from 'screenshot-studio-backend-sdk'

/** Calendar dates define an inclusive UTC range, bounded to the API's 366-day limit. */
export function analyticsRange(from?: string, to?: string, now = new Date()) {
  const end = to ?? now.toISOString().slice(0, 10)
  const start = from ?? new Date(now.getTime() - 89 * 86400_000).toISOString().slice(0, 10)
  const dates = [start, end].map((day) => new Date(`${day}T00:00:00Z`))
  if (
    dates.some(
      (date, index) =>
        !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== [start, end][index]
    )
  )
    throw new Error('Choose valid start and end dates.')
  const until = new Date(dates[1].getTime() + 86400_000)
  if (until <= dates[0] || until.getTime() - dates[0].getTime() > 366 * 86400_000)
    throw new Error('Choose a range of 1–366 days.')
  return { start, end, from: dates[0].toISOString(), to: until.toISOString() }
}

/** The last provider value in each period; gauges and overlapping windows are never summed. */
export function accountObservationBuckets(rows: SocialObservation[], period: 'week' | 'month') {
  const groups = new Map<
    string,
    {
      connection: string
      platform: string
      metric: string
      period: string
      date: string
      value: number
      observedAt: string
    }
  >()
  for (const row of rows) {
    if (row.kind !== 'account' || row.status !== 'available') continue
    for (const series of row.series)
      for (const point of series.data) {
        if (!point.total.trim()) continue
        const value = Number(point.total)
        const date = new Date(point.date)
        if (!Number.isFinite(value) || !Number.isFinite(date.getTime())) continue
        const day = date.toISOString().slice(0, 10)
        if (period === 'month') date.setUTCDate(1)
        else date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
        const bucket = date.toISOString().slice(0, 10)
        const key = `${row.connectionId}:${series.label}:${bucket}`
        const existing = groups.get(key)
        if (
          !existing ||
          day > existing.date ||
          (day === existing.date && row.observedAt > existing.observedAt)
        )
          groups.set(key, {
            connection: row.connectionId,
            platform: row.platform,
            metric: series.label,
            period: bucket,
            date: day,
            value,
            observedAt: row.observedAt,
          })
      }
  }
  return [...groups.values()].sort(
    (a, b) => a.metric.localeCompare(b.metric) || a.period.localeCompare(b.period)
  )
}

/** Latest snapshot per subject; cumulative snapshots must never be added together. */
export function latestObservations(rows: SocialObservation[]): SocialObservation[] {
  const latest = new Map<string, SocialObservation>()
  for (const row of rows) {
    const key = `${row.kind}:${row.subjectId}`
    if (!latest.has(key) || latest.get(key)!.observedAt < row.observedAt) latest.set(key, row)
  }
  return [...latest.values()]
}

/** Weekly/monthly samples of each post's latest observed cumulative engagement. */
export function observationBuckets(
  rows: SocialObservation[],
  period: 'week' | 'month',
  metric: string
) {
  const groups = new Map<string, SocialObservation[]>()
  for (const row of rows.filter((item) => item.kind === 'post')) {
    const date = new Date(row.observedAt)
    if (period === 'month') date.setUTCDate(1)
    else date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    const key = date.toISOString().slice(0, 10)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, observations]) => {
      const known = latestObservations(observations).filter(
        (row) => row.status === 'available' && row.metrics[metric] !== undefined
      )
      return {
        date,
        value: known.length ? known.reduce((sum, row) => sum + row.metrics[metric], 0) : null,
        posts: known.length,
      }
    })
}

/** Quoted CSV cells also neutralize formulas when opened in a spreadsheet. */
export function analyticsCSV(rows: SocialObservation[]): string {
  const cell = (value: string | number) => {
    const text = String(value)
    return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`
  }
  const data: (string | number)[][] = [
    [
      'kind',
      'connection',
      'subject',
      'platform',
      'observed_at',
      'status',
      'metric',
      'metric_date',
      'value',
    ],
  ]
  for (const row of rows) {
    const prefix = [
      row.kind,
      row.connectionId,
      row.subjectId,
      row.platform,
      row.observedAt,
      row.status,
    ]
    if (row.kind === 'post') {
      const entries = Object.entries(row.metrics)
      for (const [metric, value] of entries) data.push([...prefix, metric, row.observedAt, value])
      if (!entries.length) data.push([...prefix, '', '', ''])
    } else {
      for (const series of row.series)
        for (const point of series.data)
          data.push([...prefix, series.label, point.date, point.total])
      if (!row.series.length) data.push([...prefix, '', '', ''])
    }
  }
  return data.map((row) => row.map(cell).join(',')).join('\r\n')
}
